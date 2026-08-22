import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');

function loadApp() {
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
    setTimeout() {},
  });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return { context, getElement };
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
