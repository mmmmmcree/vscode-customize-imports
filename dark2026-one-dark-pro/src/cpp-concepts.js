'use strict';

// Prefer the active language service's native concept tokens. C/C++ versions
// without that classification use Go to Definition to confirm constrained names
// and concept-ids in expressions, requires clauses and placeholder constraints.
const keywords = new Set(('alignas auto bool char char8_t char16_t char32_t class const double enum '
  + 'float int long short signed struct template typename unsigned void volatile wchar_t').split(' '));
const templateOperators = new Set(['operator', 'static_cast', 'dynamic_cast', 'const_cast', 'reinterpret_cast']);

function tokenizeCpp(text) {
  // Preserve UTF-16 offsets while hiding comments, literals and preprocessor lines.
  const code = text.replace(/\/\/(?:[^\r\n\\]|\\(?:\r?\n|[^\r\n]))*|\/\*[\s\S]*?(?:\*\/|$)|(?:u8|[uUL])?R"([^\s()\\]{0,16})\([\s\S]*?\)\1"|"(?:\\[\s\S]|[^"\\])*"|(?<![\p{L}\p{N}_])(?:u8|[uUL])?'(?:\\[\s\S]|[^'\\])*'|^[ \t]*#(?:[^\r\n\\]|\\(?:\r?\n|[^\r\n]))*/gmu,
    value => value.replace(/[^\r\n]/g, ' '));
  const tokens = [];
  for (const match of code.matchAll(/[\p{L}_][\p{L}\p{N}_]*|::|\.\.\.|->|<=>|<=|>=|[^\s]/gu)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function analyze(text) {
  const tokens = tokenizeCpp(text);
  const declarations = [];
  const typeDeclarations = [];
  const candidates = new Map();
  const parameters = [];
  const angles = [];
  let parens = 0, brackets = 0, braces = 0;
  const identifier = value => value && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(value);
  const nesting = () => `${parens}/${brackets}/${braces}`;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], word = token.text;
    // A concept-id can appear anywhere a bool expression can, including inside
    // function bodies and other concept definitions. Concrete template-ids also
    // match here; only a confirmed concept declaration receives concept color.
    if (identifier(word) && !keywords.has(word) && !templateOperators.has(word)
        && (tokens[i + 1]?.text === '<' || tokens[i + 1]?.text === 'auto')) {
      candidates.set(token.start, token);
    }
    if (word === 'concept' && identifier(tokens[i + 1]?.text)) {
      declarations.push({ ...tokens[i + 1], keywordStart: token.start });
    }
    if ((['class', 'struct', 'union', 'enum', 'typename'].includes(word)
        && identifier(tokens[i + 1]?.text) && !keywords.has(tokens[i + 1].text)
        && tokens[i + 2]?.text !== '::')
        || (word === 'using' && identifier(tokens[i + 1]?.text) && tokens[i + 2]?.text === '=')) {
      typeDeclarations.push({ ...tokens[i + 1], keywordStart: token.start });
    }
    const frame = angles.at(-1);
    if (frame?.parameter && frame.nesting === nesting()) {
      frame.parameter = false;
      let nameIndex = word === '::' ? i + 1 : i;
      if (identifier(tokens[nameIndex]?.text) && !keywords.has(tokens[nameIndex].text)) {
        while (tokens[nameIndex + 1]?.text === '::' && identifier(tokens[nameIndex + 2]?.text)) nameIndex += 2;
        candidates.set(tokens[nameIndex].start, tokens[nameIndex]);
      }
    }
    if (word === '(') parens++;
    else if (word === ')') parens--;
    else if (word === '[') brackets++;
    else if (word === ']') brackets--;
    else if (word === '{') braces++;
    else if (word === '}') braces--;
    else if (word === '<' && (tokens[i - 1]?.text === 'template' || frame?.nesting === nesting())) {
      angles.push({ template: tokens[i - 1]?.text === 'template', parameter: tokens[i - 1]?.text === 'template', start: i + 1, nesting: nesting() });
    } else if ((word === '>' || word === ',') && frame?.nesting === nesting()) {
      if (frame.template) {
        const parameter = templateParameter(tokens.slice(frame.start, i));
        if (parameter) parameters.push(parameter);
        frame.start = i + 1;
        frame.parameter = true;
      }
      if (word === '>') angles.pop();
    }
  }
  return { declarations, typeDeclarations, candidates: [...candidates.values()].sort((a, b) => a.start - b.start), parameters };
}

