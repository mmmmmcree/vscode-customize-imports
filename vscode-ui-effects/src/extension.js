'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const { updateCustomCSS, atomicWrite } = require('./custom-css');

function isManagedImport(value, current) {
  let path;
  try { path = decodeURI(value).replace(/\\/g, '/'); } catch { return false; }
  return value === current || /\/local-tools\.customize-imports-effects(?:-[^/]+)?\//i.test(path)
    || /\/vscode-customize-imports\/(vscode-custom\.css|vscode-logo\.css|trail-effect(?:-old)?\.js)$/i.test(path);
}

async function source(context) {
  const read = file => fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', file).fsPath, 'utf8');
  const config = vscode.workspace.getConfiguration('customizeImports');
  let css = await read('cursor-palette.css');
  if (config.get('interfaceStyles', true)) css += '\n' + await read('vscode-custom.css');
  if (config.get('watermark', true)) {
    const image = await fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', 'vscode-logo.png').fsPath);
    css += '\n:root { --customize-imports-watermark: url("data:image/png;base64,' + image.toString('base64') + '"); }\n';
    css += await read('vscode-logo.css');
  }
  const options = { MAX_FPS: config.get('maxFPS', 60), SMOKE_ENABLED: config.get('smoke', true) };
  const vimCursor = config.get('interfaceStyles', true) ? await read('vim-cursor.js') : '';
  const trail = config.get('cursorTrail', true) ? await read('trail-effect.js') : '';
  return `(() => {
    window.vscodeCustomizeEffects?.dispose();
    window.vscodeCursorTrail?.dispose();
    window.vscodeVimCursorEffects?.dispose();
    const style = document.createElement('style');
    style.id = 'customize-imports-effects';
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
    window.vscodeCursorTrailOptions = ${JSON.stringify(options)};
    const api = { dispose() {
      style.remove();
      window.vscodeCursorTrail?.dispose();
      window.vscodeVimCursorEffects?.dispose();
      delete window.vscodeCursorTrailOptions;
      if (window.vscodeCustomizeEffects === api) delete window.vscodeCustomizeEffects;
    } };
    window.vscodeCustomizeEffects = api;
  })();\n${vimCursor}\n${trail}\n`;
}

function activate(context) {
  async function apply(enabled) {
    const loader = vscode.extensions.getExtension('be5invis.vscode-custom-css');
    if (!loader) {
      await vscode.commands.executeCommand('workbench.extensions.search', '@id:be5invis.vscode-custom-css');
      await vscode.window.showInformationMessage('安装 Custom CSS and JS Loader 后，再运行界面特效命令。');
      return;
    }
    await loader.activate();
    const entry = vscode.Uri.joinPath(context.globalStorageUri, 'effects.js');
    // User-data storage may use vscode-userdata:, which the Loader cannot read.
    const entryUrl = vscode.Uri.file(entry.fsPath).toString();
    await updateCustomCSS(vscode, async () => {
      if (enabled) {
        await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
        await atomicWrite(entry.fsPath, await source(context));
      }
      const config = vscode.workspace.getConfiguration('vscode_custom_css');
      const imports = config.get('imports', []).filter(value => !isManagedImport(value, entryUrl));
      if (enabled) imports.push(entryUrl);
      await config.update('imports', imports, vscode.ConfigurationTarget.Global);
      if (enabled) return { requiredMarker: 'window.vscodeCustomizeEffects = api' };
    });
  }
  const run = enabled => async () => {
    try { await apply(enabled); }
    catch (error) { await vscode.window.showErrorMessage(`界面特效更新失败：${error.message}`); }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('customizeImports.enable', run(true)),
    vscode.commands.registerCommand('customizeImports.disable', run(false)),
  );
}

module.exports = { activate, isManagedImport, source };
