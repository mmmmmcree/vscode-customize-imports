'use strict';

const { tokenizeCpp } = require('./cpp-concepts');

// Only explicit enum syntax establishes a type. References come from the
// language service's symbol highlights, never from matching names globally.
function enumTypeSeeds(text) {
  const tokens = tokenizeCpp(text), seeds = [];
  const identifier = token => token && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(token.text)
    && !['class', 'struct', 'enum', 'typename', 'const', 'volatile'].includes(token.text);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text !== 'enum') continue;
    let j = i + 1;
    if (['class', 'struct'].includes(tokens[j]?.text)) j++;
    while (tokens[j]?.text === '[' && tokens[j + 1]?.text === '[') {
      let depth = 0;
      do {
        if (tokens[j].text === '[') depth++;
        else if (tokens[j].text === ']') depth--;
        j++;
      } while (j < tokens.length && depth);
    }
    if (tokens[j]?.text === '::') j++;
    if (!identifier(tokens[j])) continue;
    while (tokens[j + 1]?.text === '::' && identifier(tokens[j + 2])) j += 2;
    seeds.push({ ...tokens[j] });
  }
  return seeds;
}

function moved(token, changes = []) {
  let shift = 0;
  for (const change of changes) {
    const start = change.rangeOffset, end = start + change.rangeLength;
    if (end <= token.start) shift += change.text.length - change.rangeLength;
    else if (start < token.end) return undefined;
  }
  return { ...token, start: token.start + shift, end: token.end + shift };
}

