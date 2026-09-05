import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const hookSource = fs.readFileSync(path.join(repoRoot, '.claude/hooks/run-tests.sh'), 'utf8');
const readmeSource = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

function loadApp() {
  // Controllable timer queue: app.js schedules label restores with setTimeout
  // and cancels them with clearTimeout, so tests need both plus a way to run
  // pending callbacks in order.
  const timers = new Map();
  let nextTimerId = 1;
  const runTimers = () => {
    for (const [id, entry] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
      timers.delete(id);
      entry.fn();
    }
  };

  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        style: {},
        innerHTML: '',
        textContent: '',
        dataset: {},
        classList: { add() {}, remove() {} },
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {},
      });
    }
    return elements.get(id);
  };

  const context = vm.createContext({
    URL,
    console,
    document: {
      activeElement: null,
      body: { style: {} },
      documentElement: { setAttribute() {} },
      addEventListener() {},
      getElementById: getElement,
      querySelector: () => null,
    },
    lucide: { createIcons() {} },
    matchMedia: () => ({ matches: false }),
    setTimeout(fn, ms = 0) {
      const id = nextTimerId++;
      timers.set(id, { fn, at: ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return { context, getElement, runTimers };
}

test('safeExternalUrl allows only absolute HTTP(S) URLs', () => {
  const { context } = loadApp();
  const safeUrl = value => vm.runInContext(
    `safeExternalUrl(${JSON.stringify(value)})`,
    context,
  );

  assert.equal(safeUrl('https://docs.example.com/guide'), 'https://docs.example.com/guide');
  assert.equal(safeUrl('http://docs.example.com/'), 'http://docs.example.com/');
  for (const unsafe of [
    'javascript:alert(document.domain)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    './relative-docs',
    '',
  ]) {
    assert.equal(safeUrl(unsafe), '#', `${unsafe} should be rejected`);
  }
});

test('tool modal never renders a malicious docs scheme as a link', () => {
  const { context, getElement } = loadApp();
  const maliciousTool = {
    id: 'malicious-tool',
    name: 'Malicious Tool',
    tagline: 'Test fixture',
    description: 'Untrusted registry entry',
    protocol: 'REST',
    category: 'developer-tools',
    logo_icon: 'server',
    auth: { type: 'none' },
    pricing: { free_tier: true },
    capabilities: [],
    endpoints: {
      docs: 'javascript:alert(document.domain)',
      base_url: 'https://api.example.com',
    },
  };

  vm.runInContext(
    `tools = [${JSON.stringify(maliciousTool)}]; openModal('malicious-tool');`,
    context,
  );

  const cta = getElement('modal-cta').innerHTML;
  assert.match(cta, /href="#"/);
  assert.doesNotMatch(cta, /javascript:/i);
});

test('copyToolJSON degrades cleanly without the Clipboard API and copies with it', async () => {
  const { context } = loadApp();
  const btn = { innerHTML: 'Copy JSON' };
  context.document.querySelector = selector =>
    (selector === '#modal-cta .btn-secondary' ? btn : null);
  vm.runInContext(
    `tools = [{ id: 'demo-tool', name: 'Demo' }];`,
    context,
  );

  // No navigator.clipboard (non-secure context): must not throw, must explain.
  vm.runInContext(`copyToolJSON('demo-tool');`, context);
  assert.match(btn.innerHTML, /Clipboard unavailable/);

  // With a working Clipboard API: copies the tool JSON and confirms.
  btn.innerHTML = 'Copy JSON';
  const written = [];
  context.navigator = { clipboard: { writeText: text => { written.push(text); return Promise.resolve(); } } };
  vm.runInContext(`copyToolJSON('demo-tool');`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(written.length, 1);
  assert.equal(JSON.parse(written[0]).id, 'demo-tool');
  assert.match(btn.innerHTML, /Copied/);
});

test('rapid Copy JSON clicks restore the real label, not a mid-flash one', async () => {
  // A second click inside the flash window used to capture the already-flashed
  // text as the label to restore, leaving the button stuck showing "Copied".
  const { context, runTimers } = loadApp();
  const btn = { innerHTML: 'Copy JSON' };
  context.document.querySelector = selector =>
    (selector === '#modal-cta .btn-secondary' ? btn : null);
  context.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  vm.runInContext(`tools = [{ id: 'demo-tool', name: 'Demo' }];`, context);

  vm.runInContext(`copyToolJSON('demo-tool');`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(btn.innerHTML, /Copied/);

  // Click again while the first flash is still pending.
  vm.runInContext(`copyToolJSON('demo-tool');`, context);
  await new Promise(resolve => setImmediate(resolve));

  runTimers();
  assert.equal(btn.innerHTML, 'Copy JSON',
    'the button must return to its original label after overlapping clicks');
});

test('legacy "box" icon alias renders as package and unknown icons fall back', () => {
  const { context } = loadApp();
  const resolve = value => vm.runInContext(
    `resolveIcon(${JSON.stringify(value)})`,
    context,
  );

  assert.equal(resolve('box'), 'package', 'registry docker-mcp relies on the box→package alias');
  assert.equal(resolve('server'), 'server');
  assert.equal(resolve('not-a-real-icon'), 'box');
  assert.equal(resolve('constructor'), 'box', 'alias lookup must not hit the prototype chain');
});

test('HTML uses no inline event handlers and the skip link is CSS-driven', () => {
  assert.doesNotMatch(indexSource, /\son[a-z]+\s*=/i);
  assert.match(indexSource, /class="skip-link"/);
  assert.doesNotMatch(appSource, /createElement\(['"]style['"]\)/);
});

test('readiness cards link implemented features and label planned features without dead buttons', () => {
  const { context, getElement } = loadApp();
  vm.runInContext('renderReadiness()', context);
  const html = getElement('readiness-grid').innerHTML;
  assert.match(html, /href="\.\/SPEC\.md"/);
  assert.match(html, /href="\.\/create-mcp-server\/README\.md"/);
  assert.equal((html.match(/aria-disabled="true"/g) || []).length, 4);
  assert.doesNotMatch(html, /<button[^>]*class="readiness-btn"/);
});

test('edit hook covers frontend tests and does not suppress pytest collection errors', () => {
  assert.match(hookSource, /app\.js\|index\.html\|style\.css\|base\.css/);
  assert.match(hookSource, /node --test test\/frontend\.test\.js/);
  assert.doesNotMatch(hookSource, /status -eq 4/);
});

test('README requires an HTTP server rather than unsupported file URLs', () => {
  assert.match(readmeSource, /Serve the repository over HTTP/);
  assert.match(readmeSource, /file:\/\//);
  assert.match(readmeSource, /unsupported/);
});
