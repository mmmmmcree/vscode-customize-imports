'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { enumTypeSeeds, registerEnumTypeHighlighting } = require('../src/cpp-enums');
const enumColor = require('../themes/dark2026-one-dark-pro-color-theme.json').semanticTokenColors['enum:cpp'].foreground;

class Range { constructor(start, end) { this.start = start; this.end = end; } }
function host(source, provider) {
  const document = {
    uri: { toString: () => 'file:///drain.h' }, languageId: 'cpp', version: 1,
    getText(range) { return range ? source.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : source; },
    positionAt(offset) { const lines = source.slice(0, offset).split('\n'); return { line: lines.length - 1, character: lines.at(-1).length }; },
    offsetAt(position) { return source.split('\n').slice(0, position.line).reduce((size, line) => size + line.length + 1, 0) + position.character; },
    edit(offset, length, text) { source = source.slice(0, offset) + text + source.slice(offset + length); this.version++; return { document: this, contentChanges: [{ rangeOffset: offset, rangeLength: length, text }] }; },
    ranges(word) { return [...source.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map(match => new Range(this.positionAt(match.index), this.positionAt(match.index + word.length))); },
  };
  const listeners = new Map(), calls = [], history = [];
  const on = name => callback => { listeners.set(name, callback); return { dispose() { listeners.delete(name); } }; };
  const values = { colorTheme: 'Dark 2026 + One Dark Pro', cppEnumTypeHighlighting: true, nativeEnums: false };
  let disposed = false;
  const editor = { document, decorations: [], setDecorations(type, ranges) { this.decorations = ranges; history.push(ranges.map(range => document.getText(range))); } };
  const vscode = {
    Range, DecorationRangeBehavior: { ClosedClosed: 1 },
    window: { visibleTextEditors: [editor],
      createTextEditorDecorationType(options) { assert.equal(options.color, enumColor); assert.equal(options.rangeBehavior, 1); return { dispose() { disposed = true; } }; },
      onDidChangeVisibleTextEditors: on('editors'), onDidChangeTextEditorVisibleRanges: on('scroll'), onDidChangeActiveTextEditor: on('active') },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }),
      onDidChangeTextDocument: on('text'), onDidCloseTextDocument: on('close'), onDidChangeConfiguration: on('config') },
    extensions: { onDidChange: on('extensions') },
    languages: { onDidChangeDiagnostics: on('diagnostics'), registerDocumentSemanticTokensProvider() { assert.fail('Must not replace cpptools'); } },
    commands: { async executeCommand(command, uri, position) {
      if (command === 'vscode.provideDocumentSemanticTokensLegend') return { tokenTypes: values.nativeEnums ? ['type', 'enum'] : ['type', 'enumMember'] };
      assert.equal(command, 'vscode.executeDocumentHighlights', 'Use symbol highlights without requesting the native semantic token stream');
      calls.push(position);
      return provider ? provider(document, position) : document.ranges('DrainDirection').map(range => ({ range }));
    } },
  };
  const marked = () => editor.decorations.map(range => document.getText(range));
  // Model cpptools' generic type color first, then VS Code's decoration foreground.
  const typeColor = range => editor.decorations.some(mark => document.offsetAt(mark.start) === document.offsetAt(range.start)) ? enumColor : '#e5c07b';
  return { vscode, document, editor, values, calls, history, listeners, marked, typeColor, disposed: () => disposed,
    emit: (name, event) => listeners.get(name)?.(event) };
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Enum highlighting timed out'); await delay(10); }
}
const sample = `enum class DrainDirection { from_front, from_back };
using enum DrainDirection;
template<DrainDirection direction> class DrainView {};
DrainDirection direction;
DrainView<DrainDirection::from_front> view;
`;

test('enum seeds cover scoped, attributed, forward, qualified and using-enum syntax without comments or literals', () => {
  const source = `enum class [[deprecated("enum Fake")]] Direction { Front };
enum struct Phase;
enum Raw : int { First };
using enum ns::Direction;
enum : int { Anonymous };
// enum class Comment;
#define DECL enum class Macro
const char* text = R"tag(enum class RawText)tag";`;
  assert.deepEqual(enumTypeSeeds(source).map(token => token.text), ['Direction', 'Phase', 'Raw', 'Direction']);
});

test('generic cpptools type colors are overridden only for DrainDirection and its symbol references', async t => {
  const state = host(sample);
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => subscription.dispose());
  await until(() => state.marked().length === 5);
  assert.equal(state.calls.length, 1, 'The declaration highlight result also covers using-enum');
  assert.ok(state.document.ranges('DrainDirection').every(range => state.typeColor(range) === enumColor));
  assert.ok(state.document.ranges('DrainView').every(range => state.typeColor(range) === '#e5c07b'));
  assert.ok(state.marked().every(word => word === 'DrainDirection'), 'Keywords and enum members are not painted');
});