// Only simple declarators are handled here. An identifier followed by an
// identifier is ambiguous until Go to Definition confirms a concept or a type.
function templateParameter(tokens) {
  if (!tokens.length || tokens[0].text === 'template') return undefined;
  const identifier = token => token && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(token.text) && !keywords.has(token.text);
  let i = 0, value = false;
  if (['class', 'typename'].includes(tokens[i].text) && tokens[i + 2]?.text !== '::') {
    i++;
    if (tokens[i]?.text === '...') i++;
    return identifier(tokens[i]) && (!tokens[i + 1] || tokens[i + 1].text === '=')
      ? { name: tokens[i], kind: 'type' } : undefined;
  }
  while (['const', 'volatile', 'typename'].includes(tokens[i]?.text)) { value = true; i++; }
  let head;
  if (keywords.has(tokens[i]?.text)) {
    value = true;
    while (keywords.has(tokens[i]?.text)) i++;
  } else {
    if (tokens[i]?.text === '::') i++;
    if (!identifier(tokens[i])) return undefined;
    head = tokens[i++];
    while (tokens[i]?.text === '::' && identifier(tokens[i + 1])) { head = tokens[i + 1]; i += 2; }
    if (tokens[i]?.text === '<') {
      let depth = 0;
      do {
        if (tokens[i].text === '<') depth++;
        if (tokens[i++].text === '>') depth--;
      } while (i < tokens.length && depth);
      if (depth) return undefined;
    }
  }
  while (['const', 'volatile', 'auto', '*', '&'].includes(tokens[i]?.text)) { value = true; i++; }
  if (tokens[i]?.text === '...') i++;
  if (!identifier(tokens[i]) || (tokens[i + 1] && tokens[i + 1].text !== '=')) return undefined;
  return { name: tokens[i], head, kind: value ? 'value' : 'unknown' };
}

