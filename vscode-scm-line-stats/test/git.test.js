'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runGit, collectRepository, parseStatus, parseNumstat } = require('../src/git');

const fixtureRoot = path.resolve(__dirname, '../test-results/fixtures');

async function fixture(t) {
  await fs.mkdir(fixtureRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(fixtureRoot, 'repo-'));
  t.after(async () => {
    // Verify the resolved target before recursive cleanup on Windows.
    assert.equal(path.dirname(path.resolve(root)), fixtureRoot);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const git = (...args) => runGit('git', root, args);
  const write = (name, content) => fs.writeFile(path.join(root, name), content);
  const commit = async () => {
    await git('add', '--all');
    await git('-c', 'user.name=Stats Test', '-c', 'user.email=stats@example.invalid', 'commit', '-m', 'test fixture');
  };
  await git('init', '--initial-branch=main');
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'commit.gpgsign', 'false');
  return { root, git, write, commit, collect: options => collectRepository('git', root, options) };
}

test('partially staged files have independent counts for index and worktree', async t => {
  const repo = await fixture(t);
  await repo.write('app.ts', 'one\ntwo\nthree\n');
  await repo.commit();
  await repo.write('app.ts', 'one\nTWO\nthree\nfour\n');
  await repo.git('add', '--', 'app.ts');
  await repo.write('app.ts', 'ONE\nTWO\nthree\nfour\nfive\n');
  const snapshot = await repo.collect();
  assert.deepEqual([snapshot.staged.total.additions, snapshot.staged.total.deletions], [2, 1]);
  assert.deepEqual([snapshot.working.total.additions, snapshot.working.total.deletions], [2, 1]);
  assert.equal(snapshot.staged.entries[0].path, 'app.ts');
  assert.equal(snapshot.working.entries[0].path, 'app.ts');
  await repo.git('reset', '--', 'app.ts');
  const unstaged = await repo.collect();
  assert.equal(unstaged.staged.total.files, 0);
  assert.deepEqual([unstaged.working.total.additions, unstaged.working.total.deletions], [4, 2]);
});

test('untracked files: empty, CRLF, missing newline, unicode, ignored and binary', async t => {
  const repo = await fixture(t);
  await repo.write('.gitignore', '*.ignored\n');
  await repo.commit();
  await repo.write('空 文件.txt', '第一行\r\n第二行');
  await repo.write('empty.txt', '');
  await repo.write('crlf.txt', 'one\r\ntwo\r\n');
  await repo.write('picture.bin', Buffer.from([1, 0, 2, 10, 3]));
  await repo.write('secret.ignored', 'ignored\n');
  const snapshot = await repo.collect();
  assert.equal(snapshot.working.total.additions, 4);
  assert.equal(snapshot.working.total.deletions, 0);
  assert.equal(snapshot.working.total.files, 4);
  assert.equal(snapshot.working.total.binary, 1);
  assert.equal(snapshot.working.entries.find(entry => entry.path === '空 文件.txt').additions, 2);
  assert.equal((await repo.collect({ includeUntracked: false })).working.total.files, 0);
});

test('new staged file with no HEAD, then deletion in worktree', async t => {
  const repo = await fixture(t);
  await repo.write('new.txt', 'one\ntwo');
  await repo.git('add', '--', 'new.txt');
  await fs.unlink(path.join(repo.root, 'new.txt'));
  const snapshot = await repo.collect();
  assert.deepEqual([snapshot.staged.total.additions, snapshot.staged.total.deletions], [2, 0]);
  assert.deepEqual([snapshot.working.total.additions, snapshot.working.total.deletions], [0, 2]);
  assert.equal(snapshot.staged.entries[0].status, 'A');
  assert.equal(snapshot.working.entries[0].status, 'D');
});

test('rename with edits, staged deletion and unstaged deletion', async t => {
  const repo = await fixture(t);
  const baseline = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join('');
  await repo.write('old name.txt', baseline);
  await repo.write('staged-delete.txt', 'one\ntwo\n');
  await repo.write('worktree-delete.txt', 'one\ntwo\nthree');
  await repo.commit();
  await repo.git('mv', '--', 'old name.txt', '新 名称.txt');
  await repo.write('新 名称.txt', `${baseline}extra\n`);
  await repo.git('add', '--', '新 名称.txt');
  await repo.git('rm', '--', 'staged-delete.txt');
  await fs.unlink(path.join(repo.root, 'worktree-delete.txt'));
  const snapshot = await repo.collect();
  const renamed = snapshot.staged.entries.find(entry => entry.path === '新 名称.txt');
  assert.equal(renamed.status, 'R');
  assert.equal(renamed.originalPath, 'old name.txt');
  assert.deepEqual([renamed.additions, renamed.deletions], [1, 0]);
  assert.deepEqual([snapshot.staged.total.additions, snapshot.staged.total.deletions], [1, 2]);
  assert.deepEqual([snapshot.working.total.additions, snapshot.working.total.deletions], [0, 3]);
});

test('tracked binaries in both groups do not contribute invented line counts', async t => {
  const repo = await fixture(t);
  await repo.write('image.bin', Buffer.from([0, 1, 2, 10]));
  await repo.commit();
  await repo.write('image.bin', Buffer.from([0, 3, 4, 10, 10]));
  await repo.git('add', '--', 'image.bin');
  await repo.write('image.bin', Buffer.from([0, 5, 6, 10, 10, 10]));
  const snapshot = await repo.collect();
  for (const group of [snapshot.working, snapshot.staged]) {
    assert.equal(group.total.binary, 1);
    assert.equal(group.total.additions, 0);
    assert.equal(group.total.deletions, 0);
  }
});

test('real merge conflict is shown separately from numeric totals', async t => {
  const repo = await fixture(t);
  await repo.write('conflict.txt', 'base\n');
  await repo.commit();
  await repo.git('checkout', '-b', 'other');
  await repo.write('conflict.txt', 'other\n');
  await repo.commit();
  await repo.git('checkout', 'main');
  await repo.write('conflict.txt', 'main\n');
  await repo.commit();
  await assert.rejects(repo.git('-c', 'user.name=Stats Test', '-c', 'user.email=stats@example.invalid', 'merge', 'other'));
  const snapshot = await repo.collect();
  assert.equal(snapshot.working.total.conflicts, 1);
  assert.equal(snapshot.working.total.additions, 0);
  assert.equal(snapshot.working.total.deletions, 0);
  assert.equal(snapshot.staged.total.files, 0);
});

test('clean repository has two zero totals and no file entries', async t => {
  const repo = await fixture(t);
  await repo.write('clean.txt', 'unchanged\n');
  await repo.commit();
  const snapshot = await repo.collect();
  for (const group of [snapshot.working, snapshot.staged]) {
    assert.equal(group.total.files, 0);
    assert.equal(group.total.additions, 0);
    assert.equal(group.total.deletions, 0);
  }
});

test('NUL parsers preserve tabs/newlines and use the destination of renames', () => {
  const stats = parseNumstat(Buffer.from('2\t1\tline\nwith\ttab.txt\0' + '0\t0\t\0old.txt\0新.txt\0-\t-\timage.bin\0'));
  assert.equal(stats.get('line\nwith\ttab.txt').additions, 2);
  assert.equal(stats.get('新.txt').originalPath, 'old.txt');
  assert.equal(stats.get('image.bin').kind, 'binary');
  const status = parseStatus(Buffer.from('RM 新.txt\0old.txt\0?? line\nwith\ttab.txt\0'));
  assert.equal(status[0].path, '新.txt');
  assert.equal(status[0].originalPath, 'old.txt');
  assert.equal(status[0].worktree, 'M');
  assert.equal(status[1].path, 'line\nwith\ttab.txt');
});
