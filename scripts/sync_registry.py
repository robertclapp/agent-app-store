#!/usr/bin/env python3
"""Generate the public well-known registry from canonical registry.json."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "registry.json"
PUBLIC_COPY = ROOT / ".well-known" / "agent-tools.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail instead of updating when the generated copy is stale",
    )
    args = parser.parse_args()

    canonical = SOURCE.read_bytes()
    current = PUBLIC_COPY.read_bytes() if PUBLIC_COPY.exists() else None
    if current == canonical:
        return 0
    if args.check:
        print(
            f"{PUBLIC_COPY.relative_to(ROOT)} is stale; run "
            "`python3 scripts/sync_registry.py`.",
            file=sys.stderr,
        )
        return 1

    PUBLIC_COPY.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_COPY.write_bytes(canonical)
    print(f"Updated {PUBLIC_COPY.relative_to(ROOT)} from registry.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
