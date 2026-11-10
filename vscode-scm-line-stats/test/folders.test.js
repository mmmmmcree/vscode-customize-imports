'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { folderKey, buildFolderStats } = require('../src/folders');
const { normalizePath, snapshotName } = require('../media/protocol');

test('directories recursively count full model entries, separately for staged and working changes', () => {
  const root = path.resolve('repository');
  const text = (file, additions, deletions) => ({ path: file, kind: 'text', additions, deletions });
  const result = { root, working: { entries: [
    text('src/main.ts', 2, 1), text('src/nested/中文.ts', 5, 3), text('src-other/out.ts', 20, 1),
    { path: 'src/nested/image.png', kind: 'binary' }, { path: 'src/conflict.ts', kind: 'conflict' },
    text('src/main.ts', 2, 1), text('../outside.ts', 100, 100),
  ] }, staged: { entries: [text('src/main.ts', 8, 2), text('src/nested/中文.ts', 1, 1)] } };
  const folders = buildFolderStats([result, { root: '/failed', error: 'unavailable' }]);
  const src = folders.get(folderKey(path.join(root, 'src')));
  assert.deepEqual(src.groups.working, { additions: 7, deletions: 4, files: 4, binary: 1, conflicts: 1, unavailable: 0 });
  assert.equal(src.groups.staged.additions, 9);
  assert.equal(src.groups.staged.files, 2);
  assert.equal(folders.get(folderKey(path.join(root, 'src/nested'))).groups.working.additions, 5);
  assert.equal(folders.get(folderKey(root)).groups.working.additions, 27, 'parent includes nested files once');
  assert.equal(folders.has(folderKey(path.dirname(root))), false);
  assert.equal(folders.has(folderKey(path.join(root, 'src/main.ts'))), false);
  assert.equal(normalizePath('K:\\Repo\\src/'), 'k:/repo/src');
  assert.equal(snapshotName('K:\\Repo'), snapshotName('k:/repo'));
  assert.notEqual(snapshotName('/repo-a'), snapshotName('/repo-b'));
});

test('a nested repository keeps its own totals and cleared changes remove stale folders', () => {
  const root = path.resolve('parent');
  const nested = path.join(root, 'child');
  const repository = (root, file, additions) => ({ root, working: { entries: [{ path: file, kind: 'text', additions, deletions: 0 }] }, staged: { entries: [] } });
  const folders = buildFolderStats([repository(nested, 'src/a.ts', 2), repository(root, 'child/src/b.ts', 50)]);
  assert.equal(folders.get(folderKey(path.join(nested, 'src'))).groups.working.additions, 2);
  assert.equal(folders.get(folderKey(nested)).groups.working.additions, 2);
  assert.equal(buildFolderStats([]).size, 0);
});