test('an identically named class in another namespace is excluded by language-service symbol ranges', async t => {
  const source = 'namespace a { enum class Mode { Ready }; Mode mode; }\nnamespace b { class Mode {}; Mode mode; }';
  const state = host(source, document => document.ranges('Mode').slice(0, 2).map(range => ({ range })));
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => subscription.dispose());
  await until(() => state.marked().length === 2);
  const ranges = state.document.ranges('Mode');
  assert.ok(ranges.slice(0, 2).every(range => state.typeColor(range) === enumColor));
  assert.ok(ranges.slice(2).every(range => state.typeColor(range) === '#e5c07b'));
});

test('multiple enum symbols retain independent reference groups', async t => {
  const source = 'enum class Direction { A }; Direction direction;\nenum class Phase { B }; Phase phase;\nusing enum Direction; using enum Phase;';
  const state = host(source, (document, position) => {
    const word = document.getText().slice(document.offsetAt(position)).match(/^\w+/)[0];
    return document.ranges(word).map(range => ({ range }));
  });
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => subscription.dispose());
  await until(() => state.marked().length === 6);
  assert.equal(state.calls.length, 2);
  assert.equal(state.marked().filter(word => word === 'Direction').length, 3);
  assert.equal(state.marked().filter(word => word === 'Phase').length, 3);
});

test('native enum classification bypasses the fallback without replacing the semantic provider', async t => {
  const state = host(sample); state.values.nativeEnums = true;
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => subscription.dispose());
  await delay(30);
  assert.deepEqual(state.marked(), []); assert.equal(state.calls.length, 0);
});

test('editing and slow revalidation retain references, and unchanged scrolling does not repaint', async t => {
  let slow = false, release;
  const pending = new Promise(resolve => { release = resolve; });
  const state = host(sample, async document => {
    if (slow) await pending;
    return document.ranges('DrainDirection').map(range => ({ range }));
  });
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => { release(); subscription.dispose(); });
  await until(() => state.marked().length === 5);
  const before = state.history.length;
  slow = true; state.emit('text', state.document.edit(0, 0, '// heading\n'));
  assert.equal(state.marked().length, 5);
  await until(() => state.calls.length === 2);
  assert.equal(state.marked().length, 5);
  release(); await delay(30);
  const count = state.history.length;
  state.emit('scroll'); await delay(300);
  assert.equal(state.history.length, count);
  assert.equal(state.calls.length, 2);
  assert.ok(state.history.slice(before).every(words => words.length === 5));
});

test('temporary indexing misses retain old reference colors and later diagnostics refresh them', async t => {
  let missing = false;
  const state = host(sample, document => missing ? [] : document.ranges('DrainDirection').map(range => ({ range })));
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => subscription.dispose());
  await until(() => state.marked().length === 5);
  missing = true; const before = state.history.length;
  state.emit('text', state.document.edit(state.document.getText().length, 0, '\n'));
  await until(() => state.calls.length >= 3);
  assert.equal(state.marked().length, 5);
  assert.ok(state.history.slice(before).every(words => words.length === 5));
  missing = false; state.emit('diagnostics', { uris: [state.document.uri] });
  await until(() => state.calls.length >= 4);
  assert.equal(state.marked().length, 5);
});

test('changing an enum declaration to a class immediately removes the old enum foreground', async t => {
  const state = host('enum class DrainDirection { A }; DrainDirection direction; class DrainView {};');
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => subscription.dispose());
  await until(() => state.marked().length === 2);
  state.emit('text', state.document.edit(0, 'enum class'.length, 'class'));
  assert.deepEqual(state.marked(), []);
  assert.ok(state.document.ranges('DrainDirection').every(range => state.typeColor(range) === '#e5c07b'));
});

test('disable and disposal remove decorations and listeners without additional language requests', async () => {
  const state = host(sample);
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  await until(() => state.marked().length === 5);
  state.values.cppEnumTypeHighlighting = false;
  state.emit('config', { affectsConfiguration: key => key === 'dark2026OneDarkPro.cppEnumTypeHighlighting' });
  assert.deepEqual(state.marked(), []);
  await delay(300); assert.equal(state.calls.length, 1);
  subscription.dispose(); assert.ok(state.disposed()); assert.equal(state.listeners.size, 0);
});

test('overlapping edits keep document-highlight requests serial and discard stale responses', async t => {
  let release, active = 0, maximum = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const state = host(sample, async document => {
    active++; maximum = Math.max(maximum, active);
    await pending; active--;
    return document.ranges('DrainDirection').map(range => ({ range }));
  });
  const subscription = registerEnumTypeHighlighting(state.vscode, enumColor);
  t.after(() => { release(); subscription.dispose(); });
  await until(() => state.calls.length === 1);
  state.emit('text', state.document.edit(state.document.getText().length, 0, '\n'));
  await delay(300); assert.equal(state.calls.length, 1);
  release(); await until(() => state.marked().length === 5);
  assert.equal(maximum, 1); assert.equal(state.calls.length, 2);
});
