#!/usr/bin/env bash
# PostToolUse hook: run the relevant test suite after a source file is edited.
#
# Reads the Claude Code hook payload on stdin, extracts the edited file path,
# and runs the test suite that covers it. Catches regressions immediately
# instead of letting them accumulate across many file edits.
#
# Exits 0 on pass, 2 on failure (2 surfaces the output back to the model).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Extract the edited file path from the hook payload.
payload="$(cat)"
file="$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')"

[ -z "$file" ] && exit 0

# Normalize to a repo-relative path so the regexes below match regardless of
# whether the hook received an absolute or relative path.
rel="${file#"$REPO_ROOT"/}"

# True only when a failure is a missing *declared dependency* (environment
# gap — stay silent), never a missing *project module* (real breakage: a
# broken import in app/ or src/ also prints "No module named"/"Cannot find
# module", and swallowing it would report success on a failing suite).
is_env_gap() {
  local label="$1" output="$2"
  case "$label" in
    Python)
      local missing top
      missing="$(printf '%s' "$output" \
        | grep -oE "No module named '[A-Za-z0-9_.]+'" | head -1 \
        | sed "s/No module named '//;s/'//")"
      [ -n "$missing" ] || return 1
      top="${missing%%.*}"
      # A module that exists in the source tree is project code, so a failure
      # to import it is real breakage no matter what requirements say.
      if [ -e "$REPO_ROOT/exchange-api/$top" ] || [ -e "$REPO_ROOT/exchange-api/$top.py" ]; then
        return 1
      fi
      # Otherwise it is an environment gap only if declared as a dependency.
      # Requirements use dashes where imports use underscores, and a
      # distribution is often named python-<module> (python-dotenv -> dotenv).
      local name="${top//_/[-_]}"
      grep -riqE "^(python-)?${name}(-python)?([=<>~!\[[:space:]]|$)" \
        "$REPO_ROOT/exchange-api/requirements-dev.txt" \
        "$REPO_ROOT/exchange-api/requirements.txt" 2>/dev/null
      ;;
    Node)
      # Deps simply not installed. With node_modules present, a resolution
      # error means broken project code.
      printf '%s' "$output" | grep -qiE 'cannot find (module|package)' || return 1
      [ ! -d "$REPO_ROOT/create-mcp-server/node_modules" ]
      ;;
    *)
      # Frontend tests use only node: builtins — never an environment gap.
      return 1
      ;;
  esac
}

# Run a test suite. Reports failures back to the model via exit 2.
# Stays silent (exit 0) only when the suite cannot run because a declared
# dependency is missing. Usage and collection errors are real failures.
run_suite() {
  local label="$1" dir="$2"
  shift 2
  local output status
  output="$(cd "$REPO_ROOT/$dir" && "$@" 2>&1)"
  status=$?

  [ $status -eq 0 ] && exit 0

  if is_env_gap "$label" "$output"; then
    exit 0
  fi

  printf '%s tests FAILED after editing %s:\n\n%s\n' \
    "$label" "$rel" "$(printf '%s' "$output" | tail -15)"
  exit 2
}

case "$rel" in
  exchange-api/*.py|exchange-api/**/*.py)
    python_bin="$(command -v python3 || command -v python || true)"
    [ -z "$python_bin" ] && exit 0
    "$python_bin" -m pytest --version >/dev/null 2>&1 || exit 0
    run_suite "Python" "exchange-api" "$python_bin" -m pytest tests/ --tb=short -q
    ;;
  create-mcp-server/src/*.js|create-mcp-server/src/**/*.js|create-mcp-server/test/*.js)
    command -v node >/dev/null 2>&1 || exit 0
    command -v npm >/dev/null 2>&1 || exit 0
    run_suite "Node" "create-mcp-server" npm test
    ;;
  app.js|index.html|style.css|base.css|registry.json|test/frontend.test.js)
    command -v node >/dev/null 2>&1 || exit 0
    run_suite "Frontend" "." node --test test/frontend.test.js
    ;;
esac

exit 0
