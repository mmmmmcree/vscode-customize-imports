/* Workbench script loaded by Custom CSS and JS Loader, not the extension host. */
(() => {
  'use strict';
  const options = window.dark2026SynthwaveOptions || {};
  window.dark2026Synthwave?.dispose();
  const intensity = Number.isFinite(options.intensity) ? Math.max(0, Math.min(2, options.intensity)) : 1;
  const frequencyAware = options.frequencyAware !== false;
  const profiles = {
    text: 0.10, comment: 0.04, variable: 0.18, string: 0.24, literal: 0.34,
    keyword: 0.40, namespace: 0.52, function: 0.52, enum: 0.72, concept: 0.78, type: 0.85, diagnostic: 0.55,
  };
  // One Dark Pro token colors and our C++ colors identify role groups.
  // Every shadow still uses currentColor; no separate glow color palette is used.
  const roles = {
    '#abb2bf': 'text', '#ffffff': 'text', '#282c34': 'text',
    '#7f848e': 'comment', '#5c6370': 'comment', '#e06c75': 'variable',
    '#98c379': 'string', '#d19a66': 'literal', '#c678dd': 'keyword',
    '#61afef': 'function', '#56b6c2': 'enum', '#e5c07b': 'type',
    '#9bbde0': 'namespace', '#7ec8b5': 'concept',
    '#dca3c9': 'type', '#b9cc86': 'enum',
    '#f44747': 'diagnostic', '#be5046': 'diagnostic',
  };
  const colorContext = document.createElement('canvas').getContext('2d');
  const style = document.createElement('style');
  style.id = 'dark2026-synthwave';
  document.head.appendChild(style);
  let disposed = false;
  let active = false;
  let timer = null;
  let rebuild = true;
  let classRoles = new Map();
  let lastCounts = {};
  let strengths = {};
  let workbenchSeen = Boolean(document.querySelector('.monaco-workbench'));
  let statusbar = null;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function sameColor(first, second) {
    if (!first || !second) return false;
    colorContext.fillStyle = '#000000';
    colorContext.fillStyle = first;
    const normalized = colorContext.fillStyle;
    colorContext.fillStyle = '#000000';
    colorContext.fillStyle = second;
    return normalized === colorContext.fillStyle;
  }

  function updateStatusbar(workbench, colors) {
    const current = workbench.querySelector('.part.statusbar');
    if (current !== statusbar) {
      statusbarObserver.disconnect();
      statusbar?.classList.remove('dark2026-synthwave-debugging');
      statusbar = current;
      if (statusbar) statusbarObserver.observe(statusbar, { attributes: true, attributeFilter: ['style'] });
    }
    if (!statusbar) return;
    // VS Code writes the resolved target color inline; comparing that value avoids
    // sampling its in-progress background transition or relying on a private class.
    const debug = colors.getPropertyValue('--vscode-statusBar-debuggingBackground').trim();
    const normal = colors.getPropertyValue('--vscode-statusBar-background').trim();
    const debugging = active && !sameColor(debug, normal) && sameColor(statusbar.style.backgroundColor, debug);
    statusbar.classList.toggle('dark2026-synthwave-debugging', debugging);
  }

  function scanColors() {
    const result = new Map();
    function visit(rules) {
      for (const rule of rules) {
        if (rule.selectorText && rule.style?.color) {
          colorContext.fillStyle = '#000000';
          colorContext.fillStyle = rule.style.color;
          const role = roles[colorContext.fillStyle.toLowerCase()] || 'text';
          for (const match of rule.selectorText.matchAll(/\.(?:mtk\d+|ced-[\w-]+)\b/g)) result.set(match[0].slice(1), role);
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    }
    for (const sheet of document.styleSheets) {
      // Monaco emits token/decorations colors in inline sheets. The large
      // workbench stylesheet has no token palette and need not be rescanned.
      if (sheet.ownerNode === style || sheet.href) continue;
      try { visit(sheet.cssRules); } catch { /* Ignore inaccessible external sheets. */ }
    }
    return result;
  }

  function countRoles() {
    const counts = Object.fromEntries(Object.keys(profiles).map(role => [role, 0]));
    let seen = 0;
    // Monaco only renders a viewport of lines. Cap work for very large/minified views.
    for (const token of document.querySelectorAll('.monaco-editor .view-lines .view-line [class*="mtk"]')) {
      if (++seen > 5000) break;
      if (!token.textContent.trim()) continue;
      const names = [...token.classList];
      const name = names.find(value => value.startsWith('ced-') && classRoles.has(value))
        || names.find(value => /^mtk\d+$/.test(value));
      if (name) counts[classRoles.get(name) || 'text']++;
    }
    return counts;
  }

  function update() {
    timer = null;
    if (disposed) return;
    const workbench = document.querySelector('.monaco-workbench');
    if (!workbench) return;
    const colors = getComputedStyle(workbench);
    const marker = colors.getPropertyValue('--vscode-dark2026OneDarkPro-glow').trim().toLowerCase();
    active = marker === '#fc28a8' || marker === '#fc28a8ff';
    workbench.classList.toggle('dark2026-synthwave', active);
    updateStatusbar(workbench, colors);
    if (!active) return;
    if (rebuild) { classRoles = scanColors(); rebuild = false; }
    lastCounts = frequencyAware ? countRoles() : {};
    const total = Object.values(lastCounts).reduce((sum, value) => sum + value, 0);
    strengths = {};
    for (const [role, base] of Object.entries(profiles)) {
      const share = (1 + (lastCounts[role] || 0)) / (total + Object.keys(profiles).length);
      const rarity = frequencyAware && total ? clamp(Math.sqrt(0.1 / share), 0.65, 1.35) : 1;
      strengths[role] = Math.round(clamp(base * rarity * intensity, 0, 1.25) * 100) / 100;
    }
    // Decorations override a semantic provider's generic type color. Give their
    // glow role priority too, while keeping the hue tied to currentColor.
    const ordered = [...classRoles].sort(([a], [b]) => Number(a.startsWith('ced-')) - Number(b.startsWith('ced-')));
    const rules = ordered.map(([name, role]) =>
      `.dark2026-synthwave .monaco-editor .view-line .${name}{--synthwave-glow-strength:${strengths[role]};}`);
    const css = (options.css || '') + `\n.dark2026-synthwave{--synthwave-overall-intensity:${intensity};}\n` + rules.join('\n');
    if (style.textContent !== css) style.textContent = css;
  }

  function schedule(delay = 250, colorsChanged = false) {
    if (disposed) return;
    rebuild = rebuild || colorsChanged;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(update, delay);
  }
  const statusbarObserver = new MutationObserver(() => schedule(0));
  const themeObserver = new MutationObserver(records => {
    if (records.some(record => record.target !== style && !style.contains(record.target))) schedule(0, true);
  });
  themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  const editorObserver = new MutationObserver(records => {
    if (!workbenchSeen) {
      workbenchSeen = Boolean(document.querySelector('.monaco-workbench'));
      if (workbenchSeen) schedule(0, true);
      return;
    }
    if (!active) return;
    if (frequencyAware && records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return target?.closest('.monaco-editor .view-lines');
    })) schedule();
  });
  editorObserver.observe(document.body || document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'],
  });
  const api = {
    getStats: () => ({ active, debugging: Boolean(statusbar?.classList.contains('dark2026-synthwave-debugging')),
      counts: { ...lastCounts }, strengths: { ...strengths }, classes: classRoles.size }),
    dispose() {
      disposed = true;
      themeObserver.disconnect(); editorObserver.disconnect(); statusbarObserver.disconnect();
      if (timer !== null) clearTimeout(timer);
      document.querySelector('.monaco-workbench')?.classList.remove('dark2026-synthwave');
      statusbar?.classList.remove('dark2026-synthwave-debugging');
      style.remove();
      if (window.dark2026Synthwave === api) { delete window.dark2026Synthwave; delete window.dark2026SynthwaveOptions; }
    },
  };
  window.dark2026Synthwave = api;
  update();
})();
