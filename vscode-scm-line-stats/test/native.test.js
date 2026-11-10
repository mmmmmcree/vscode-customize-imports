'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { NativeIntegration } = require('../src/native');
const { parseGroupLabel } = require('../media/protocol');
const { createStrings } = require('../media/strings');

test('default native groups never expose inline counts before or after saved changes', () => {
  const root = path.resolve('example');
  const resource = { resourceUri: { fsPath: path.join(root, 'app.ts') }, decorations: { tooltip: 'Modified' } };
  const workingTreeGroup = { id: 'workingTree', label: 'Changes', resourceStates: [resource] };
  const indexGroup = { id: 'index', label: 'Staged Changes', resourceStates: [resource] };
  const adapter = new NativeIntegration({ model: { repositories: [{ root, workingTreeGroup, indexGroup }] } }, { appendLine() {} }, createStrings('en'));
  const group = additions => ({ entries: [{ path: 'app.ts', kind: 'text', additions, deletions: 1 }] });
  const result = { root, working: group(2), staged: group(4) };
  assert.equal(adapter.apply([result]), true);
  const visible = label => label.replace(/[\u2060\u2063\uFE00-\uFE0F]/gu, '');
  assert.equal(visible(workingTreeGroup.label), 'Changes');
  assert.equal(visible(indexGroup.label), 'Staged Changes');
  assert.doesNotMatch(workingTreeGroup.label + indexGroup.label, /[+−\d]/u);
  assert.deepEqual(parseGroupLabel(workingTreeGroup.label), { title: 'Changes', staged: false, additions: 2, deletions: 1 });
  assert.deepEqual(parseGroupLabel(indexGroup.label), { title: 'Staged Changes', staged: true, additions: 4, deletions: 1 });
  result.working = group(3);
  adapter.apply([result]);
  assert.equal(visible(workingTreeGroup.label), 'Changes');
  assert.equal(parseGroupLabel(workingTreeGroup.label).additions, 3);
  assert.equal(parseGroupLabel(indexGroup.label).additions, 4);
  adapter.apply([result], 'inline');
  assert.match(workingTreeGroup.label, /\+3 −1/u);
  adapter.apply([result]);
  assert.doesNotMatch(workingTreeGroup.label, /[+−\d]/u);
  adapter.dispose();
  assert.equal(workingTreeGroup.label, 'Changes');
  assert.equal(indexGroup.label, 'Staged Changes');
  assert.equal(workingTreeGroup.resourceStates[0], resource);
});
