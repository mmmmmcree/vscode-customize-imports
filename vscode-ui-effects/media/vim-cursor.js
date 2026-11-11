'use strict';

// VSCodeVim draws its Visual-mode caret as a text decoration, outside .cursor.
// Discover the decoration's paired background/text rules instead of pinning its
// generated ced-<extension-host>-TextEditorDecorationType<n> class name.
(() => {
  window.vscodeVimCursorEffects?.dispose();
  const style = document.createElement('style');
  style.id = 'customize-imports-vim-cursor';
  const sheets = new Map();
  const removers = [];
  let disposed = false;
  let timer;
  let observer;
  let selectors = '';

  function findVimCursors(rules) {
    const blocks = new Map();
    const darkText = new Set();
    const lightText = new Set();
    for (const rule of rules) {
      const selector = rule.selectorText;
      const css = rule.style;
      if (!selector || !css) continue;
      const block = /^\.monaco-editor \.(ced-[\w-]+)-0$/.exec(selector);
      if (block && css.backgroundColor && css.backgroundColor !== 'transparent'
          && css.backgroundColor === css.borderColor && css.borderWidth === '1px'
          && css.borderStyle === 'solid' && css.boxSizing === 'border-box') {
        blocks.set(block[1], `${block[1]}-0`);
      }
      // These two foreground variants are VSCodeVim's default cursor signature.
      const dark = selector.includes('.vs-dark.monaco-editor') && css.color === 'rgb(81, 80, 82)';
      const light = selector.includes('.vs.monaco-editor') && css.color === 'rgb(255, 255, 255)';
      if (dark || light) {
        for (const match of selector.matchAll(/\.(ced-[\w-]+)-1(?=[\s,]|$)/g)) {
          if (dark) darkText.add(match[1]);
          if (light) lightText.add(match[1]);
        }
      }
    }
    return [...blocks].filter(([key]) => darkText.has(key) && lightText.has(key));
  }

  function refresh() {
    if (disposed || document.hidden || !document.hasFocus()) return;
    const seen = new Set();
    const matches = new Map();
    const now = performance.now();
    for (const sheet of document.styleSheets) {
      // Editor decorations live in inline sheets. Never inspect external sheets.
      if (sheet === style.sheet || sheet.href) continue;
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      seen.add(sheet);
      let cached = sheets.get(sheet);
      if (!cached || cached.length !== rules.length || cached.first !== rules[0]
          || cached.last !== rules[rules.length - 1] || now - cached.checkedAt >= 2000) {
        cached = { length: rules.length, first: rules[0], last: rules[rules.length - 1], checkedAt: now, matches: findVimCursors(rules) };
        sheets.set(sheet, cached);
      }
      for (const [key, block] of cached.matches) matches.set(key, block);
    }
    for (const sheet of sheets.keys()) if (!seen.has(sheet)) sheets.delete(sheet);
    const key = [...matches.keys()].sort().join(',');
    if (key === selectors) return;
    selectors = key;
    style.textContent = [...matches].map(([name, block]) => `
      .monaco-workbench .monaco-editor .${block} {
        background: var(--customize-imports-cursor-gradient) !important;
        border-color: transparent !important;
        border-radius: 2px;
      }
      .monaco-workbench .monaco-editor .${name}-1 {
        color: #11151d !important;
        -webkit-text-fill-color: currentColor !important;
        text-shadow: none !important;
      }
    `).join('\n');
  }

  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  }
  function bootstrap() {
    if (disposed) return;
    document.head.appendChild(style);
    refresh();
    // CSSOM insertRule does not emit DOM mutations; polling also handles Vim
    // activation, theme changes and extension-host restarts. Stable sheets are cached.
    timer = setInterval(refresh, 500);
    observer = new MutationObserver(refresh);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    listen(window, 'focus', refresh);
    listen(document, 'visibilitychange', refresh);
    listen(document, 'keydown', refresh, true);
  }
  const api = {
    getStats: () => ({ decorations: selectors ? selectors.split(',').length : 0, disposed }),
    dispose() {
      disposed = true;
      clearInterval(timer);
      observer?.disconnect();
      removers.splice(0).forEach(remove => remove());
      sheets.clear();
      selectors = '';
      style.remove();
      if (window.vscodeVimCursorEffects === api) delete window.vscodeVimCursorEffects;
    },
  };
  window.vscodeVimCursorEffects = api;
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();
