/* SCM Line Stats: native SCM hover cards. Loaded by Custom CSS and JS Loader. */
(() => {
  'use strict';
  function initialize() {
    const NAME = 'scmLineStatsNativeHover';
    const locale = window.scmLineStatsDisplayLanguage || window._VSCODE_NLS_LANGUAGE || document.documentElement.lang || 'en';
    const strings = window.scmLineStatsStrings?.createStrings(locale);
    if (!strings) return;
    window[NAME]?.dispose();
    const protocol = window.scmLineStatsProtocol;
    if (!protocol) return;
    const listeners = [];
    let showTimer;
    let hideTimer;
    let owner;
    let pendingOwner;
    let card;
    let disposed = false;
    let keyboardNavigation = false;
    let pointer;
    let ownerData;
    let reanchorTimer;
    let reanchorDeadline;

    const style = document.createElement('style');
    style.id = 'scm-line-stats-native-style';
    style.textContent = `
      .scm-lines-hover {
        position:fixed; z-index:100000; box-sizing:border-box; width:340px;
        max-width:calc(100vw - 24px); padding:0; border-radius:var(--vscode-cornerRadius-medium,5px);
        background:var(--vscode-editorHoverWidget-background,#252526);
        color:var(--vscode-editorHoverWidget-foreground,var(--vscode-foreground,#ccc));
        border:1px solid var(--vscode-editorHoverWidget-border,#454545);
        box-shadow:var(--vscode-shadow-lg,0 4px 12px #0005);
        font-family:var(--vscode-font-family,sans-serif); font-size:13px; line-height:19px;
        user-select:text; overflow:hidden;
      }
      .monaco-reduce-motion .scm-lines-hover.fade-in { animation:none; }
      .scm-lines-hover .sl-header { padding:12px 12px 8px; }
      .scm-lines-hover .sl-title { font-weight:600; overflow-wrap:anywhere; }
      .scm-lines-hover .sl-subtitle { color:var(--vscode-descriptionForeground,#aaa); font-size:12px; margin-top:3px; }
      .scm-lines-hover .sl-body { padding:0 12px 10px; }
      .scm-lines-hover .sl-metrics { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 16px; }
      .scm-lines-hover .sl-added { color:var(--vscode-scmGraph-historyItemHoverAdditionsForeground,var(--vscode-gitDecoration-addedResourceForeground,#81b88b)); }
      .scm-lines-hover .sl-deleted { color:var(--vscode-scmGraph-historyItemHoverDeletionsForeground,var(--vscode-gitDecoration-deletedResourceForeground,#c74e39)); }
      .scm-lines-hover .sl-value { font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; margin-right:4px; }
      .scm-lines-hover .sl-caption { font-size:12px; }
      .scm-lines-hover .sl-bar { display:flex; height:3px; border-radius:2px; overflow:hidden; margin-top:10px; background:var(--vscode-editorHoverWidget-border,#454545); }
      .scm-lines-hover .sl-bar-add { background:var(--vscode-scmGraph-historyItemHoverAdditionsForeground,var(--vscode-gitDecoration-addedResourceForeground,#81b88b)); }
      .scm-lines-hover .sl-bar-del { background:var(--vscode-scmGraph-historyItemHoverDeletionsForeground,var(--vscode-gitDecoration-deletedResourceForeground,#c74e39)); }
      .scm-lines-hover .sl-footer { border-top:1px solid var(--vscode-editorHoverWidget-border,#454545); margin:0 12px; padding:8px 0 10px; color:var(--vscode-descriptionForeground,#aaa); font-size:12px; overflow-wrap:anywhere; }
      .scm-lines-hover-open .monaco-hover:not(.scm-lines-hover) { visibility:hidden !important; }
    `;
    document.head.appendChild(style);

    function element(tag, className, text) {
      const node = document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    const folderCache = new Map();
    const repositoryRoots = new Set();
    let folderTimer;
    let loadSequence = 0;

    function directoryPath(target) {
      const label = target.querySelector('.folder-icon')?.getAttribute('aria-label');
      return label && protocol.normalizePath(label.split(' • ')[0]);
    }

    async function readFolderSnapshot(root, directory) {
      try {
        const response = await fetch(`${window.scmLineStatsStorageUrl}/${protocol.snapshotName(root)}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const snapshot = await response.json();
        if (snapshot.root !== root) return;
        const data = snapshot.folders[directory];
        if (data) { repositoryRoots.add(root); folderCache.set(directory, data); return data; }
      } catch { /* Closed repositories and in-progress updates have no card. */ }
    }

    async function loadFolder(target) {
      const directory = directoryPath(target);
      if (!directory || !window.scmLineStatsStorageUrl) return;
      const known = [...repositoryRoots].filter(root => directory === root || directory.startsWith(root + '/')).sort((a, b) => b.length - a.length);
      for (const root of known) if (await readFolderSnapshot(root, directory)) return;
      const roots = [];
      let root = directory;
      while (root) {
        if (!known.includes(root)) roots.push(root);
        const parent = root.slice(0, root.lastIndexOf('/'));
        if (!parent || parent === root) break;
        root = parent;
      }
      // The native label exposes the absolute directory, including when its
      // repository header is outside the virtualized tree. Find its repository
      // snapshot without depending on rendered child rows.
      const candidates = await Promise.all(roots.map(async root => ({ root, data: await readFolderSnapshot(root, directory) })));
      const nearest = candidates.find(candidate => candidate.data);
      if (nearest) folderCache.set(directory, nearest.data);
      else folderCache.delete(directory);
    }

    function folderData(target) {
      const metadata = folderCache.get(directoryPath(target));
      if (!metadata) return;
      // Folder actions identify the group even if the header is scrolled out.
      let staged;
      if (target.querySelector('.actions .codicon-remove')) staged = true;
      else if (target.querySelector('.actions .codicon-add')) staged = false;
      else {
        let row = target.closest('.monaco-list-row')?.previousElementSibling;
        while (row) {
          const group = row.querySelector('.resource-group .name');
          if (group) { staged = protocol.parseGroupLabel(group.textContent)?.staged; break; }
          row = row.previousElementSibling;
        }
      }
      if (staged === undefined) return;
      const total = metadata.groups[staged ? 'staged' : 'working'];
      if (!total) return;
      const parts = [strings.savedOnly];
      if (total.binary) parts.push(strings.format('binaryFiles', total.binary));
      if (total.conflicts) parts.push(strings.format('conflicts', total.conflicts));
      if (total.unavailable) parts.push(strings.format('unavailableFiles', total.unavailable));
      return { title: metadata.path, additions: total.additions, deletions: total.deletions,
        subtitle: `${staged ? strings.staged : strings.changes} · ${strings.format('files', total.files)} · ${staged ? strings.headIndex : strings.indexWorktree}`,
        footer: parts.join(' · ') };
    }

    async function showAfterDelay(target) {
      const sequence = ++loadSequence;
      if (target?.querySelector('.folder-icon')) await loadFolder(target);
      if (disposed || sequence !== loadSequence) return;
      const current = pointer && targetFor({ target: document.elementFromPoint(pointer.x, pointer.y) });
      pendingOwner = undefined;
      if (current === target) show(current);
    }

    function scheduleFolderRefresh() {
      clearTimeout(folderTimer);
      if (!owner?.querySelector('.folder-icon')) return;
      folderTimer = setTimeout(async () => {
        const target = owner;
        await loadFolder(target);
        if (target !== owner || !card) return;
        const data = dataFor(target);
        if (data) { ownerData = data; fill(data); position(); scheduleFolderRefresh(); }
        else hide();
      }, 500);
    }

    function dataFor(target) {
      if (target.querySelector('.folder-icon')) return folderData(target);
      if (target.matches('.resource-group')) {
        const data = protocol.parseGroupLabel(target.querySelector('.name')?.textContent || '');
        if (!data) return;
        const fileCount = Number(target.querySelector('.count')?.textContent.trim()) || 0;
        // Staging group labels come from Git's current display language.
        const staged = data.staged;
        return { ...data, subtitle: `${strings.format('files', fileCount)} · ${staged ? strings.headIndex : strings.indexWorktree}`,
          footer: strings.savedOnly };
      }
      const tooltip = target.getAttribute('data-tooltip') || '';
      if (!tooltip.endsWith('\u2063')) return;
      const lines = tooltip.slice(0, -1).split('\n');
      const total = lines.pop();
      const filePath = lines.pop();
      const match = /^(.+): (.+)$/.exec(lines.pop());
      if (!match) return;
      const counts = /^\+(\d+) −(\d+)$/.exec(match[2]);
      return {
        title: filePath || target.querySelector('.label-name')?.textContent || strings.changes,
        subtitle: `${match[1]} · ${tooltip.split('\n')[0]}`,
        additions: counts ? Number(counts[1]) : undefined,
        deletions: counts ? Number(counts[2]) : undefined,
        note: counts ? undefined : match[2],
        footer: total || strings.savedOnly,
      };
    }

    function fill(data) {
      card.replaceChildren();
      const header = element('div', 'sl-header');
      header.append(element('div', 'sl-title', data.title), element('div', 'sl-subtitle', data.subtitle));
      const body = element('div', 'sl-body');
      if (data.additions === undefined) body.append(element('div', 'sl-note', data.note));
      else {
        const metrics = element('div', 'sl-metrics');
        for (const [className, sign, value, caption] of [
          ['sl-added', '+', data.additions, strings.added], ['sl-deleted', '−', data.deletions, strings.deleted],
        ]) {
          const metric = element('div', className);
          metric.append(element('span', 'sl-value', `${sign}${value}`), element('span', 'sl-caption', caption));
          metrics.append(metric);
        }
        body.append(metrics);
        const bar = element('div', 'sl-bar');
        bar.setAttribute('aria-hidden', 'true');
        const sum = data.additions + data.deletions;
        for (const [className, value] of [['sl-bar-add', data.additions], ['sl-bar-del', data.deletions]]) {
          const segment = element('span', className);
          segment.style.width = `${sum ? value / sum * 100 : 0}%`;
          bar.append(segment);
        }
        body.append(bar);
      }
      card.append(header, body, element('div', 'sl-footer', data.footer));
    }

    function hide() {
      loadSequence++;
      clearTimeout(folderTimer);
      clearTimeout(reanchorTimer);
      reanchorTimer = undefined;
      ownerData = undefined;
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      card?.remove();
      card = undefined;
      if (owner) {
        const ids = (owner.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'scm-line-stats-hover');
        if (ids.length) owner.setAttribute('aria-describedby', ids.join(' '));
        else owner.removeAttribute('aria-describedby');
      }
      owner = undefined;
      pendingOwner = undefined;
      document.querySelector('.monaco-workbench')?.classList.remove('scm-lines-hover-open');
    }

    function position() {
      if (!owner?.isConnected || !card) { hide(); return; }
      const rect = owner.getBoundingClientRect();
      const size = card.getBoundingClientRect();
      let left = rect.right + 8;
      if (left + size.width > innerWidth - 12) left = rect.left - size.width - 8;
      left = Math.max(12, Math.min(left, innerWidth - size.width - 12));
      const top = Math.max(12, Math.min(rect.top, innerHeight - size.height - 12));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    function show(target, animate = true) {
      const data = dataFor(target);
      if (!data || !target.isConnected || disposed) return;
      const fadeIn = animate && !card;
      hide();
      owner = target;
      ownerData = data;
      // Reuse the same 100 ms fade-in that VS Code uses for native hovers.
      card = element('div', `scm-lines-hover monaco-hover${fadeIn ? ' fade-in' : ''}`);
      card.id = 'scm-line-stats-hover';
      card.setAttribute('role', 'tooltip');
      fill(data);
      const workbench = document.querySelector('.monaco-workbench') || document.body;
      workbench.appendChild(card);
      workbench.classList.add('scm-lines-hover-open');
      const existing = owner.getAttribute('aria-describedby');
      owner.setAttribute('aria-describedby', [existing, card.id].filter(Boolean).join(' '));
      position();
      scheduleFolderRefresh();
    }

    function targetFor(event) {
      if (!(event.target instanceof Element) || event.target.closest('.actions, .action-label, .monaco-tl-twistie')) return;
      return event.target.closest('.resource-group, .resource[data-tooltip]');
    }

    function over(event) {
      keyboardNavigation = false;
      pointer = { x: event.clientX, y: event.clientY };
      if (card?.contains(event.target)) { clearTimeout(hideTimer); return; }
      const target = targetFor(event);
      if (!target || (!target.querySelector('.folder-icon') && !dataFor(target))) return;
      if (target === owner || target === pendingOwner) { clearTimeout(hideTimer); return; }
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      pendingOwner = target;
      showTimer = setTimeout(() => { void showAfterDelay(target); }, 350);
    }

    function out(event) {
      if (owner?.contains(event.relatedTarget) || pendingOwner?.contains(event.relatedTarget) || card?.contains(event.relatedTarget)) return;
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      loadSequence++;
      pendingOwner = undefined;
      hideTimer = setTimeout(hide, 120);
    }

    function listen(target, name, callback, options) {
      target.addEventListener(name, callback, options);
      listeners.push(() => target.removeEventListener(name, callback, options));
    }

    function refreshAnchor() {
      reanchorTimer = undefined;
      if (!owner || !card) return;
      const current = owner.isConnected ? owner
        : pointer && targetFor({ target: document.elementFromPoint(pointer.x, pointer.y) });
      const data = current && dataFor(current);
      if (data && data.title === ownerData.title && data.subtitle === ownerData.subtitle) {
        if (current !== owner) show(current, false);
        else { ownerData = data; fill(data); position(); }
      } else if (Date.now() < reanchorDeadline) {
        reanchorTimer = setTimeout(refreshAnchor, 50);
      } else hide();
    }

    const observer = new MutationObserver(records => {
      if (!owner || !card) return;
      if (owner.isConnected && !records.some(record => record.target === owner || owner.contains(record.target))) return;
      const data = owner.isConnected && dataFor(owner);
      if (data) { ownerData = data; fill(data); position(); }
      else if (!reanchorTimer) {
        // Git briefly replaces the decorated row with an undecorated resource
        // before fresh statistics arrive. Keep an already-open card through
        // that refresh, without opening cards in response to editing/saving.
        reanchorDeadline = Date.now() + 1500;
        reanchorTimer = setTimeout(refreshAnchor, 50);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-tooltip', 'aria-label'] });
    listen(document, 'pointerover', over, true);
    listen(document, 'pointermove', over, true);
    listen(document, 'pointerout', out, true);
    listen(document, 'focusin', event => {
      if (!keyboardNavigation) return;
      const row = event.target.closest?.('.monaco-list-row');
      const target = row?.querySelector('.resource-group, .resource[data-tooltip]');
      if (target && (target.querySelector('.folder-icon') || dataFor(target))) {
        clearTimeout(showTimer);
        showTimer = setTimeout(async () => {
          if (target.querySelector('.folder-icon')) await loadFolder(target);
          if (row.contains(document.activeElement)) show(target);
        }, 350);
      }
    }, true);
    listen(document, 'keydown', event => {
      if (event.key === 'Tab' || event.key.startsWith('Arrow')) keyboardNavigation = true;
      if (event.key === 'Escape') hide();
    }, true);
    listen(document, 'pointerdown', event => { if (!card?.contains(event.target)) hide(); }, true);
    listen(document, 'scroll', event => {
      // VS Code's own tooltip can scroll during layout; only SCM scrolling
      // moves our anchor and should dismiss the card.
      const anchor = owner || pendingOwner;
      if (anchor && (event.target === document || event.target.contains?.(anchor))) hide();
    }, true);
    listen(window, 'blur', hide);
    listen(window, 'resize', hide);

    window[NAME] = {
      version: '0.2.6',
      showForElement: show,
      dispose() {
        disposed = true;
        observer.disconnect();
        listeners.forEach(remove => remove());
        hide();
        style.remove();
        delete window[NAME];
      },
    };
  }
  // Custom CSS and JS Loader injects scripts into <head>, before body exists.
  // Wait for parsed DOM and VS Code's locale before attaching the observer.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
