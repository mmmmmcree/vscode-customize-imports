'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function runGit(gitPath, root, args, gitEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile(gitPath, args, {
      cwd: root,
      env: { ...process.env, ...gitEnv, GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'buffer', windowsHide: true, timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${args[0]}: ${stderr.toString('utf8').trim() || error.message}`;
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

// -z keeps spaces, tabs, newlines and non-ASCII filenames unambiguous.
function parseNumstat(buffer) {
  const fields = buffer.toString('utf8').split('\0');
  const stats = new Map();
  for (let i = 0; i < fields.length && fields[i]; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i]);
    if (!match) throw new Error('Invalid Git numstat output');
    let filePath = match[3];
    let originalPath;
    if (!filePath) {
      originalPath = fields[++i];
      filePath = fields[++i];
      if (!originalPath || !filePath) throw new Error('Incomplete Git rename record');
    }
    stats.set(filePath, {
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
      kind: match[1] === '-' || match[2] === '-' ? 'binary' : 'text',
      originalPath,
    });
  }
  return stats;
}

function parseStatus(buffer) {
  const fields = buffer.toString('utf8').split('\0');
  const result = [];
  for (let i = 0; i < fields.length && fields[i]; i++) {
    const record = fields[i];
    if (record.length < 4 || record[2] !== ' ') throw new Error('Invalid Git status output');
    const entry = { index: record[0], worktree: record[1], path: record.slice(3) };
    if (/[RC]/.test(entry.index + entry.worktree)) {
      entry.originalPath = fields[++i];
      if (!entry.originalPath) throw new Error('Incomplete Git rename status');
    }
    result.push(entry);
  }
  return result;
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function countUntracked(filePath) {
  const info = await fs.promises.lstat(filePath);
  if (info.isSymbolicLink()) {
    const target = await fs.promises.readlink(filePath);
    const newlines = (target.match(/\n/g) || []).length;
    return { additions: newlines + (target && !target.endsWith('\n') ? 1 : 0), deletions: 0, kind: 'text' };
  }
  if (!info.isFile()) return { additions: 0, deletions: 0, kind: 'other' };
  let bytes = 0;
  let newlines = 0;
  let lastByte;
  const stream = fs.createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      // Git's usual binary heuristic: a NUL in the first 8000 bytes.
      if (bytes < 8000 && chunk.subarray(0, 8000 - bytes).includes(0)) {
        return { additions: 0, deletions: 0, kind: 'binary' };
      }
      for (const byte of chunk) if (byte === 10) newlines++;
      bytes += chunk.length;
      lastByte = chunk[chunk.length - 1];
    }
  } finally {
    stream.destroy();
  }
  return { additions: newlines + (bytes && lastByte !== 10 ? 1 : 0), deletions: 0, kind: 'text' };
}

function summarize(entries) {
  const total = { additions: 0, deletions: 0, files: entries.length, binary: 0, conflicts: 0, unavailable: 0 };
  for (const entry of entries) {
    if (entry.kind === 'text') {
      total.additions += entry.additions;
      total.deletions += entry.deletions;
    } else if (entry.kind === 'binary') total.binary++;
    else if (entry.kind === 'conflict') total.conflicts++;
    else total.unavailable++;
  }
  return total;
}

async function collectRepository(gitPath, root, options = {}) {
  const diffArgs = ['--numstat', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all'];
  const [statusBuffer, worktreeBuffer, indexBuffer] = await Promise.all([
    runGit(gitPath, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], options.gitEnv),
    runGit(gitPath, root, ['diff', ...diffArgs, '--'], options.gitEnv),
    runGit(gitPath, root, ['diff', '--cached', ...diffArgs, '--'], options.gitEnv),
  ]);
  const status = parseStatus(statusBuffer);
  const worktreeStats = parseNumstat(worktreeBuffer);
  const indexStats = parseNumstat(indexBuffer);
  const working = [];
  const staged = [];
  const untracked = [];
  for (const file of status) {
    const pair = file.index + file.worktree;
    if (pair === '!!') continue;
    if (pair === '??') {
      if (options.includeUntracked !== false) untracked.push(file);
      continue;
    }
    if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(pair)) {
      working.push({ ...file, status: pair, group: 'working', kind: 'conflict', additions: 0, deletions: 0 });
      continue;
    }
    if (file.index !== ' ') {
      staged.push({ ...file, ...indexStats.get(file.path), status: file.index, group: 'staged' });
    }
    if (file.worktree !== ' ') {
      working.push({ ...file, ...worktreeStats.get(file.path), status: file.worktree, group: 'working' });
    }
  }
  const counted = await mapLimit(untracked, 4, async file => {
    try {
      return { ...file, ...await countUntracked(path.join(root, file.path)), status: '?', group: 'working' };
    } catch (error) {
      // A file may disappear or become unreadable during a refresh.
      return { ...file, kind: 'unavailable', status: '?', group: 'working', error: error.message };
    }
  });
  working.push(...counted);
  await mapLimit([...working, ...staged], 8, async entry => {
    if (!entry.kind) {
      const info = await fs.promises.lstat(path.join(root, entry.path)).catch(() => undefined);
      Object.assign(entry, { kind: info?.isDirectory() ? 'other' : 'text', additions: 0, deletions: 0 });
    }
  });
  const compare = (a, b) => a.path.localeCompare(b.path);
  working.sort(compare);
  staged.sort(compare);
  return {
    root,
    working: { entries: working, total: summarize(working) },
    staged: { entries: staged, total: summarize(staged) },
  };
}

module.exports = { runGit, parseNumstat, parseStatus, countUntracked, summarize, collectRepository, mapLimit };
