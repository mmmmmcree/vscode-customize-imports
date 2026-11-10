'use strict';

const path = require('node:path');

const { groupLabel, stripGroupLabel } = require('../media/protocol');

function key(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// Git's public API does not expose its SCM groups. Keep this small compatibility
// adapter separate, check capabilities, and restore every wrapper on disposal.
class NativeIntegration {
  constructor(gitExports, output, strings) {
    this.gitExports = gitExports;
    this.output = output;
    this.strings = strings;
    this.groups = new Map();
    this.wrappers = new WeakMap();
  }

  unwrap(resource) {
    return this.wrappers.get(resource)?.original || resource;
  }

  apply(results, mode = 'hover') {
    const repositories = this.gitExports.model?.repositories;
    if (!Array.isArray(repositories)) return false;
    const currentGroups = new Set();
    let supported = true;
    for (const result of results) {
      const repository = repositories.find(repo => typeof repo.root === 'string' && key(repo.root) === key(result.root));
      if (!repository?.workingTreeGroup || !repository?.indexGroup) { supported = false; continue; }
      const definitions = [
        [repository.workingTreeGroup, result.working],
        [repository.indexGroup, result.staged],
        [repository.untrackedGroup, result.working],
        [repository.mergeGroup, result.working],
      ];
      for (const [group, data] of definitions) {
        if (!group) continue;
        currentGroups.add(group);
        if (result.error || !data) { this.restoreGroup(group); continue; }
        const entries = new Map(data.entries.map(entry => [key(path.join(result.root, entry.path)), entry]));
        const states = group.resourceStates;
        const baseLabel = stripGroupLabel(group.label);
        this.groups.set(group, { label: baseLabel });
        const relevant = states.map(resource => entries.get(key(resource.resourceUri.fsPath))).filter(Boolean);
        const additions = relevant.reduce((sum, entry) => sum + (entry.kind === 'text' ? entry.additions : 0), 0);
        const deletions = relevant.reduce((sum, entry) => sum + (entry.kind === 'text' ? entry.deletions : 0), 0);
        const label = groupLabel(baseLabel, group.id === 'index', additions, deletions, mode);
        if (group.label !== label) group.label = label;
        let changed = false;
        const wrapped = states.map(resource => {
          const original = this.unwrap(resource);
          const entry = entries.get(key(original.resourceUri.fsPath));
          if (!entry) { if (original !== resource) changed = true; return original; }
          const count = entry.kind === 'text' ? `+${entry.additions} −${entry.deletions}`
            : this.strings[entry.kind];
          const tooltip = `${original.decorations?.tooltip || ''}\n${baseLabel}: ${count}\n${entry.path}\n${this.strings.groupTotal}: +${additions} −${deletions} · ${this.strings.format('files', states.length)}\u2063`;
          if (this.wrappers.get(resource)?.tooltip === tooltip) return resource;
          const proxy = new Proxy(original, {
            get(target, property) {
              if (property === 'decorations') return { ...Reflect.get(target, property, target), tooltip };
              if (property === 'tooltip') return tooltip;
              // Git resources contain private fields: getters and methods must
              // execute on the original instance, preserving commands and types.
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          this.wrappers.set(proxy, { original, tooltip });
          changed = true;
          return proxy;
        });
        if (changed) group.resourceStates = wrapped;
      }
    }
    for (const group of this.groups.keys()) if (!currentGroups.has(group)) this.restoreGroup(group);
    return supported;
  }

  restoreGroup(group) {
    const state = this.groups.get(group);
    if (!state) return;
    try {
      if (!group.disposed) {
        group.label = state.label;
        const resources = group.resourceStates;
        if (resources.some(resource => this.wrappers.has(resource))) group.resourceStates = resources.map(resource => this.unwrap(resource));
      }
    } catch (error) {
      this.output.appendLine(`${this.strings.restoreGroups}: ${error.message}`);
    }
    this.groups.delete(group);
  }

  dispose() {
    for (const group of [...this.groups.keys()]) this.restoreGroup(group);
  }
}

module.exports = { NativeIntegration };
