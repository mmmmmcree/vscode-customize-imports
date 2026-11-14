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
    edit(offset, length, text) {
      source = source.slice(0, offset) + text + source.slice(offset + length); this.version++;
      return { document: this, contentChanges: [{ rangeOffset: offset, rangeLength: length, text }] };
    },
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
    decorations: [], history: [], setDecorations(type, ranges) { this.decorations = ranges; this.history.push(ranges.map(range => active.getText(range))); } };
  const values = { colorTheme: 'Dark 2026 + One Dark Pro', cppConceptHighlighting: true };
  const decorations = new Map();
  const history = new Map();
  const calls = [];
  const legendCalls = [];
  let disposed = false;
  const vscode = {
    Range,
    DecorationRangeBehavior: { ClosedClosed: 1 },
    window: {
      visibleTextEditors: [editor],
      createTextEditorDecorationType: options => {
        assert.ok(['#7ec8b5', '#e06c75'].includes(options.color)); assert.equal(options.rangeBehavior, 1);
        return { color: options.color, dispose() { disposed = true; } };
      },
      onDidChangeVisibleTextEditors: on('editors'), onDidChangeTextEditorVisibleRanges: on('scroll'), onDidChangeActiveTextEditor: on('active'),
    },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }),
      openTextDocument: async uri => definitions.find(doc => doc.uri.toString() === uri.toString()),
      onDidChangeTextDocument: on('text'), onDidCloseTextDocument: on('close'), onDidChangeConfiguration: on('configuration'),
    },
    languages: { onDidChangeDiagnostics: on('diagnostics'), registerDocumentSemanticTokensProvider() { assert.fail('Must preserve the existing language service provider'); } },
    extensions: { onDidChange: on('extensions') },
    commands: { executeCommand: async (command, uri, position) => {
      if (command === 'vscode.provideDocumentSemanticTokensLegend') {
        legendCalls.push(uri);
        if (values.legendBarrier) await values.legendBarrier;
        return { tokenTypes: [...(values.nativeConceptTokens ? ['class', 'concept'] : ['class', 'templateType']),
          ...(values.nativeParameterTokens ? ['typeParameter', 'parameter'] : [])] };
      }
      assert.equal(command, 'vscode.executeDefinitionProvider');
      calls.push(position);
      return provider ? provider(active, position) : definitions.map(doc => ({ uri: doc.uri, range: doc.range('dispatch_source_c') }));
    } },
  };
  const setDecorations = editor.setDecorations.bind(editor);
  editor.setDecorations = (type, ranges) => {
    decorations.set(type.color, ranges);
    if (!history.has(type.color)) history.set(type.color, []);
    history.get(type.color).push(ranges.map(range => active.getText(range)));
    if (type.color === '#7ec8b5') setDecorations(type, ranges);
  };
  return { active, editor, calls, legendCalls, values, vscode, listeners, history, disposed: () => disposed,
    emit: (name, event) => listeners.get(name)?.(event),
    words: () => editor.decorations.map(range => active.getText(range)),
    parameterWords: () => (decorations.get('#e06c75') || []).map(range => active.getText(range)),
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

test('template parameter syntax distinguishes certain kinds and leaves named constraints ambiguous', () => {
  const source = `template <ns::queue_c<int>... Queues, DrainDirection direction = from_front,
    typename T, class... Ts, int Count = (1 < 2), auto Value, const Color& Ref,
    queue_c auto Object, typename T::Value Dependent, void (*Fn)(int)> void f();`;
  assert.deepEqual(analyze(source).parameters.map(({ name, kind, head }) => [name.text, kind, head?.text]), [
    ['Queues', 'unknown', 'queue_c'], ['direction', 'unknown', 'DrainDirection'],
    ['T', 'type', undefined], ['Ts', 'type', undefined], ['Count', 'value', undefined],
    ['Value', 'value', undefined], ['Ref', 'value', 'Color'], ['Object', 'value', 'queue_c'],
    ['Dependent', 'value', 'Value'],
  ]);
  assert.equal(analyze('// template<int Fake>\nconst char* s = "template<int AlsoFake>";').parameters.length, 0);
});

test('a constrained Queue stays a type while direction confirmed as an enum value gets parameter color', async t => {
  const header = document('types.hpp', 'template<class T> concept queue_c = true;\nenum class DrainDirection { from_front };');
  const state = host('template<queue_c Queue, DrainDirection direction = from_front> class DrainView {};', [header], async (doc, position) => {
    const name = doc.getText().slice(doc.offsetAt(position)).match(/^\w+/)[0];
    return [{ targetUri: header.uri, targetSelectionRange: header.range(name) }];
  });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5', '#e06c75');
  t.after(() => subscription.dispose());
  await until(() => state.parameterWords().includes('direction'));
  assert.deepEqual(state.words(), ['queue_c']);
  assert.deepEqual(state.parameterWords(), ['direction']);
  assert.equal(state.calls.length, 2, 'Concept and value classification share one definition request per head');
  state.emit('scroll');
  await delay(300);
  assert.equal(state.calls.length, 2);
  assert.equal(state.history.get('#e06c75').length, 2, 'Scrolling leaves stable parameter decorations in place');
});

test('builtin value parameters need no definition queries and complex declarators retain native colors', async t => {
  const state = host('template<int Count, auto Value, class T, void (*Fn)(int)> void f();', []);
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5', '#e06c75');
  t.after(() => subscription.dispose());
  await until(() => state.parameterWords().length === 2);
  assert.deepEqual(state.parameterWords(), ['Count', 'Value']);
  assert.equal(state.calls.length, 0);
});

test('native parameter classification bypasses the template fallback without suppressing concept fallback', async t => {
  const header = document('concepts.hpp', 'template<class T> concept queue_c = true;');
  const state = host('template<queue_c Queue, int Count> void f();', [header], async () => [{ uri: header.uri, range: header.range('queue_c') }]);
  state.values.nativeParameterTokens = true;
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5', '#e06c75');
  t.after(() => subscription.dispose());
  await until(() => state.words().includes('queue_c'));
  assert.deepEqual(state.parameterWords(), []);
  assert.equal(state.calls.length, 1);
});

test('template fallback remains independent of concept coloring and hands over to a native provider', async t => {
  const header = document('types.hpp', 'enum class DrainDirection { from_front };');
  const state = host('template<DrainDirection direction = from_front, int Count> void f();', [header], async () => [{ uri: header.uri, range: header.range('DrainDirection') }]);
  state.values.cppConceptHighlighting = false;
  state.values.nativeConceptTokens = true;
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5', '#e06c75');
  t.after(() => subscription.dispose());
  await until(() => state.parameterWords().length === 2);
  assert.deepEqual(state.words(), []);
  state.values.cppTemplateParameterHighlighting = false;
  state.emit('configuration', { affectsConfiguration: name => name === 'dark2026OneDarkPro.cppTemplateParameterHighlighting' });
  await until(() => state.parameterWords().length === 0);
  state.values.cppTemplateParameterHighlighting = true;
  state.values.nativeParameterTokens = true;
  state.emit('configuration', { affectsConfiguration: name => name === 'editor.semanticHighlighting.enabled' });
  await delay(300);
  assert.deepEqual(state.parameterWords(), []);
  assert.equal(state.calls.length, 1);
});

test('value parameter colors survive edits and slow indexing, but a type becoming a concept removes value color', async t => {
  const header = document('types.hpp', 'enum class DrainDirection { from_front };');
  let ready = true;
  const state = host('template<DrainDirection direction = from_front> void f();', [header], async () => {
    await delay(100);
    return ready ? [{ uri: header.uri, range: header.range('DrainDirection') }] : [];
  });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5', '#e06c75');
  t.after(() => subscription.dispose());
  await until(() => state.parameterWords().length === 1);
  ready = false;
  state.editor.visibleRanges = [new Range({ line: 0, character: 0 }, { line: 3, character: 100 })];
  state.emit('text', state.active.edit(0, 0, '// shifted\n'));
  assert.deepEqual(state.parameterWords(), ['direction']);
  await delay(400);
  assert.deepEqual(state.parameterWords(), ['direction']);
  ready = true;
  const old = header.getText();
  const event = header.edit(0, old.length, 'template<class T> concept DrainDirection = true;');
  state.emit('text', event);
  assert.deepEqual(state.parameterWords(), []);
  await until(() => state.words().includes('DrainDirection'));
  assert.deepEqual(state.parameterWords(), []);
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
  state.emit('configuration', { affectsConfiguration: name => name === 'workbench.colorTheme' });
  await until(() => state.words().length === 0);
  state.values.colorTheme = 'Dark 2026 + One Dark Pro';
  state.emit('configuration', { affectsConfiguration: name => name === 'workbench.colorTheme' });
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

test('only visible candidates are queried, at most 64 per refresh, and confirmed ranges survive scrolling', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  const state = host('template<dispatch_source_c T> void run();\n'.repeat(80), [header]);
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.words().length === 64);
  assert.equal(state.calls.length, 64);
  state.editor.visibleRanges = [new Range({ line: 70, character: 0 }, { line: 70, character: 100 })];
  state.emit('scroll');
  await until(() => state.words().length === 65);
  assert.equal(state.calls.length, 65);
  state.values.cppConceptHighlighting = false;
  state.emit('configuration', { affectsConfiguration: name => name === 'dark2026OneDarkPro.cppConceptHighlighting' });
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

test('native concept tokens bypass supplementary queries and decorations', async t => {
  const state = host('template<class T> concept Native = true;\ntemplate<Native T> void run();', []);
  state.values.nativeConceptTokens = true;
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.legendCalls.length === 1);
  await delay(30);
  assert.equal(state.calls.length, 0);
  assert.deepEqual(state.words(), []);
});

test('editing before a confirmed constraint keeps its color during slow revalidation and scrolling', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let slow = false;
  const state = host('template<dispatch_source_c T> void run();', [header], async () => {
    if (slow) await pending;
    return [{ uri: header.uri, range: header.range('dispatch_source_c') }];
  });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => { release(); subscription.dispose(); });
  await until(() => state.words().length === 1);
  const before = state.editor.history.length;
  slow = true;
  const edit = state.active.edit(0, 0, '// inserted heading\n');
  state.editor.visibleRanges = [new Range(state.active.positionAt(0), state.active.positionAt(state.active.getText().length))];
  state.emit('text', edit);
  assert.deepEqual(state.words(), ['dispatch_source_c']);
  await until(() => state.calls.length === 2);
  await delay(50);
  assert.deepEqual(state.words(), ['dispatch_source_c']);
  release();
  await delay(50);
  const painted = state.editor.history.length;
  state.emit('scroll');
  await delay(300);
  assert.equal(state.editor.history.length, painted, 'Identical ranges do not cause repainting');
  assert.ok(state.editor.history.slice(before).every(words => words.includes('dispatch_source_c')));
  assert.equal(state.calls.length, 2);
});

