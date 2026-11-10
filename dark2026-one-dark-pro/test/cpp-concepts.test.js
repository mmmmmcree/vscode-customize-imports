'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { analyze, registerConceptHighlighting } = require('../src/cpp-concepts');

class Range {
  constructor(start, end) { this.start = start; this.end = end; }
  intersection(other) {
    const compare = (a, b) => a.line - b.line || a.character - b.character;
    return compare(this.start, other.end) <= 0 && compare(this.end, other.start) >= 0 ? this : undefined;
  }
}

function document(name, source) {
  return {
    uri: { toString: () => `file:///${name}` }, languageId: 'cpp', version: 1,
    getText(range) { return range ? source.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : source; },
    positionAt(offset) { const lines = source.slice(0, offset).split('\n'); return { line: lines.length - 1, character: lines.at(-1).length }; },
    offsetAt(position) { return source.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character; },
    replace(value) { source = value; this.version++; },
    range(name) { const start = source.indexOf(name); return new Range(this.positionAt(start), this.positionAt(start + name.length)); },
  };
}

function host(source, definitions, provider) {
  const active = document('main.cpp', source);
  const listeners = new Map();
  const on = name => callback => {
    listeners.set(name, callback);
    return { dispose() { listeners.delete(name); } };
  };
  const editor = { document: active, visibleRanges: [new Range(active.positionAt(0), active.positionAt(source.length))],
    decorations: [], setDecorations(type, ranges) { this.decorations = ranges; } };
  const values = { colorTheme: 'Dark 2026 + One Dark Pro', cppConceptHighlighting: true };
  const calls = [];
  let disposed = false;
  const vscode = {
    Range,
    window: {
      visibleTextEditors: [editor],
      createTextEditorDecorationType: options => { assert.equal(options.color, '#7ec8b5'); return { dispose() { disposed = true; } }; },
      onDidChangeVisibleTextEditors: on('editors'), onDidChangeTextEditorVisibleRanges: on('scroll'), onDidChangeActiveTextEditor: on('active'),
    },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }),
      openTextDocument: async uri => definitions.find(doc => doc.uri.toString() === uri.toString()),
      onDidChangeTextDocument: on('text'), onDidCloseTextDocument: on('close'), onDidChangeConfiguration: on('configuration'),
    },
    languages: { onDidChangeDiagnostics: on('diagnostics') },
    commands: { executeCommand: async (command, uri, position) => {
      assert.equal(command, 'vscode.executeDefinitionProvider');
      calls.push(position);
      return provider ? provider(active, position) : definitions.map(doc => ({ uri: doc.uri, range: doc.range('dispatch_source_c') }));
    } },
  };
  return { active, editor, calls, values, vscode, listeners, disposed: () => disposed,
    emit: (name, event) => listeners.get(name)?.(event),
    words: () => editor.decorations.map(range => active.getText(range)),
  };
}

async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Asynchronous highlighting timed out');
    await delay(10);
  }
}

test('template candidates cover constrained names, qualification, packs and nested/default arguments', () => {
  const source = `template <dispatch_source_c Inputs, typename Router, ns::Other<int>... Rest,
    template<class> class Container, int Count = (1 < 2), Color Value> void run();`;
  assert.deepEqual(analyze(source).candidates.map(token => token.text), ['dispatch_source_c', 'Other', 'Color']);
  assert.deepEqual(analyze('template<class T> concept dispatch_source_c = true;').declarations.map(token => token.text), ['dispatch_source_c']);
});

test('comments, continued macros, strings and digit separators preserve candidate offsets', () => {
  const source = `// template<Fake T>
/* concept Fake = true; */
#define CONSTRAINT \\
  template<Macro_c T>
const char* text = R"tag(template<Raw_c T> "nested")tag";
auto n = 1'000'000;
template <dispatch_source_c Inputs, typename Router> void run();`;
  const parsed = analyze(source);
  assert.equal(parsed.declarations.length, 0);
  assert.deepEqual(parsed.candidates.map(token => token.text), ['dispatch_source_c']);
  assert.equal(source.slice(parsed.candidates[0].start, parsed.candidates[0].end), 'dispatch_source_c');
});

test('Go to Definition confirms a concept in a header and leaves a concrete non-type parameter alone', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;\nstruct Color {};');
  const state = host('template <dispatch_source_c Inputs, typename Router, Color Value> void run();', [header], async (doc, position) => {
    const name = doc.getText().slice(doc.offsetAt(position)).match(/^\w+/)[0];
    return [{ targetUri: header.uri, targetSelectionRange: header.range(name) }];
  });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.words().includes('dispatch_source_c'));
  assert.deepEqual(state.words(), ['dispatch_source_c']);
  assert.equal(state.calls.length, 2);
  state.emit('scroll');
  await delay(300);
  assert.equal(state.calls.length, 2, 'Concept and concrete type results are cached across scrolling');
  state.emit('diagnostics', { uris: [{ toString: () => 'file:///unrelated.cpp' }] });
  await delay(300);
  assert.equal(state.calls.length, 2, 'Unrelated background diagnostics do not query definitions');
  state.values.colorTheme = 'Dark Modern';
  state.emit('configuration', { affectsConfiguration: () => true });
  await until(() => state.words().length === 0);
  state.values.colorTheme = 'Dark 2026 + One Dark Pro';
  state.emit('configuration', { affectsConfiguration: () => true });
  await until(() => state.words().length === 1);
  assert.equal(state.calls.length, 2);
  header.replace('struct dispatch_source_c {};\nstruct Color {};');
  state.emit('text', { document: header });
  await until(() => state.calls.length === 4);
  await until(() => state.words().length === 0);
});

test('definition results for an identically named class do not pick a concept from another namespace', async t => {
  const header = document('types.hpp', 'namespace a { struct dispatch_source_c {}; }\nnamespace b { template<class T> concept dispatch_source_c = true; }');
  const state = host('template<a::dispatch_source_c Value> void run();', [header]);
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.calls.length === 1);
  await delay(30);
  assert.deepEqual(state.words(), []);
});

test('only visible candidates are queried, at most 64 per refresh, and disabled highlighting is cleared', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  const state = host('template<dispatch_source_c T> void run();\n'.repeat(80), [header]);
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.words().length === 64);
  assert.equal(state.calls.length, 64);
  state.editor.visibleRanges = [new Range({ line: 70, character: 0 }, { line: 70, character: 100 })];
  state.emit('scroll');
  await until(() => state.words().length === 1);
  assert.equal(state.calls.length, 65);
  state.values.cppConceptHighlighting = false;
  state.emit('configuration', { affectsConfiguration: () => true });
  await until(() => state.words().length === 0);
  assert.equal(state.calls.length, 65);
});

test('provider requests remain limited to four even when an edit invalidates pending work', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  let running = 0, maximum = 0;
  const state = host('template<dispatch_source_c T> void run();\n'.repeat(8), [header], async () => {
    running++; maximum = Math.max(maximum, running);
    await delay(350);
    running--;
    return [{ uri: header.uri, range: header.range('dispatch_source_c') }];
  });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => running === 4);
  state.active.replace(state.active.getText() + '\n');
  state.emit('text', { document: state.active });
  await until(() => state.words().length === 8);
  assert.equal(maximum, 4);
  assert.equal(state.calls.length, 12);
  subscription.dispose();
  assert.equal(state.disposed(), true);
  assert.equal(state.listeners.size, 0);
});