function registerConceptHighlighting(vscode, color, parameterColor, typeParameterColor) {
  const decoration = vscode.window.createTextEditorDecorationType({ color,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
  const parameterDecoration = parameterColor && vscode.window.createTextEditorDecorationType({ color: parameterColor,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
  const typeParameterDecoration = typeParameterColor && vscode.window.createTextEditorDecorationType({ color: typeParameterColor,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
  const analysisCache = new WeakMap();
  const confirmed = new Map();
  const painted = new WeakMap();
  const parametersPainted = new WeakMap();
  const typeParametersPainted = new WeakMap();
  const nativeSupport = new Map();
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
  function enabled(role) {
    if (vscode.workspace.getConfiguration('workbench').get('colorTheme') !== 'Dark 2026 + One Dark Pro') return false;
    const config = vscode.workspace.getConfiguration('dark2026OneDarkPro');
    const concepts = config.get('cppConceptHighlighting', true);
    const parameters = Boolean(parameterDecoration || typeParameterDecoration) && config.get('cppTemplateParameterHighlighting', true);
    return role === 'concept' ? concepts : role === 'parameter' ? parameters : concepts || parameters;
  }
  const range = (document, token) => new vscode.Range(document.positionAt(token.start), document.positionAt(token.end));
  function key(document, token) {
    return `${document.uri.toString()}\n${document.version}\n${token.start}`;
  }
  async function hasNativeConcepts(document) {
    if (vscode.workspace.getConfiguration('editor', document.uri).get('semanticHighlighting.enabled') === false) return false;
    const uri = document.uri.toString();
    let entry = nativeSupport.get(uri);
    if (!entry) {
      entry = { native: false };
      entry.promise = Promise.resolve().then(() => vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', document.uri))
        .then(legend => {
          entry.native = Boolean(legend?.tokenTypes.includes('concept'));
          entry.nativeParameters = Boolean(legend?.tokenTypes.includes('typeParameter'));
          return entry.native;
        }, () => false);
      nativeSupport.set(uri, entry);
    }
    return entry.promise;
  }
  function marks(document) {
    let value = confirmed.get(document);
    if (!value) { value = new Map(); confirmed.set(document, value); }
    return value;
  }
  function remember(document, token, result) {
    if (result) marks(document).set(token.start, { ...token, target: result });
    else if (result === false) marks(document).delete(token.start);
    // An empty/failed provider response is inconclusive while IntelliSense updates.
  }
  function paint(editor) {
    const document = editor.document;
    const native = nativeSupport.get(document.uri.toString());
    let tokens = [], parameterTokens = [], typeParameterTokens = [];
    if (enabled() && document.languageId === 'cpp') {
      const value = parsed(document), candidates = new Map(value.candidates.map(token => [token.start, token]));
      const retained = marks(document);
      for (const [start, token] of retained) {
        const current = candidates.get(start);
        if (!current || current.text !== token.text || current.end !== token.end) retained.delete(start);
      }
      // Retain confirmed offscreen ranges too, so scrolling back needs no repaint.
      if (enabled('concept') && !native?.native) {
        tokens = [...value.declarations, ...[...retained.values()].filter(token => token.target.kind === 'concept')].sort((a, b) => a.start - b.start);
      }
      if (enabled('parameter')) {
        parameterTokens = value.parameters.filter(parameter => parameter.kind === 'value'
          || (parameter.kind === 'unknown' && retained.get(parameter.head.start)?.target.kind === 'type')).map(parameter => parameter.name);
        if (!native?.nativeParameters) {
          typeParameterTokens = value.parameters.filter(parameter => parameter.kind === 'type'
            || (parameter.kind === 'unknown' && retained.get(parameter.head.start)?.target.kind === 'concept')).map(parameter => parameter.name);
        }
      }
    }
    const signature = `${document.uri.toString()}\n${tokens.map(token => `${token.start}:${token.end}`).join(',')}`;
    if (painted.get(editor) !== signature) {
      painted.set(editor, signature);
      editor.setDecorations(decoration, tokens.map(token => range(document, token)));
    }
    const parameterSignature = `${document.uri.toString()}\n${parameterTokens.map(token => `${token.start}:${token.end}`).join(',')}`;
    if (parameterDecoration && parametersPainted.get(editor) !== parameterSignature) {
      parametersPainted.set(editor, parameterSignature);
      editor.setDecorations(parameterDecoration, parameterTokens.map(token => range(document, token)));
    }
    const typeParameterSignature = `${document.uri.toString()}\n${typeParameterTokens.map(token => `${token.start}:${token.end}`).join(',')}`;
    if (typeParameterDecoration && typeParametersPainted.get(editor) !== typeParameterSignature) {
      typeParametersPainted.set(editor, typeParameterSignature);
      editor.setDecorations(typeParameterDecoration, typeParameterTokens.map(token => range(document, token)));
    }
  }
  function moved(token, changes) {
    let shift = 0;
    for (const change of changes || []) {
      const start = change.rangeOffset, end = start + change.rangeLength;
      if (end <= token.start) shift += change.text.length - change.rangeLength;
      else if (start < token.end) return undefined;
    }
    return { ...token, start: token.start + shift, end: token.end + shift };
  }
  function trackChanges(event) {
    const changedUri = event.document.uri.toString();
    for (const [document, entries] of confirmed) {
      const retained = new Map();
      for (const mark of entries.values()) {
        let next = document === event.document ? moved(mark, event.contentChanges) : mark;
        if (!next) continue;
        if (next.target.uri === changedUri) {
          const target = moved(next.target, event.contentChanges);
          const declarations = next.target.kind === 'type' ? parsed(event.document).typeDeclarations : parsed(event.document).declarations;
          const declaration = target && declarations.find(token => token.start === target.start && token.end === target.end && token.text === target.text);
          if (!declaration) continue;
          next = { ...next, target: { ...target, ...declaration } };
        }
        retained.set(next.start, next);
      }
      confirmed.set(document, retained);
    }
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
          if (disposed || cacheGeneration !== epoch) return undefined;
          const uri = target.targetUri || target.uri;
          const selection = target.targetSelectionRange || target.range;
          if (!uri || !selection) continue;
          const definition = await vscode.workspace.openTextDocument(uri);
          const start = definition.offsetAt(selection.start), end = definition.offsetAt(selection.end);
          const declaration = parsed(definition).declarations.find(value => value.text === token.text
            && start <= value.end && end >= value.keywordStart);
          if (declaration) {
            const result = { uri: uri.toString(), ...declaration, kind: 'concept' };
            if (cacheGeneration === epoch) results.set(cacheKey, result);
            return result;
          }
          const type = parsed(definition).typeDeclarations.find(value => value.text === token.text
            && start <= value.end && end >= value.keywordStart);
          if (type) {
            const result = { uri: uri.toString(), ...type, kind: 'type' };
            if (cacheGeneration === epoch) results.set(cacheKey, result);
            return result;
          }
        }
        if (definitions?.length && cacheGeneration === epoch) results.set(cacheKey, false);
        // Retry unresolved names on later editor events while the provider starts.
        return definitions?.length ? false : undefined;
      } catch { return undefined; }
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
        paint(editor);
        continue;
      }
      const version = document.version;
      const native = await hasNativeConcepts(document);
      if (disposed || generation !== epoch || document.version !== version || !enabled()) return;
      if (native && !enabled('parameter')) { paint(editor); continue; }
      const value = parsed(document);
      const visible = token => editor.visibleRanges.some(view => view.intersection(range(document, token)));
      const needed = token => (enabled('concept') && !native)
        || (enabled('parameter') && (parameterDecoration || !nativeSupport.get(document.uri.toString())?.nativeParameters)
          && value.parameters.some(parameter => parameter.kind === 'unknown' && parameter.head.start === token.start));
      const candidates = value.candidates.filter(token => needed(token) && visible(token)).slice(0, 64);
      candidates.forEach(token => { if (results.has(key(document, token))) remember(document, token, results.get(key(document, token))); });
      paint(editor);
      const unknown = candidates.filter(token => !results.has(key(document, token)));
      const resolved = [];
      // Resolve in small batches to avoid flooding a language server.
      for (let i = 0; i < unknown.length; i += 4) {
        if (disposed || generation !== epoch || document.version !== version || !enabled()) break;
        const batch = unknown.slice(i, i + 4);
        const answers = await Promise.all(batch.map(token => resolve(document, token)));
        if (disposed || generation !== epoch || document.version !== version || !enabled()) break;
        batch.forEach((token, index) => resolved.push([token, answers[index]]));
      }
      if (disposed || generation !== epoch || document.version !== version || !enabled()) return;
      resolved.forEach(([token, result]) => remember(document, token, result));
      paint(editor);
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
      if (analysisCache.has(event.document) || (event.document.languageId === 'cpp'
          && vscode.window.visibleTextEditors.some(editor => editor.document === event.document))) {
        trackChanges(event);
        // Keep surviving ranges in place throughout asynchronous revalidation.
        vscode.window.visibleTextEditors.forEach(paint);
        schedule(true);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      const tracked = analysisCache.has(document) || nativeSupport.has(document.uri.toString());
      confirmed.delete(document);
      nativeSupport.delete(document.uri.toString());
      if (tracked) schedule(true);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (['workbench.colorTheme', 'dark2026OneDarkPro.cppConceptHighlighting', 'dark2026OneDarkPro.cppTemplateParameterHighlighting', 'editor.semanticHighlighting.enabled', 'C_Cpp'].some(name => event.affectsConfiguration(name))) {
        nativeSupport.clear();
        vscode.window.visibleTextEditors.forEach(paint);
        schedule(event.affectsConfiguration('C_Cpp'));
      }
    }),
    vscode.languages.onDidChangeDiagnostics(event => {
      if (event.uris.some(uri => vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === uri.toString()))) {
        // An index update can resolve earlier misses without discarding confirmed concepts.
        for (const [key, value] of results) if (!value) results.delete(key);
        for (const uri of event.uris) {
          const key = uri.toString();
          if (!nativeSupport.get(key)?.native) nativeSupport.delete(key);
        }
        schedule();
      }
    }),
  ];
  subscriptions.push(vscode.extensions.onDidChange(() => { nativeSupport.clear(); schedule(true); }));
  schedule();
  return { dispose() {
    disposed = true;
    generation++;
    cacheGeneration++;
    clearTimeout(timer);
    subscriptions.forEach(subscription => subscription.dispose());
    decoration.dispose();
    parameterDecoration?.dispose();
    typeParameterDecoration?.dispose();
    results.clear(); pending.clear();
    confirmed.clear(); nativeSupport.clear();
    requests.splice(0).forEach(job => job.resolve([]));
  } };
}

module.exports = { analyze, tokenizeCpp, registerConceptHighlighting };
