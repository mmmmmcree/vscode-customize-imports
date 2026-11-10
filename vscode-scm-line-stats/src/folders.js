'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { normalizePath, snapshotName } = require('../media/protocol');

function folderKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function buildFolderStats(results) {
  const folders = new Map();
  // A nested repository owns its directories when the parent also has changes.
  const repositories = results.filter(result => !result.error).sort((a, b) => a.root.length - b.root.length);
  for (const result of repositories) {
    const root = path.resolve(result.root);
    const current = new Map();
    for (const group of ['working', 'staged']) {
      const seen = new Set();
      for (const entry of result[group].entries) {
        const file = path.resolve(root, entry.path);
        const relative = path.relative(root, file);
        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || seen.has(folderKey(file))) continue;
        seen.add(folderKey(file));
        let directory = path.dirname(file);
        while (true) {
          const key = folderKey(directory);
          if (!current.has(key)) current.set(key, { path: path.relative(root, directory).split(path.sep).join('/') || path.basename(root), root, groups: {} });
          const groups = current.get(key).groups;
          const total = groups[group] ||= { additions: 0, deletions: 0, files: 0, binary: 0, conflicts: 0, unavailable: 0 };
          total.files++;
          if (entry.kind === 'text') { total.additions += entry.additions; total.deletions += entry.deletions; }
          else if (entry.kind === 'binary') total.binary++;
          else if (entry.kind === 'conflict') total.conflicts++;
          else total.unavailable++;
          if (folderKey(directory) === folderKey(root)) break;
          directory = path.dirname(directory);
        }
      }
    }
    for (const [key, value] of current) folders.set(key, value);
  }
  return folders;
}

async function writeFolderSnapshots(storageRoot, results, folders) {
  await fs.mkdir(storageRoot, { recursive: true });
  const repositories = new Map(results.map(result => [normalizePath(result.root), {}]));
  for (const [directory, data] of folders) repositories.get(normalizePath(data.root))[normalizePath(directory)] = { path: data.path, groups: data.groups };
  for (const [root, entries] of repositories) {
    const filename = path.join(storageRoot, snapshotName(root));
    const content = JSON.stringify({ root, folders: entries });
    if (await fs.readFile(filename, 'utf8').catch(() => '') === content) continue;
    const temporary = filename + `.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, filename);
  }
}

module.exports = { folderKey, buildFolderStats, writeFolderSnapshots };
