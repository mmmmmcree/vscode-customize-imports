'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { updateCustomCSS, validWorkbench, clearPatches, withWorkbenchLock, resolveImport } = require('../custom-css');

const native = '<!DOCTYPE html><html><head><link rel="stylesheet" href="native.css"></head><body></body><script src="./workbench.js" type="module"></script></html>';

async function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'custom-css-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('custom-css-test-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const appRoot = path.join(root, 'app');
  const workbench = path.join(appRoot, 'out/vs/code/electron-browser/workbench/workbench.html');
  await fs.mkdir(path.dirname(workbench), { recursive: true });
  await fs.writeFile(workbench, native);
  const values = { imports: [], statusbar: false };
  const notices = [];
  const vscode = {
    env: { appRoot, language: 'en' },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) },
    extensions: { getExtension: () => undefined },
    window: {
      showInformationMessage: async message => { notices.push(message); },
      showWarningMessage: async message => { notices.push(message); },
    },
    commands: { executeCommand: () => assert.fail('The non-atomic legacy Loader command must not be called.') },
  };
  return { root, workbench, values, vscode, notices };
}

test('concurrent effect updates serialize their import changes and never expose an empty workbench', async t => {
  const state = await fixture(t);
  const first = path.join(state.root, 'first.js');
  const second = path.join(state.root, 'second.js');
  await fs.writeFile(first, 'window.firstEffect = true;');
  await fs.writeFile(second, 'window.secondEffect = true;');
  let reading = true, samples = 0, running = 0, maximum = 0;
  const reader = (async () => {
    while (reading) {
      const html = await fs.readFile(state.workbench, 'utf8');
      assert.ok(validWorkbench(html), 'every on-disk snapshot has its bootstrap');
      samples++;
    }
  })();
  try {
    await Promise.all([first, second].map(file => updateCustomCSS(state.vscode, async () => {
      running++; maximum = Math.max(maximum, running);
      const imports = [...state.values.imports];
      await delay(70);
      imports.push(pathToFileURL(file).toString());
      state.values.imports = imports;
      running--;
    })));
  } finally { reading = false; await reader; }
  assert.equal(maximum, 1);
  assert.ok(samples > 0);
  const html = await fs.readFile(state.workbench, 'utf8');
  assert.match(html, /window.firstEffect = true/);
  assert.match(html, /window.secondEffect = true/);
  assert.equal(html.match(/VSCODE-CUSTOM-CSS-START/g).length, 1);
  assert.equal(html.match(/src="\.\/workbench.js"/g).length, 1);
  assert.equal(clearPatches(html), native);
});

test('the update lock also serializes separate extension-host processes', async t => {
  const state = await fixture(t);
  const log = path.join(state.root, 'events.jsonl');
  const worker = path.join(state.root, 'worker.js');
  await fs.writeFile(worker, `
    const fs = require('node:fs/promises');
    const { withWorkbenchLock } = require(process.argv[2]);
    withWorkbenchLock(process.argv[3], async () => {
      await fs.appendFile(process.argv[4], JSON.stringify(['start', process.pid]) + '\\n');
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.appendFile(process.argv[4], JSON.stringify(['end', process.pid]) + '\\n');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `);
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, path.resolve(__dirname, '../custom-css.js'), state.workbench, log], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([run(), run()]);
  const events = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(event => event[0]), ['start', 'end', 'start', 'end']);
  assert.equal(events[0][1], events[1][1]);
  assert.equal(events[2][1], events[3][1]);
  assert.notEqual(events[0][1], events[2][1]);
});

test('an interrupted empty workbench is recovered from a valid backup before applying effects', async t => {
  const state = await fixture(t);
  await fs.writeFile(state.workbench, '');
  await fs.writeFile(path.join(path.dirname(state.workbench), 'workbench.empty.bak-custom-css'), '');
  await fs.writeFile(path.join(path.dirname(state.workbench), 'workbench.good.bak-custom-css'), native);
  await updateCustomCSS(state.vscode);
  const html = await fs.readFile(state.workbench, 'utf8');
  assert.ok(validWorkbench(html));
  assert.equal(clearPatches(html), native);
});

test('preparation failures and unreadable required effects leave the working HTML untouched and release the lock', async t => {
  const state = await fixture(t);
  await assert.rejects(updateCustomCSS(state.vscode, async () => { throw new Error('source generation failed'); }), /source generation failed/);
  assert.equal(await fs.readFile(state.workbench, 'utf8'), native);
  state.values.imports = [pathToFileURL(path.join(state.root, 'missing.js')).toString()];
  await assert.rejects(updateCustomCSS(state.vscode, async () => ({ requiredMarker: 'required-effect-marker' })), /required effect could not be loaded/);
  assert.equal(await fs.readFile(state.workbench, 'utf8'), native);
  assert.equal(await fs.stat(state.workbench + '.customize-imports.lock').then(() => true, () => false), false);
  state.values.imports = [];
  await updateCustomCSS(state.vscode);
  assert.ok(validWorkbench(await fs.readFile(state.workbench, 'utf8')));
});

test('unsafe existing markup is rejected without replacing the workbench', async t => {
  const state = await fixture(t);
  const incomplete = native.replace('</head>', '<!-- !! VSCODE-CUSTOM-CSS-START !! --></head>');
  await fs.writeFile(state.workbench, incomplete);
  await assert.rejects(updateCustomCSS(state.vscode), /injection is incomplete/);
  assert.equal(await fs.readFile(state.workbench, 'utf8'), incomplete);
});

