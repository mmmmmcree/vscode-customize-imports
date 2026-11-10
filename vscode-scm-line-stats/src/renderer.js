'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function managedImport(value, current) {
  if (typeof value !== 'string') return false;
  let normalized;
  try { normalized = decodeURI(value).replace(/\\/g, '/'); } catch { return false; }
  return value === current
    || /\/local-tools\.scm-line-stats(?:-[^/]+)?\/(?:media\/(?:native-hover|strings)\.js|native-hover\.js)$/i.test(normalized)
    || /\/vscode-scm-line-stats\/media\/(native-hover|strings)\.js$/i.test(normalized);
}

async function bundleRenderer(extensionRoot, locale, storageUrl = '') {
  const [strings, protocol, renderer] = await Promise.all([
    fs.readFile(path.join(extensionRoot, 'media', 'strings.js'), 'utf8'),
    fs.readFile(path.join(extensionRoot, 'media', 'protocol.js'), 'utf8'),
    fs.readFile(path.join(extensionRoot, 'media', 'native-hover.js'), 'utf8'),
  ]);
  const source = `window.scmLineStatsStorageUrl = ${JSON.stringify(storageUrl)};\nwindow.scmLineStatsDisplayLanguage = ${JSON.stringify(locale)};\n${strings}\n${protocol}\n${renderer}`;
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 20);
  const marker = `/* SCM_LINE_STATS_RENDERER:${hash} */`;
  return { marker, source: marker + '\n' + source };
}

async function findWorkbench(appRoot) {
  for (const directory of ['electron-browser/workbench', 'electron-browser', 'electron-sandbox/workbench', 'electron-sandbox']) {
    for (const name of ['workbench-dev.html', 'workbench.esm.html', 'workbench.html', 'workbench-apc-extension.html']) {
      const candidate = path.join(appRoot, 'out', 'vs', 'code', directory, name);
      if (await fs.stat(candidate).then(info => info.isFile(), () => false)) return candidate;
    }
  }
}

async function ensureRenderer({ vscode, context, output, text, resetMode = false }) {
  const config = vscode.workspace.getConfiguration('scmLineStats');
  if (!resetMode && (config.get('presentation', 'native') !== 'native' || config.get('displayMode', 'hover') !== 'hover')) return { state: 'disabled' };
  const loader = vscode.extensions.getExtension('be5invis.vscode-custom-css');
  if (!loader) {
    output.appendLine(text.loaderNeeded);
    return { state: 'missing-loader' };
  }
  if (vscode.env.remoteName || context.extensionUri.scheme !== 'file') return { state: 'unsupported' };
  const storageUrl = vscode.Uri.file(context.globalStorageUri.fsPath).toString().replace(/^file:\/\//, 'vscode-file://vscode-app');
  const bundle = await bundleRenderer(context.extensionUri.fsPath, vscode.env.language, storageUrl);
  const entry = vscode.Uri.joinPath(context.globalStorageUri, 'native-hover.js');
  await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
  if (await fs.readFile(entry.fsPath, 'utf8').catch(() => '') !== bundle.source) await fs.writeFile(entry.fsPath, bundle.source, 'utf8');
  const loaderConfig = vscode.workspace.getConfiguration('vscode_custom_css');
  // User-data storage can use vscode-userdata:, which the loader cannot read.
  const entryUrl = vscode.Uri.file(entry.fsPath).toString();
  const imports = loaderConfig.get('imports', []);
  const updated = imports.filter(value => !managedImport(value, entryUrl));
  updated.push(entryUrl);
  if (JSON.stringify(updated) !== JSON.stringify(imports)) await loaderConfig.update('imports', updated, vscode.ConfigurationTarget.Global);
  if (resetMode) {
    await config.update('presentation', 'native', vscode.ConfigurationTarget.Global);
    await config.update('displayMode', 'hover', vscode.ConfigurationTarget.Global);
  }
  const workbenchPath = await findWorkbench(vscode.env.appRoot);
  if (!workbenchPath) throw new Error(text.workbenchMissing);
  const readWorkbench = () => fs.readFile(workbenchPath, 'utf8');
  if ((await readWorkbench()).includes(bundle.marker)) return { state: 'ready', workbenchPath, marker: bundle.marker };
  await loader.activate();
  await vscode.commands.executeCommand('extension.updateCustomCSS');
  if (!(await readWorkbench()).includes(bundle.marker)) throw new Error(text.rendererFailed);
  output.appendLine(text.rendererReload);
  return { state: 'reload-required', workbenchPath, marker: bundle.marker };
}

module.exports = { managedImport, bundleRenderer, findWorkbench, ensureRenderer };
