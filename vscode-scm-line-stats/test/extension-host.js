'use strict';

// Runs in a real VS Code Extension Development Host with an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { StatsProvider } = require('../src/extension');

async function waitFor(predicate, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${message}`);
}

async function run() {
  const resultPath = path.resolve(__dirname, '../test-results/extension-host-result.json');
  const checks = [];
  let inspector;
  let output;
  try {
    const extension = vscode.extensions.getExtension('local-tools.scm-line-stats');
    assert.ok(extension, 'extension is discoverable');
    const api = await extension.activate();
    await waitFor(() => api.getSnapshot().length === 2, 'two Git repositories discovered');
    await api.refresh();
    const snapshot = api.getSnapshot().find(repo => path.basename(repo.root) === 'partial');
    assert.ok(snapshot && !snapshot.error, JSON.stringify(api.getSnapshot()));
    assert.deepEqual([snapshot.working.total.additions, snapshot.working.total.deletions], [2, 1]);
    assert.deepEqual([snapshot.staged.total.additions, snapshot.staged.total.deletions], [2, 1]);
    checks.push('real Git API activates, discovers multiple repositories and calculates separate counts');

    const nativeRepo = vscode.extensions.getExtension('vscode.git').exports.model.repositories.find(repo => path.resolve(repo.root).toLowerCase() === path.resolve(snapshot.root).toLowerCase());
    assert.ok(nativeRepo, 'internal adapter finds the original Git repository');
    assert.match(nativeRepo.workingTreeGroup.label, /\+2 −1/);
    assert.match(nativeRepo.indexGroup.label, /\+2 −1/);
    assert.match(nativeRepo.workingTreeGroup.resourceStates[0].decorations.tooltip, /: \+2 −1/);
    assert.match(nativeRepo.indexGroup.resourceStates[0].decorations.tooltip, /: \+2 −1/);
    const nativeCommand = nativeRepo.workingTreeGroup.resourceStates[0].command;
    await vscode.commands.executeCommand(nativeCommand.command, ...nativeCommand.arguments);
    checks.push('original Git groups receive independent tooltips and their native open commands still work');

    output = vscode.window.createOutputChannel('Line Stats Smoke Test');
    inspector = new StatsProvider(output);
    inspector.results = api.getSnapshot();
    assert.equal(inspector.getChildren().length, 2);
    const groups = inspector.getChildren(snapshot);
    const working = groups.find(group => group.group === 'working');
    const staged = groups.find(group => group.group === 'staged');
    for (const group of groups) {
      const item = inspector.getTreeItem(group);
      assert.match(item.tooltip, /\+2 −1/);
      assert.doesNotMatch(item.description, /[+−]\d/);
      const file = inspector.getChildren(group)[0];
      const fileItem = inspector.getTreeItem(file);
      assert.match(fileItem.tooltip, /\+2 −1/);
      assert.doesNotMatch(fileItem.description, /[+−]\d/);
    }
    checks.push('hover mode hides persistent counts and shows separate totals and file counts in tooltips');

    const config = vscode.workspace.getConfiguration('scmLineStats');
    await config.update('displayMode', 'inline', vscode.ConfigurationTarget.Global);
    assert.match(inspector.getTreeItem(working).description, /\+2 −1/);
    await config.update('displayMode', 'hover', vscode.ConfigurationTarget.Global);
    checks.push('inline mode is optional; hover remains the default');

    const openDiff = async node => {
      await vscode.commands.executeCommand('scmLineStats.openDiff', node);
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(tab?.input instanceof vscode.TabInputTextDiff, 'a native diff editor is opened');
      const left = await vscode.workspace.openTextDocument(tab.input.original);
      const right = await vscode.workspace.openTextDocument(tab.input.modified);
      return { left: left.getText(), right: right.getText() };
    };
    const stagedFile = inspector.getChildren(staged)[0];
    const workingFile = inspector.getChildren(working)[0];
    const stagedDiff = await openDiff(stagedFile);
    assert.equal(stagedDiff.left, 'one\ntwo\nthree\n');
    assert.equal(stagedDiff.right, 'one\nTWO\nthree\nfour\n');
    const workingDiff = await openDiff(workingFile);
    assert.equal(workingDiff.left, stagedDiff.right);
    assert.equal(workingDiff.right, 'ONE\nTWO\nthree\nfour\nfive\n');
    checks.push('native diff editors use HEAD → index and index → worktree correctly');

    const uri = vscode.Uri.file(path.join(snapshot.root, 'app.ts'));
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, document.positionAt(document.getText().length), 'six\n');
    await vscode.workspace.applyEdit(edit);
    await document.save();
    await waitFor(() => api.getSnapshot().find(repo => repo.root === snapshot.root)?.working.total.additions === 3, 'save automatically refreshes');
    checks.push('saving a file automatically updates counts');

    await snapshot.repository.add([uri.fsPath]);
    await waitFor(() => {
      const current = api.getSnapshot().find(repo => repo.root === snapshot.root);
      return current?.working.total.files === 0 && current?.staged.total.additions === 5;
    }, 'staging automatically refreshes both groups');
    checks.push('staging automatically moves counts to the staged group');
    assert.match(nativeRepo.indexGroup.label, /\+5 −2/);
    assert.match(nativeRepo.indexGroup.resourceStates[0].decorations.tooltip, /: \+5 −2/);

    const current = api.getSnapshot().find(repo => repo.root === snapshot.root);
    const newStagedFile = inspector.getChildren(inspector.getChildren(current).find(group => group.group === 'staged'))[0];
    const updatedDiff = await openDiff(newStagedFile);
    assert.equal(updatedDiff.right, 'ONE\nTWO\nthree\nfour\nfive\nsix\n');
    checks.push('reopened diffs load fresh index content after staging');

    await config.update('presentation', 'panel', vscode.ConfigurationTarget.Global);
    await api.refresh();
    assert.doesNotMatch(nativeRepo.indexGroup.label, /[+−]\d/);
    assert.doesNotMatch(nativeRepo.indexGroup.resourceStates[0].decorations.tooltip, /\u2063/);
    checks.push('switching to panel restores original Git labels and resource objects');
    await vscode.commands.executeCommand('scmLineStats.changes.focus');
    await fs.writeFile(resultPath, JSON.stringify({ passed: true, checks }, null, 2));
    console.log(`SCM_LINE_STATS_SMOKE_OK ${checks.length} checks`);
  } catch (error) {
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.writeFile(resultPath, JSON.stringify({ passed: false, checks, error: error.stack }, null, 2));
    throw error;
  } finally {
    inspector?.dispose();
    output?.dispose();
  }
}

module.exports = { run };