test('temporary indexing misses retain confirmed color, but a resolved class removes it', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  const concrete = document('types.hpp', 'struct dispatch_source_c {};');
  let mode = 'concept';
  const state = host('template<dispatch_source_c T> void run();', [header, concrete], async () => {
    if (mode === 'pending') return [];
    const target = mode === 'concept' ? header : concrete;
    return [{ uri: target.uri, range: target.range('dispatch_source_c') }];
  });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.words().length === 1);
  mode = 'pending';
  const before = state.editor.history.length;
  state.emit('text', state.active.edit(state.active.getText().length, 0, '\n'));
  await until(() => state.calls.length === 2);
  await delay(30);
  assert.deepEqual(state.words(), ['dispatch_source_c']);
  assert.ok(state.editor.history.slice(before).every(words => words.includes('dispatch_source_c')));
  mode = 'class';
  state.emit('diagnostics', { uris: [state.active.uri] });
  await until(() => state.words().length === 0);
});

test('editing the identifier removes the old mark instead of coloring its replacement', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;\nstruct Color {};');
  const state = host('template<dispatch_source_c T> void run();', [header], async (doc, position) => {
    const name = doc.getText().slice(doc.offsetAt(position)).match(/^\w+/)[0];
    return [{ uri: header.uri, range: header.range(name) }];
  });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.words().length === 1);
  state.emit('text', state.active.edit(state.active.getText().indexOf('dispatch_source_c'), 'dispatch_source_c'.length, 'Color'));
  assert.deepEqual(state.words(), []);
  await until(() => state.calls.length === 2);
  await delay(30);
  assert.deepEqual(state.words(), []);
});

