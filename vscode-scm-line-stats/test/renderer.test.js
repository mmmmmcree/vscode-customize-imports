'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { managedImport, ensureRenderer, bundleRenderer } = require('../src/renderer');
const { createStrings } = require('../media/strings');

test('installed renderer is registered as one stable bundle and applied idempotently', async t => {
  const parent = path.resolve(__dirname, '../test-results');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'renderer-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const workbench = path.join(root, 'app/out/vs/code/electron-browser/workbench/workbench.html');
  await fs.mkdir(path.dirname(workbench), { recursive: true });
  await fs.writeFile(workbench, '<html><head></head><body></body></html>');
  const values = { presentation: 'native', displayMode: 'hover', imports: [
    'file:///keep/existing.js',
    'file:///extensions/local-tools.scm-line-stats-0.2.1/media/strings.js',
    'file:///extensions/local-tools.scm-line-stats-0.2.1/media/native-hover.js',
  ] };
  const uri = filePath => ({ fsPath: filePath, scheme: 'file', toString: () => pathToFileURL(filePath).toString() });
  const config = { get: (key, fallback) => values[key] ?? fallback, update: async (key, value) => { values[key] = value; } };
  let calls = 0;
  let failToApply = false;
  const vscode = {
    env: { language: 'zh-cn', appRoot: path.join(root, 'app') },
    workspace: { getConfiguration: () => config },
    ConfigurationTarget: { Global: 1 },
    extensions: { getExtension: () => ({ activate: async () => {} }) },
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    commands: { executeCommand: async command => {
      assert.equal(command, 'extension.updateCustomCSS');
      calls++;
      if (failToApply) return;
      const bundle = await fs.readFile(new URL(values.imports[1]), 'utf8');
      await fs.writeFile(workbench, `<html><head><script>${bundle}</script></head><body></body></html>`);
    } },
  };
  const options = { vscode, context: {
    extensionUri: uri(path.resolve(__dirname, '..')),
    globalStorageUri: { ...uri(path.join(root, 'storage/local-tools.scm-line-stats')), scheme: 'vscode-userdata', toString: () => 'vscode-userdata:/storage/local-tools.scm-line-stats' },
  }, text: createStrings('en'), output: { appendLine() {} } };
  const first = await ensureRenderer(options);
  assert.equal(first.state, 'reload-required');
  assert.equal(calls, 1);
  assert.equal(values.imports.length, 2);
  assert.equal(values.imports[0], 'file:///keep/existing.js');
  assert.match(values.imports[1], /^file:/);
  assert.match(values.imports[1], /local-tools.scm-line-stats\/native-hover.js$/);
  const source = await fs.readFile(new URL(values.imports[1]), 'utf8');
  assert.match(source, /scmLineStatsDisplayLanguage = "zh-cn"/);
  assert.match(source, /DOMContentLoaded/);
  assert.match(source, /sl-bar-add/);
  assert.equal((await ensureRenderer(options)).state, 'ready');
  assert.equal(calls, 1);
  values.displayMode = 'inline';
  assert.equal((await ensureRenderer(options)).state, 'disabled');
  await ensureRenderer({ ...options, resetMode: true });
  assert.equal(values.displayMode, 'hover');
  assert.equal(values.presentation, 'native');
  assert.equal(calls, 1);
  await fs.writeFile(workbench, '<html><head></head></html>');
  failToApply = true;
  await assert.rejects(ensureRenderer(options), /colored hover renderer/);
});

test('bundle carries both language resources and drawing code from the shipped files', async () => {
  const bundle = await bundleRenderer(path.resolve(__dirname, '..'), 'en');
  assert.ok(bundle.source.includes(bundle.marker));
  assert.match(bundle.source, /createStrings/);
  assert.match(bundle.source, /DOMContentLoaded/);
  assert.match(bundle.source, /sl-added/);
  assert.match(bundle.source, /sl-deleted/);
  assert.match(bundle.source, /sl-bar-add/);
  assert.match(bundle.source, /sl-bar-del/);
});

test('malformed and unrelated loader imports are preserved', () => {
  assert.equal(managedImport('file:///existing/script.js', 'file:///current.js'), false);
  assert.equal(managedImport('file:///%broken', 'file:///current.js'), false);
  assert.equal(managedImport(null, 'file:///current.js'), false);
  assert.equal(managedImport('file:///globalStorage/local-tools.scm-line-stats/native-hover.js', ''), true);
});