function registerEnumTypeHighlighting(vscode, color) {
  const decoration = vscode.window.createTextEditorDecorationType({ color,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
  const states = new Map(), legends = new Map(), painted = new WeakMap();
  const requests = [];
  let generation = 0, timer, running = false, disposed = false;
  const enabled = () => vscode.workspace.getConfiguration('workbench').get('colorTheme') === 'Dark 2026 + One Dark Pro'
    && vscode.workspace.getConfiguration('dark2026OneDarkPro').get('cppEnumTypeHighlighting', true);
  function state(document) {
    let value = states.get(document);
    if (!value) { value = { version: -1, seeds: [], groups: new Map(), complete: false }; states.set(document, value); }
    if (value.version !== document.version) {
      value.version = document.version; value.seeds = enumTypeSeeds(document.getText()); value.complete = false;
    }
    return value;
  }
  async function nativeEnums(document) {
    if (vscode.workspace.getConfiguration('editor', document.uri).get('semanticHighlighting.enabled') === false) return false;
    const key = document.uri.toString();
    let entry = legends.get(key);
    if (!entry) {
      entry = { native: false };
      entry.promise = Promise.resolve().then(() => vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', document.uri))
        .then(legend => { entry.native = Boolean(legend?.tokenTypes.includes('enum')); return entry.native; }, () => false);
      legends.set(key, entry);
    }
    return entry.promise;
  }
  function paint(editor) {
    const document = editor.document, tokens = new Map();
    if (enabled() && document.languageId === 'cpp' && !legends.get(document.uri.toString())?.native) {
      const value = state(document), seeds = new Map(value.seeds.map(seed => [seed.start, seed]));
      value.seeds.forEach(seed => tokens.set(seed.start, seed));
      for (const [key, group] of value.groups) {
        const seed = seeds.get(key);
        if (!seed || seed.text !== group.seed.text || seed.end !== group.seed.end) { value.groups.delete(key); continue; }
        for (const token of group.references) {
          if (document.getText().slice(token.start, token.end) === seed.text) tokens.set(token.start, token);
        }
      }
    }
    const sorted = [...tokens.values()].sort((a, b) => a.start - b.start);
    const signature = `${document.uri.toString()}\n${sorted.map(token => `${token.start}:${token.end}`).join(',')}`;
    if (painted.get(editor) === signature) return;
    painted.set(editor, signature);
    editor.setDecorations(decoration, sorted.map(token => new vscode.Range(document.positionAt(token.start), document.positionAt(token.end))));
  }
  function pump() {
    if (disposed || running || !requests.length) return;
    const job = requests.shift();
    if (job.epoch !== generation) { job.resolve(undefined); pump(); return; }
    running = true;
    Promise.resolve().then(() => vscode.commands.executeCommand('vscode.executeDocumentHighlights', job.document.uri, job.document.positionAt(job.seed.start)))
      .then(job.resolve, () => job.resolve(undefined)).finally(() => { running = false; pump(); });
  }
  function highlights(document, seed, epoch) {
    return new Promise(resolve => { requests.push({ document, seed, epoch, resolve }); pump(); });
  }
  async function update() {
    timer = undefined;
    const epoch = generation;
    for (const editor of vscode.window.visibleTextEditors) {
      if (disposed || generation !== epoch) return;
      const document = editor.document;
      if (!enabled() || document.languageId !== 'cpp') { paint(editor); continue; }
      const version = document.version, native = await nativeEnums(document);
      if (disposed || generation !== epoch || document.version !== version || !enabled()) return;
      paint(editor);
      if (native) continue;
      const value = state(document);
      if (value.complete) continue;
      const covered = new Set(), groups = new Map(value.groups);
      let complete = true;
      // Usually one request covers a declaration plus all its uses in this file.
      for (const seed of value.seeds.slice(0, 32)) {
        if (covered.has(seed.start)) continue;
        const answer = await highlights(document, seed, epoch);
        if (disposed || generation !== epoch || document.version !== version || !enabled()) return;
        const references = [];
        for (const highlight of Array.isArray(answer) ? answer : []) {
          if (!highlight?.range) continue;
          const start = document.offsetAt(highlight.range.start), end = document.offsetAt(highlight.range.end);
          if (end > start && document.getText().slice(start, end) === seed.text) references.push({ start, end, text: seed.text });
        }
        if (!references.length) { complete = false; continue; }
        const positions = new Set(references.map(token => token.start));
        positions.forEach(start => covered.add(start));
        for (const key of groups.keys()) if (positions.has(key)) groups.delete(key);
        groups.set(seed.start, { seed, references });
      }
      value.groups = groups; value.complete = complete;
      paint(editor);
    }
  }
  function schedule() {
    generation++;
    requests.splice(0).forEach(job => job.resolve(undefined));
    clearTimeout(timer);
    timer = setTimeout(() => { void update(); }, 250);
  }
  function changed(event) {
    const document = event.document;
    if (!states.has(document) && !vscode.window.visibleTextEditors.some(editor => editor.document === document && document.languageId === 'cpp')) return;
    const value = state(document), seeds = new Map(value.seeds.map(seed => [seed.start, seed])), groups = new Map();
    for (const group of value.groups.values()) {
      const seed = moved(group.seed, event.contentChanges), current = seed && seeds.get(seed.start);
      if (!current || current.text !== seed.text || current.end !== seed.end) continue;
      const references = group.references.map(token => moved(token, event.contentChanges)).filter(token => token
        && document.getText().slice(token.start, token.end) === seed.text);
      groups.set(seed.start, { seed, references });
    }
    value.groups = groups; value.complete = false;
    vscode.window.visibleTextEditors.forEach(paint);
    schedule();
  }
  function reset() {
    legends.clear(); states.forEach(value => { value.complete = false; });
    vscode.window.visibleTextEditors.forEach(paint); schedule();
  }
  const subscriptions = [
    vscode.window.onDidChangeVisibleTextEditors(schedule),
    vscode.window.onDidChangeTextEditorVisibleRanges(schedule),
    vscode.window.onDidChangeActiveTextEditor(schedule),
    vscode.workspace.onDidChangeTextDocument(changed),
    vscode.workspace.onDidCloseTextDocument(document => { states.delete(document); legends.delete(document.uri.toString()); schedule(); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (['workbench.colorTheme', 'dark2026OneDarkPro.cppEnumTypeHighlighting', 'editor.semanticHighlighting.enabled', 'C_Cpp'].some(name => event.affectsConfiguration(name))) reset();
    }),
    vscode.languages.onDidChangeDiagnostics(event => {
      let relevant = false;
      for (const editor of vscode.window.visibleTextEditors) {
        const document = editor.document;
        if (event.uris.some(uri => uri.toString() === document.uri.toString())) {
          const value = states.get(document); if (value) value.complete = false;
          if (!legends.get(document.uri.toString())?.native) legends.delete(document.uri.toString());
          relevant = true;
        }
      }
      if (relevant) schedule();
    }),
    vscode.extensions.onDidChange(reset),
  ];
  void update();
  return { dispose() {
    disposed = true; generation++; clearTimeout(timer);
    subscriptions.forEach(subscription => subscription.dispose());
    requests.splice(0).forEach(job => job.resolve(undefined));
    states.clear(); legends.clear(); decoration.dispose();
  } };
}

module.exports = { enumTypeSeeds, registerEnumTypeHighlighting };
