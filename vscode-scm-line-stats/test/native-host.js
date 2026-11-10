'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const base = path.resolve(__dirname, '../test-results');
  const extension = vscode.extensions.getExtension('local-tools.scm-line-stats');
  const api = await extension.activate();
  const deadline = Date.now() + 20000;
  while (api.getSnapshot().length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
  await api.refresh();
  await vscode.commands.executeCommand('workbench.view.scm');
  const model = vscode.extensions.getExtension('vscode.git').exports.model;
  await fs.writeFile(path.join(base, 'native-host-ready.json'), JSON.stringify({
    locale: vscode.env.language,
    results: api.getSnapshot().map(repo => ({ root: repo.root, error: repo.error, working: repo.working?.total, staged: repo.staged?.total })),
    native: model.repositories.map(repo => ({ root: repo.root, workingLabel: repo.workingTreeGroup.label, stagedLabel: repo.indexGroup.label,
      workingTooltips: repo.workingTreeGroup.resourceStates.map(state => state.decorations.tooltip),
      stagedTooltips: repo.indexGroup.resourceStates.map(state => state.decorations.tooltip) })),
  }, null, 2));
  const end = Date.now() + 180000;
  let lastEdit;
  while (Date.now() < end) {
    if (await fs.access(path.join(base, 'native-host-release.txt')).then(() => true, () => false)) return;
    const edit = await fs.readFile(path.join(base, 'native-host-edit.json'), 'utf8').then(JSON.parse).catch(() => undefined);
    if (edit && edit.id !== lastEdit && api.getSnapshot().some(repo => path.resolve(repo.root).toLowerCase() === path.resolve(edit.root).toLowerCase())) {
      lastEdit = edit.id;
      const uri = vscode.Uri.file(path.join(edit.root, 'app.ts'));
      const document = await vscode.workspace.openTextDocument(uri);
      const change = new vscode.WorkspaceEdit();
      change.insert(uri, document.positionAt(document.getText().length), 'six\n');
      await vscode.workspace.applyEdit(change);
      await document.save();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('UI test did not release the extension host');
}

module.exports = { run };