test('header edits track surviving definitions and remove a deleted concept immediately', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  const state = host('template<dispatch_source_c T> void run();', [header]);
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.words().length === 1);
  const before = state.editor.history.length;
  state.emit('text', header.edit(0, 0, '// documentation\n'));
  assert.deepEqual(state.words(), ['dispatch_source_c']);
  await until(() => state.calls.length === 2);
  await delay(30);
  assert.ok(state.editor.history.slice(before).every(words => words.includes('dispatch_source_c')));
  state.emit('text', header.edit(header.getText().indexOf('concept'), 'concept'.length, 'struct'));
  assert.deepEqual(state.words(), []);
});

test('a newly available native concept provider takes over after diagnostics', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  const state = host('template<dispatch_source_c T> void run();', [header]);
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => subscription.dispose());
  await until(() => state.words().length === 1);
  state.values.nativeConceptTokens = true;
  state.emit('diagnostics', { uris: [state.active.uri] });
  await until(() => state.words().length === 0);
  assert.equal(state.calls.length, 1, 'Native takeover needs no additional definition requests');
});

test('editing during the initial native capability check still schedules current highlighting', async t => {
  const header = document('concepts.hpp', 'template<class T> concept dispatch_source_c = true;');
  const state = host('template<dispatch_source_c T> void run();', [header]);
  let release;
  state.values.legendBarrier = new Promise(resolve => { release = resolve; });
  const subscription = registerConceptHighlighting(state.vscode, '#7ec8b5');
  t.after(() => { release(); subscription.dispose(); });
  await until(() => state.legendCalls.length === 1);
  state.emit('text', state.active.edit(state.active.getText().length, 0, '\n'));
  release();
  await until(() => state.words().length === 1);
  assert.deepEqual(state.words(), ['dispatch_source_c']);
  assert.equal(state.calls.length, 1);
});
