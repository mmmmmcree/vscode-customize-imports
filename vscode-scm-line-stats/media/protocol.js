/* Invisible metadata keeps native SCM labels free of inline counts, even before the renderer loads. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.scmLineStatsProtocol = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const hidden = /\u2063([\uFE00-\uFE01])\u2060([\uFE00-\uFE0F]+)\u2060([\uFE00-\uFE0F]+)\u2063$/u;
  const legacy = /\u2060?\u2009[\[(]\+\d+ −\d+[\])]$/u;
  const encode = value => value.toString(16).replace(/./g, digit => String.fromCharCode(0xFE00 + parseInt(digit, 16)));
  const decode = value => parseInt(Array.from(value, digit => (digit.charCodeAt(0) - 0xFE00).toString(16)).join(''), 16);

  function stripGroupLabel(label) {
    return label.replace(hidden, '').replace(legacy, '');
  }

  function groupLabel(title, staged, additions, deletions, mode = 'hover') {
    title = stripGroupLabel(title);
    if (mode === 'inline') return `${title}${staged ? '\u2060' : ''}\u2009(+${additions} −${deletions})`;
    return `${title}\u2063${staged ? '\uFE01' : '\uFE00'}\u2060${encode(additions)}\u2060${encode(deletions)}\u2063`;
  }

  function parseGroupLabel(label) {
    const match = hidden.exec(label);
    if (match) return { title: label.slice(0, match.index), staged: match[1] === '\uFE01', additions: decode(match[2]), deletions: decode(match[3]) };
    const old = /^(.*?)(\u2060?)\u2009[\[(]\+(\d+) −(\d+)[\])]$/u.exec(label);
    if (old) return { title: old[1], staged: Boolean(old[2]), additions: Number(old[3]), deletions: Number(old[4]) };
  }

  function normalizePath(value) {
    let normalized = value.replace(/\\/g, '/').replace(/\/$/, '');
    if (/^(?:[A-Za-z]:|\/\/)/.test(normalized)) normalized = normalized.toLowerCase();
    return normalized;
  }

  function snapshotName(root) {
    // Same deterministic filename in the extension host and sandboxed UI.
    // The snapshot also checks its root, so a hash collision cannot mix totals.
    let hash = 0xcbf29ce484222325n;
    for (const char of normalizePath(root)) {
      hash ^= BigInt(char.codePointAt(0));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return `folders-${hash.toString(16)}.json`;
  }

  return { groupLabel, parseGroupLabel, stripGroupLabel, normalizePath, snapshotName };
});
