'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runGit } = require('../src/git');
const results = process.env.SCM_STATS_TEST_RESULTS;

async function run() {
  const extension = vscode.extensions.getExtension('local-tools.scm-line-stats');
  const installedRoot = path.resolve(process.env.SCM_STATS_TEST_EXTENSIONS) + path.sep;
  if (!extension || !path.resolve(extension.extensionPath).toLowerCase().startsWith(installedRoot.toLowerCase())) throw new Error('The extension must run from the installed VSIX, not from development source.');
  const api = await extension.activate();
  const deadline = Date.now() + 20000;
  while (api.getSnapshot().length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  await api.refresh();
  await vscode.commands.executeCommand('workbench.view.scm');
  const renderer = api.getRendererState();
  await fs.writeFile(path.join(results, 'native-host-ready.json'), JSON.stringify({
    locale: vscode.env.language, renderer,
    extensionPath: extension.extensionPath, version: extension.packageJSON.version,
    appRoot: vscode.env.appRoot,
    imports: vscode.workspace.getConfiguration('vscode_custom_css').get('imports', []),
  }, null, 2));
  const end = Date.now() + 180000;
  let lastEdit;
  while (Date.now() < end) {
    if (await fs.access(path.join(results, 'native-host-release.txt')).then(() => true, () => false)) return;
    const edit = await fs.readFile(path.join(results, 'native-host-edit.json'), 'utf8').then(JSON.parse).catch(() => undefined);
    if (edit && edit.id !== lastEdit && api.getSnapshot().some(repo => path.resolve(repo.root).toLowerCase() === path.resolve(edit.root).toLowerCase())) {
      lastEdit = edit.id;
      try {
        const repository = vscode.extensions.getExtension('vscode.git').exports.getAPI(1).repositories.find(repo => path.resolve(repo.rootUri.fsPath).toLowerCase() === path.resolve(edit.root).toLowerCase());
        if (edit.action === 'folders') {
          const nested = path.join(edit.root, 'src/feature/deep/item.ts');
          await fs.writeFile(nested, 'one\nTWO\nthree\nfour\nfive\n');
          await runGit('git', edit.root, ['add', '--', 'src/feature/deep/item.ts']);
          await fs.writeFile(nested, 'ONE\nTWO\nthree\nfour\nfive\nsix\n');
          await fs.writeFile(path.join(edit.root, 'src/sibling.ts'), 'one\nTWO\nthree\n');
          await fs.writeFile(path.join(edit.root, 'src-other/other.ts'), 'ONE\nTWO\nTHREE\n');
          await repository.status();
          await vscode.commands.executeCommand('workbench.scm.action.setTreeViewMode');
        } else if (edit.action === 'stage') {
          await repository.add([path.join(edit.root, edit.path)]);
        } else {
          const uri = vscode.Uri.file(path.join(edit.root, edit.path || 'app.ts'));
          const document = await vscode.workspace.openTextDocument(uri);
          const change = new vscode.WorkspaceEdit();
          change.insert(uri, document.positionAt(document.getText().length), 'six\n');
          await vscode.workspace.applyEdit(change);
          await document.save();
        }
        await api.refresh();
        await fs.writeFile(path.join(results, 'native-host-action-result.json'), JSON.stringify({ id: edit.id }));
      } catch (error) {
        await fs.writeFile(path.join(results, 'native-host-action-result.json'), JSON.stringify({ id: edit.id, error: error.stack }));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('UI verification did not release the installed extension host');
}

module.exports = { run };
