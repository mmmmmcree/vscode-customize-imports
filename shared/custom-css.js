'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');

const START = '<!-- !! VSCODE-CUSTOM-CSS-START !! -->';
const END = '<!-- !! VSCODE-CUSTOM-CSS-END !! -->';

async function findWorkbench(appRoot) {
  for (const directory of ['electron-browser/workbench', 'electron-browser', 'electron-sandbox/workbench', 'electron-sandbox']) {
    for (const name of ['workbench-dev.html', 'workbench.esm.html', 'workbench.html', 'workbench-apc-extension.html']) {
      const candidate = path.join(appRoot, 'out', 'vs', 'code', directory, name);
      if (await fs.stat(candidate).then(info => info.isFile(), () => false)) return candidate;
    }
  }
  return undefined;
}

function validWorkbench(html) {
  return /<html\b/i.test(html) && /<head\b/i.test(html) && /<\/head\s*>/i.test(html)
    && /<body\b/i.test(html) && /<\/body\s*>/i.test(html)
    && /<script\b[^>]*\bsrc\s*=/i.test(html);
}

async function atomicWrite(filename, content) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Readers see either the complete old file or the complete new file.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, filename); break; }
      catch (error) {
        // Windows readers/antivirus can briefly deny replacement. Never fall back
        // to deleting or truncating the live workbench to get past that lock.
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 40) throw error;
        await delay(25);
      }
    }
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function withWorkbenchLock(workbench, task, timeoutMs = 30000) {
  const lock = `${workbench}.customize-imports.lock`;
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try { handle = await fs.open(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Another Custom CSS update is in progress or was interrupted. Lock: ${lock}`);
      await delay(50);
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await task();
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
}

async function recoverWorkbench(workbench) {
  const current = await fs.readFile(workbench, 'utf8');
  if (validWorkbench(current)) return current;
  const directory = path.dirname(workbench);
  const candidates = [path.basename(workbench) + '.customize-imports.last-good',
    ...(await fs.readdir(directory)).filter(name => /^workbench\.[\w-]+\.bak-custom-css$/.test(name))];
  for (const name of candidates) {
    const backup = await fs.readFile(path.join(directory, name), 'utf8').catch(() => '');
    if (!validWorkbench(backup)) continue;
    await atomicWrite(workbench, backup);
    return backup;
  }
  throw new Error('The workbench HTML is incomplete and no valid backup was found. Reinstall VS Code to restore its startup files.');
}

function clearPatches(html) {
  const result = html
    .replace(/<!-- !! VSCODE-CUSTOM-CSS-START !! -->[\s\S]*?<!-- !! VSCODE-CUSTOM-CSS-END !! -->\s*/g, '')
    .replace(/<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID [\w-]+ !! -->\s*/g, '')
    .replace(/<script>\/\* eslint-env browser \*\/[\s\S]*?__CUSTOM_CSS_JS_INDICATOR_CLS[\s\S]*?<\/script>\s*/g, '');
  if (result.includes(START) || result.includes(END) || !validWorkbench(result)) {
    throw new Error('The existing Custom CSS injection is incomplete. The workbench was left unchanged.');
  }
  return result;
}

function resolveImport(value, vscode) {
  if (!value.startsWith('file:')) return value;
  const variables = {
    cwd: process.cwd(), userHome: os.homedir(),
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    execPath: process.env.VSCODE_EXEC_PATH || process.execPath,
    pathSeparator: path.sep, '/': path.sep,
  };
  return value.replace(/\$\{([^{}]+)\}/g, (original, key) => {
    if (Object.hasOwn(variables, key)) return variables[key];
    if (key.startsWith('env:')) {
      const [, name, fallback = ''] = key.split(':');
      return process.env[name] ?? fallback;
    }
    return original;
  });
}

async function readImport(value, vscode) {
  const url = new URL(resolveImport(value, vscode));
  const extension = path.extname(url.pathname).toLowerCase();
  if (!['.js', '.css'].includes(extension)) throw new Error('Unsupported import type.');
  let source;
  if (url.protocol === 'file:') source = await fs.readFile(fileURLToPath(url), 'utf8');
  else {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported import protocol.');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    source = await response.text();
  }
  // A quoted closing tag in an imported script must not end the HTML element.
  return extension === '.js'
    ? `<script type="text/plain" data-customize-imports-pending>${source.replace(/<\/script/gi, '<\\/script')}</script>\n`
    : `<style>${source.replace(/<\/style/gi, '<\\/style')}</style>\n`;
}

// Serialized into the workbench. Custom scripts must not run before its first
// editor frame: the native module bootstrap and Webview setup take priority.
function startDeferredImports() {
  function waitForWorkbench() {
    let observer;
    let deadline;
    function ready() {
      if (!document.querySelector('.monaco-workbench .part.editor')) return false;
      observer?.disconnect();
      clearTimeout(deadline);
      let started = false;
      function apply() {
        if (started) return;
        started = true;
        for (const pending of document.querySelectorAll('script[data-customize-imports-pending]')) {
          const script = document.createElement('script');
          script.textContent = pending.textContent;
          pending.replaceWith(script);
        }
      }
      // Paint the native shell before custom code. The fallback also handles
      // hidden windows, whose animation frames can be suspended by Chromium.
      const fallback = setTimeout(apply, 500);
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
        clearTimeout(fallback);
        apply();
      }, 0)));
      return true;
    }
    if (ready()) return;
    observer = new MutationObserver(ready);
    observer.observe(document.body, { childList: true, subtree: true });
    deadline = setTimeout(() => observer.disconnect(), 30000);
  }
  if (document.readyState === 'complete') waitForWorkbench();
  else window.addEventListener('load', waitForWorkbench, { once: true });
}

function deferImports(injection) {
  if (!injection) return '';
  // Inert scripts keep their contents and order without evaluating before the
  // native startup module. Activation creates ordinary global scripts, no eval.
  return injection + `<script data-customize-imports-bootstrap>(${startDeferredImports.toString()})();</script>\n`;
}

async function updateCustomCSS(vscode, prepare) {
  const workbenchPath = await findWorkbench(vscode.env.appRoot);
  if (!workbenchPath) throw new Error('Could not locate the VS Code workbench HTML.');
  const result = await withWorkbenchLock(workbenchPath, async () => {
    const before = await recoverWorkbench(workbenchPath);
    await atomicWrite(`${workbenchPath}.customize-imports.last-good`, before);
    const preparation = await prepare?.({ workbenchPath, html: before });
    if (preparation === false) return { applied: false, workbenchPath };
    const base = clearPatches(before);
    const config = vscode.workspace.getConfiguration('vscode_custom_css');
    const imports = config.get('imports', []);
    if (!Array.isArray(imports)) throw new Error('Custom CSS imports must be an array.');
    let injection = '';
    const skipped = [];
    for (const item of imports) {
      if (!item) continue;
      if (typeof item !== 'string') { skipped.push(item); continue; }
      try { injection += await readImport(item, vscode); }
      catch { skipped.push(item); }
    }
    const session = randomUUID();
    let next = base.replace(/<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, '');
    // A replacement function keeps $&, $` and $' inside user scripts literal.
    next = next.replace(/<\/head\s*>/i, () => `<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID ${session} !! -->\n${START}\n${deferImports(injection)}${END}\n</head>`);
    const loader = vscode.extensions.getExtension('be5invis.vscode-custom-css');
    if (config.get('statusbar', true) && loader?.extensionPath) {
      const indicator = await fs.readFile(path.join(loader.extensionPath, 'src', 'statusbar.js'), 'utf8');
      next = next.replace(/<\/body\s*>/i, () => `<script>${indicator.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`);
    }
    const bootstrap = [...base.matchAll(/<script\b[^>]*\bsrc\s*=[^>]*>/gi)].map(match => match[0]);
    if (!validWorkbench(next) || !bootstrap.every(tag => next.includes(tag))) {
      throw new Error('The generated workbench HTML is incomplete. The working version was left unchanged.');
    }
    if (preparation?.requiredMarker && !next.includes(preparation.requiredMarker)) {
      throw new Error('The required effect could not be loaded. The working version was left unchanged.');
    }
    // Keep the Loader's session/backup format so its Disable command still works.
    await atomicWrite(path.join(path.dirname(workbenchPath), `workbench.${session}.bak-custom-css`), base);
    await atomicWrite(workbenchPath, next);
    await atomicWrite(`${workbenchPath}.customize-imports.last-good`, next);
    return { applied: true, workbenchPath, skipped };
  });
  if (result.applied) {
    const chinese = vscode.env.language?.startsWith('zh');
    const action = chinese ? '重新加载' : 'Reload';
    const message = chinese ? '界面特效已安全更新，重新加载窗口后生效。' : 'UI effects updated. Reload the window to apply them.';
    if (result.skipped.length) void vscode.window?.showWarningMessage(chinese
      ? `有 ${result.skipped.length} 个 Custom CSS 导入无法读取，已跳过。`
      : `${result.skipped.length} Custom CSS import(s) could not be read and were skipped.`);
    void vscode.window?.showInformationMessage(message, action).then(choice => {
      if (choice === action) return vscode.commands.executeCommand('workbench.action.reloadWindow');
    }).catch(error => console.error(error));
  }
  return result;
}

module.exports = { findWorkbench, validWorkbench, atomicWrite, withWorkbenchLock, recoverWorkbench,
  clearPatches, resolveImport, readImport, updateCustomCSS };