test('replacement tokens and quoted closing tags survive inline injection without damaging the bootstrap', async t => {
  const state = await fixture(t);
  const literals = ['$&', '$`', "$'", '<script>', '</script>'];
  const source = 'globalThis.literals = ' + JSON.stringify(literals) + ';';
  const file = path.join(state.root, 'literal.js');
  await fs.writeFile(file, source);
  state.values.imports = [pathToFileURL(file).toString()];
  await updateCustomCSS(state.vscode);
  const html = await fs.readFile(state.workbench, 'utf8');
  const script = [...html.matchAll(/<script type="text\/plain" data-customize-imports-pending>([\s\S]*?)<\/script>/g)][0][1];
  const sandbox = {};
  vm.runInNewContext(script, sandbox);
  assert.equal(JSON.stringify(sandbox.literals), JSON.stringify(literals));
  assert.equal(clearPatches(html), native);
});

test('effect scripts stay inert until the native shell is ready and activate once in import order', async t => {
  const state = await fixture(t);
  for (const name of ['first', 'second']) {
    const file = path.join(state.root, name + '.js');
    await fs.writeFile(file, `globalThis.order.push('${name}');`);
    state.values.imports.push(pathToFileURL(file).toString());
  }
  await updateCustomCSS(state.vscode);
  const html = await fs.readFile(state.workbench, 'utf8');
  const pending = [...html.matchAll(/<script type="text\/plain" data-customize-imports-pending>([\s\S]*?)<\/script>/g)];
  assert.equal(pending.length, 2);
  const bootstrap = html.match(/<script data-customize-imports-bootstrap>([\s\S]*?)<\/script>/)[1];
  const frames = [], timers = new Map(), order = [];
  let load, mutation, shellReady = false, disconnected = false, timer = 0;
  const sandbox = { order,
    window: { addEventListener: (name, handler) => { assert.equal(name, 'load'); load = handler; } },
    document: {
      readyState: 'loading', body: {},
      querySelector: () => shellReady,
      querySelectorAll: () => pending.map(match => ({ textContent: match[1], replaceWith: script => vm.runInNewContext(script.textContent, sandbox) })),
      createElement: name => { assert.equal(name, 'script'); return {}; },
    },
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: (callback, timeout) => { const id = ++timer; timers.set(id, { callback, timeout }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(bootstrap, sandbox);
  assert.deepEqual(order, [], 'Parsing the head must not run custom scripts');
  order.push('native'); load();
  assert.deepEqual(order, ['native'], 'A load event without a workbench must not start effects');
  shellReady = true; mutation();
  assert.ok(disconnected);
  assert.deepEqual(order, ['native']);
  frames.shift()(); frames.shift()();
  const scheduled = [...timers.values()];
  scheduled.find(value => value.timeout === 0).callback();
  scheduled.find(value => value.timeout === 500).callback();
  assert.deepEqual(order, ['native', 'first', 'second'], 'Fallback and frame callbacks must not duplicate activation');
  assert.equal(clearPatches(html), native);
});

test('backups retain the Loader session format and its indicator is not duplicated', async t => {
  const state = await fixture(t);
  const loaderRoot = path.join(state.root, 'loader');
  await fs.mkdir(path.join(loaderRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(loaderRoot, 'src/statusbar.js'), '/* eslint-env browser */\nwindow.__CUSTOM_CSS_JS_INDICATOR_CLS = true;');
  state.vscode.extensions.getExtension = () => ({ extensionPath: loaderRoot });
  state.values.statusbar = true;
  await updateCustomCSS(state.vscode);
  await updateCustomCSS(state.vscode);
  const html = await fs.readFile(state.workbench, 'utf8');
  const session = html.match(/VSCODE-CUSTOM-CSS-SESSION-ID ([\w-]+)/)[1];
  assert.equal(await fs.readFile(path.join(path.dirname(state.workbench), `workbench.${session}.bak-custom-css`), 'utf8'), native);
  assert.equal(html.match(/__CUSTOM_CSS_JS_INDICATOR_CLS/g).length, 1);
  assert.equal(clearPatches(html), native);
});

test('an idempotent readiness check does not rewrite the application', async t => {
  const state = await fixture(t);
  const result = await updateCustomCSS(state.vscode, async () => false);
  assert.equal(result.applied, false);
  assert.equal(await fs.readFile(state.workbench, 'utf8'), native);
  assert.equal(state.notices.length, 0);
});

test('a busy lock fails safely without stealing ownership or changing the application', async t => {
  const state = await fixture(t);
  const lock = state.workbench + '.customize-imports.lock';
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(withWorkbenchLock(state.workbench, () => assert.fail('must not enter'), 50), /update is in progress or was interrupted/);
  assert.equal(await fs.readFile(state.workbench, 'utf8'), native);
  assert.deepEqual(JSON.parse(await fs.readFile(lock, 'utf8')), { pid: process.pid });
});

test('file import variables retain Loader-compatible expansion', () => {
  const key = 'CUSTOMIZE_IMPORTS_RESOURCE_TEST';
  const old = process.env[key];
  process.env[key] = 'asset';
  try {
    assert.equal(resolveImport('file:///root/${env:CUSTOMIZE_IMPORTS_RESOURCE_TEST}/x.js', { workspace: {} }), 'file:///root/asset/x.js');
    assert.equal(resolveImport('https://example.invalid/${userHome}/x.js', { workspace: {} }), 'https://example.invalid/${userHome}/x.js');
  } finally {
    if (old === undefined) delete process.env[key]; else process.env[key] = old;
  }
});
