'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const { updateCustomCSS, atomicWrite } = require('./custom-css');
const { registerConceptHighlighting } = require('./cpp-concepts');
const { registerEnumTypeHighlighting } = require('./cpp-enums');
const theme = require('../themes/dark2026-one-dark-pro-color-theme.json');

function isManagedImport(value, current) {
  let path;
  try { path = decodeURI(value).replace(/\\/g, '/'); } catch { return false; }
  return value === current || /\/local\.dark2026-one-dark-pro(?:-[^/]+)?\//i.test(path)
    || /\/vscode-customize-imports\/synthwave84\.css$/i.test(path);
}

async function source(context) {
  const read = (name, encoding = 'utf8') => fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', name).fsPath, encoding);
  const [styles, script, icon] = await Promise.all([read('synthwave84.css'), read('synthwave84.js'), read('vscode-neon.png', null)]);
  const css = '.dark2026-synthwave { --synthwave-app-icon: url("data:image/png;base64,'
    + icon.toString('base64') + '"); }\n' + styles;
  const config = vscode.workspace.getConfiguration('dark2026OneDarkPro');
  const options = { css, intensity: config.get('glowIntensity', 1), frequencyAware: config.get('frequencyAware', true) };
  return 'window.dark2026Synthwave?.dispose();\nwindow.dark2026SynthwaveOptions = '
    + JSON.stringify(options) + ';\n' + script + '\n';
}

function activate(context) {
  context.subscriptions.push(registerConceptHighlighting(vscode, theme.semanticTokenColors['concept:cpp'].foreground,
    theme.tokenColors.find(rule => rule.name === 'C++ value template parameters').settings.foreground,
    theme.semanticTokenColors['typeParameter:cpp'].foreground));
  context.subscriptions.push(registerEnumTypeHighlighting(vscode, theme.semanticTokenColors['enum:cpp'].foreground));
  async function apply(enabled) {
    const loader = vscode.extensions.getExtension('be5invis.vscode-custom-css');
    if (!loader) {
      await vscode.commands.executeCommand('workbench.extensions.search', '@id:be5invis.vscode-custom-css');
      await vscode.window.showInformationMessage('安装 Custom CSS and JS Loader 后，再启用 Synthwave 光晕。');
      return;
    }
    await loader.activate();
    const entry = vscode.Uri.joinPath(context.globalStorageUri, 'synthwave84.js');
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
      if (enabled) return { requiredMarker: 'window.dark2026SynthwaveOptions = ' };
    });
  }
  const run = enabled => async () => {
    try { await apply(enabled); }
    catch (error) { await vscode.window.showErrorMessage(`Synthwave 更新失败：${error.message}`); }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('dark2026OneDarkPro.enableGlow', run(true)),
    vscode.commands.registerCommand('dark2026OneDarkPro.disableGlow', run(false)),
  );
}

module.exports = { activate, isManagedImport, source };
