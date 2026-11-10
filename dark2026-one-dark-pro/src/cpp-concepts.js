'use strict';

// C/C++ does not expose a concept semantic token. Confirm constrained parameter
// names through Go to Definition instead of treating every named type as a concept.
const keywords = new Set(('alignas auto bool char char8_t char16_t char32_t class const double enum '
  + 'float int long short signed struct template typename unsigned void volatile wchar_t').split(' '));

function analyze(text) {
  // Preserve UTF-16 offsets while hiding comments, literals and preprocessor lines.
  const code = text.replace(/\/\/(?:[^\r\n\\]|\\(?:\r?\n|[^\r\n]))*|\/\*[\s\S]*?(?:\*\/|$)|(?:u8|[uUL])?R"([^\s()\\]{0,16})\([\s\S]*?\)\1"|"(?:\\[\s\S]|[^"\\])*"|(?<![\p{L}\p{N}_])(?:u8|[uUL])?'(?:\\[\s\S]|[^'\\])*'|^[ \t]*#(?:[^\r\n\\]|\\(?:\r?\n|[^\r\n]))*/gmu,
    value => value.replace(/[^\r\n]/g, ' '));
  const tokens = [];
  for (const match of code.matchAll(/[\p{L}_][\p{L}\p{N}_]*|::|\.\.\.|->|<=>|<=|>=|[^\s]/gu)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  const declarations = [];
  const candidates = [];
  const angles = [];
  let parens = 0, brackets = 0, braces = 0;
  const identifier = value => value && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(value);
  const nesting = () => `${parens}/${brackets}/${braces}`;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], word = token.text;
    if (word === 'concept' && identifier(tokens[i + 1]?.text)) {
      declarations.push({ ...tokens[i + 1], keywordStart: token.start });
    }
    const frame = angles.at(-1);
    if (frame?.parameter && frame.nesting === nesting()) {
      frame.parameter = false;
      let nameIndex = word === '::' ? i + 1 : i;
      if (identifier(tokens[nameIndex]?.text) && !keywords.has(tokens[nameIndex].text)) {
        while (tokens[nameIndex + 1]?.text === '::' && identifier(tokens[nameIndex + 2]?.text)) nameIndex += 2;
        candidates.push(tokens[nameIndex]);
      }
    }
    if (word === '(') parens++;
    else if (word === ')') parens--;
    else if (word === '[') brackets++;
    else if (word === ']') brackets--;
    else if (word === '{') braces++;
    else if (word === '}') braces--;
    else if (word === '<' && (tokens[i - 1]?.text === 'template' || frame?.nesting === nesting())) {
      angles.push({ template: tokens[i - 1]?.text === 'template', parameter: tokens[i - 1]?.text === 'template', nesting: nesting() });
    } else if (word === '>' && frame?.nesting === nesting()) angles.pop();
    else if (word === ',' && frame?.template && frame.nesting === nesting()) frame.parameter = true;
  }
  return { declarations, candidates };
}

