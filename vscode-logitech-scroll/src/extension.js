'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const { updateCustomCSS, atomicWrite } = require('./custom-css');

function isManagedImport(value, current) {
  let path;
  try { path = decodeURI(value).replace(/\\/g, '/'); } catch { return false; }
  return value === current || /\/local-tools\.logitech-horizontal-scroll(?:-[^/]+)?\//i.test(path)
    || /\/vscode-customize-imports\/Logitech_horizontal_scroll_patch\.js$/i.test(path);
}

async function source(context) {
  const script = await fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', 'Logitech_horizontal_scroll_patch.js').fsPath, 'utf8');
  const config = vscode.workspace.getConfiguration('logitechScroll');
  const options = {
    STEP_PX: config.get('stepPX', 320), TAB_STEP_PX: config.get('tabStepPX', 120),
    TAB_SPEED_MULTIPLIER: config.get('tabSpeedMultiplier', 4), DURATION_MS: config.get('durationMS', 500),
    MAX_PENDING_STEPS: config.get('maxPendingSteps', 1024), INVERT: config.get('invert', true),
  };
  return script + '\nwindow.logitechHorizontalScrollPatch.setConfig(' + JSON.stringify(options) + ');\n';
}

function activate(context) {
  async function apply(enabled) {
    const loader = vscode.extensions.getExtension('be5invis.vscode-custom-css');
    if (!loader) {
      await vscode.commands.executeCommand('workbench.extensions.search', '@id:be5invis.vscode-custom-css');
      await vscode.window.showInformationMessage('安装 Custom CSS and JS Loader 后，再启用横滚补丁。');
      return;
    }
    await loader.activate();
    const entry = vscode.Uri.joinPath(context.globalStorageUri, 'scroll.js');
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
      if (enabled) return { requiredMarker: 'window.logitechHorizontalScrollPatch.setConfig(' };
    });
  }
  const run = enabled => async () => {
    try { await apply(enabled); }
    catch (error) { await vscode.window.showErrorMessage(`横滚补丁更新失败：${error.message}`); }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('logitechScroll.enable', run(true)),
    vscode.commands.registerCommand('logitechScroll.disable', run(false)),
  );
}

module.exports = { activate, isManagedImport, source };