function registerConceptHighlighting(vscode, color) {
  const decoration = vscode.window.createTextEditorDecorationType({ color });
  const analysisCache = new WeakMap();
  const results = new Map();
  const pending = new Map();
  const requests = [];
  let running = 0;
  let timer;
  let generation = 0;
  let cacheGeneration = 0;
  let disposed = false;
  function pump() {
    while (!disposed && running < 4 && requests.length) {
      const job = requests.shift();
      if (job.epoch !== cacheGeneration) { job.resolve([]); continue; }
      running++;
      Promise.resolve().then(() => vscode.commands.executeCommand('vscode.executeDefinitionProvider', job.uri, job.position))
        .then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  }
  function definitionAt(uri, position) {
    return new Promise((resolve, reject) => {
      requests.push({ uri, position, epoch: cacheGeneration, resolve, reject });
      pump();
    });
  }
  function parsed(document) {
    const cached = analysisCache.get(document);
    if (cached?.version === document.version) return cached.value;
    const value = analyze(document.getText());
    analysisCache.set(document, { version: document.version, value });
    return value;
  }
  function enabled() {
    return vscode.workspace.getConfiguration('workbench').get('colorTheme') === 'Dark 2026 + One Dark Pro'
      && vscode.workspace.getConfiguration('dark2026OneDarkPro').get('cppConceptHighlighting', true);
  }
  const range = (document, token) => new vscode.Range(document.positionAt(token.start), document.positionAt(token.end));
  function key(document, token) {
    return `${document.uri.toString()}\n${document.version}\n${token.start}`;
  }
  async function resolve(document, token) {
    const cacheKey = key(document, token);
    if (results.has(cacheKey)) return results.get(cacheKey);
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    const epoch = cacheGeneration;
    const task = (async () => {
      try {
        const definitions = await definitionAt(document.uri, document.positionAt(token.start));
        for (const target of definitions || []) {
          if (disposed || cacheGeneration !== epoch) return false;
          const uri = target.targetUri || target.uri;
          const selection = target.targetSelectionRange || target.range;
          if (!uri || !selection) continue;
          const definition = await vscode.workspace.openTextDocument(uri);
          const start = definition.offsetAt(selection.start), end = definition.offsetAt(selection.end);
          if (parsed(definition).declarations.some(value => value.text === token.text
            && start <= value.end && end >= value.keywordStart)) {
            if (cacheGeneration === epoch) results.set(cacheKey, true);
            return true;
          }
        }
        if (definitions?.length && cacheGeneration === epoch) results.set(cacheKey, false);
        // Retry unresolved names on later editor events while the provider starts.
        return false;
      } catch { return false; }
    })();
    pending.set(cacheKey, task);
    void task.finally(() => { if (pending.get(cacheKey) === task) pending.delete(cacheKey); });
    return task;
  }
  async function update() {
    timer = undefined;
    const epoch = generation;
    for (const editor of vscode.window.visibleTextEditors) {
      if (disposed || generation !== epoch) return;
      const document = editor.document;
      if (!enabled() || document.languageId !== 'cpp') {
        editor.setDecorations(decoration, []);
        continue;
      }
      const version = document.version;
      const value = parsed(document);
      const visible = token => editor.visibleRanges.some(view => view.intersection(range(document, token)));
      const candidates = value.candidates.filter(visible).slice(0, 64);
      const found = [...value.declarations.filter(visible), ...candidates.filter(token => results.get(key(document, token)))].map(token => range(document, token));
      editor.setDecorations(decoration, found);
      const unknown = candidates.filter(token => !results.has(key(document, token)));
      // Resolve in small batches to avoid flooding a language server.
      for (let i = 0; i < unknown.length; i += 4) {
        if (disposed || generation !== epoch || document.version !== version || !enabled()) break;
        const batch = unknown.slice(i, i + 4);
        const confirmed = await Promise.all(batch.map(token => resolve(document, token)));
        if (disposed || generation !== epoch || document.version !== version || !enabled()) break;
        batch.forEach((token, index) => { if (confirmed[index]) found.push(range(document, token)); });
        editor.setDecorations(decoration, found);
      }
    }
  }
  function schedule(invalidate = false) {
    generation++;
    if (invalidate) {
      cacheGeneration++; results.clear(); pending.clear();
      requests.splice(0).forEach(job => job.resolve([]));
    }
    clearTimeout(timer);
    timer = setTimeout(() => { void update(); }, 250);
  }
  const subscriptions = [
    vscode.window.onDidChangeVisibleTextEditors(() => schedule()),
    vscode.window.onDidChangeTextEditorVisibleRanges(() => schedule()),
    vscode.window.onDidChangeActiveTextEditor(() => schedule()),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (analysisCache.has(event.document)) schedule(true);
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      if (analysisCache.has(document)) schedule(true);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('workbench.colorTheme') || event.affectsConfiguration('dark2026OneDarkPro.cppConceptHighlighting')) schedule();
    }),
    vscode.languages.onDidChangeDiagnostics(event => {
      if (event.uris.some(uri => vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === uri.toString()))) {
        // An index update can resolve earlier misses without discarding confirmed concepts.
        for (const [key, value] of results) if (!value) results.delete(key);
        schedule();
      }
    }),
  ];
  schedule();
  return { dispose() {
    disposed = true;
    generation++;
    cacheGeneration++;
    clearTimeout(timer);
    subscriptions.forEach(subscription => subscription.dispose());
    decoration.dispose();
    results.clear(); pending.clear();
    requests.splice(0).forEach(job => job.resolve([]));
  } };
}

module.exports = { analyze, registerConceptHighlighting };
