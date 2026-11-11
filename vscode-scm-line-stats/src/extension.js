'use strict';

const vscode = require('vscode');
const path = require('node:path');
const { collectRepository, summarize, mapLimit } = require('./git');
const { NativeIntegration } = require('./native');
const { ensureRenderer } = require('./renderer');
const { buildFolderStats, writeFolderSnapshots } = require('./folders');
const { createStrings } = require('../media/strings');
const text = createStrings(vscode.env.language);

const VIEW_ID = 'scmLineStats.changes';
const SCHEME = 'scm-line-stats';
const names = { working: text.changes, staged: text.staged };
const statusNames = { M: text.statusM, A: text.statusA, D: text.statusD, R: text.statusR, C: text.statusC, T: text.statusT, '?': text.statusUntracked };

function numbers(total) {
  return `+${total.additions} −${total.deletions}`;
}

function details(total) {
  const parts = [text.format('files', total.files)];
  if (total.binary) parts.push(text.format('binaryFiles', total.binary));
  if (total.conflicts) parts.push(text.format('conflicts', total.conflicts));
  if (total.unavailable) parts.push(text.format('unavailableFiles', total.unavailable));
  return parts.join(' · ');
}

class StatsProvider {
  constructor(output, storageRoot) {
    this.output = output;
    this.storageRoot = storageRoot;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.onDidChangeFileDecorations = this.emitter.event;
    this.repoListeners = new Map();
    this.results = [];
    this.folderStats = new Map();
    this.pending = false;
    this.disposed = false;
  }

  setApi(api) {
    this.api = api;
    for (const value of this.repoListeners.values()) value.dispose();
    this.repoListeners.clear();
    this.syncRepositories();
    this.schedule();
  }

  syncRepositories() {
    const repositories = (this.api?.repositories || []).filter(repo => repo.rootUri.scheme === 'file');
    const roots = new Set(repositories.map(repo => repo.rootUri.toString()));
    for (const [key, listener] of this.repoListeners) {
      if (!roots.has(key)) { listener.dispose(); this.repoListeners.delete(key); }
    }
    for (const repo of repositories) {
      const key = repo.rootUri.toString();
      if (!this.repoListeners.has(key)) {
        this.repoListeners.set(key, repo.state.onDidChange(() => this.schedule()));
      }
    }
    return repositories;
  }

  schedule() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    const delay = vscode.workspace.getConfiguration('scmLineStats').get('refreshDelay', 400);
    this.timer = setTimeout(() => this.refresh(), delay);
  }

  refresh() {
    if (this.disposed) return Promise.resolve();
    clearTimeout(this.timer);
    this.pending = true;
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = this.runRefresh().finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }

  async runRefresh() {
    while (this.pending && !this.disposed) {
      this.pending = false;
      const api = this.api;
      const repositories = this.syncRepositories();
      const config = vscode.workspace.getConfiguration('scmLineStats');
      const results = await mapLimit(repositories, 2, async repository => {
        const root = repository.rootUri.fsPath;
        try {
          const data = await collectRepository(api.git.path, root, {
            includeUntracked: config.get('includeUntracked', true), gitEnv: api.git.env,
          });
          return { ...data, repository, type: 'repository' };
        } catch (error) {
          this.output.appendLine(`[${new Date().toISOString()}] ${root}: ${error.stack || error.message}`);
          return { root, repository, type: 'repository', error: error.message };
        }
      });
      if (this.disposed || this.api !== api) continue;
      this.results = results;
      this.folderStats = buildFolderStats(results);
      if (this.storageRoot) {
        try { await writeFolderSnapshots(this.storageRoot, results, this.folderStats); }
        catch (error) { this.output.appendLine(`${text.nativeIntegration}: ${error.stack || error.message}`); }
      }
      const native = config.get('presentation', 'native') === 'native';
      let nativeSupported = false;
      if (native && this.native) {
        try { nativeSupported = this.native.apply(results, config.get('displayMode', 'hover')); }
        catch (error) { this.output.appendLine(`${text.nativeIntegration}: ${error.stack || error.message}`); this.native.dispose(); }
      } else this.native?.dispose();
      await vscode.commands.executeCommand('setContext', 'scmLineStats.showPanel', !native || !nativeSupported);
      this.revision = (this.revision || 0) + 1;
      const allEntries = results.flatMap(result => result.error ? [] : [...result.working.entries, ...result.staged.entries]);
      const total = summarize(allEntries);
      this.view.description = results.length && this.inline ? numbers(total) : undefined;
      const errors = results.filter(result => result.error).length;
      this.view.message = !api ? text.enableGit
        : !results.length ? text.openRepo
          : errors ? text.format('repoErrors', errors)
            : total.unavailable ? text.someUnavailable : undefined;
      this.emitter.fire();
    }
  }

  get inline() {
    return vscode.workspace.getConfiguration('scmLineStats').get('displayMode', 'hover') === 'inline';
  }

  provideFileDecoration(uri) {
    if (uri.scheme !== 'file') return;
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const parts = [];
    for (const result of this.results) {
      if (result.error) continue;
      for (const group of ['working', 'staged']) {
        const entry = result[group].entries.find(file => normalize(path.join(result.root, file.path)) === normalize(uri.fsPath));
        if (entry) parts.push(`${names[group]}: ${entry.kind === 'text' ? numbers(entry) : text[entry.kind]}`);
      }
    }
    if (parts.length) return new vscode.FileDecoration(undefined, parts.join('\n'));

  }

  getChildren(node) {
    if (!node) {
      if (this.results.length === 1) return this.getChildren(this.results[0]);
      return this.results;
    }
    if (node.type === 'repository') {
      if (node.error) return [{ type: 'error', root: node.root, error: node.error }];
      return ['working', 'staged'].map(group => ({ type: 'group', group, parent: node, ...node[group] }));
    }
    if (node.type === 'group') return node.entries.map(entry => ({ type: 'file', parent: node.parent, ...entry }));
    return [];
  }

  getTreeItem(node) {
    if (node.type === 'repository') {
      const item = new vscode.TreeItem(path.basename(node.root), vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.root;
      item.tooltip = node.error ? `${node.root}\n${node.error}`
        : `${node.root}\n${text.changes}: ${numbers(node.working.total)}\n${text.staged}: ${numbers(node.staged.total)}`;
      item.iconPath = new vscode.ThemeIcon('repo');
      item.description = node.error ? text.failed : this.inline ? numbers(summarize([...node.working.entries, ...node.staged.entries])) : undefined;
      return item;
    }
    if (node.type === 'group') {
      const item = new vscode.TreeItem(names[node.group], vscode.TreeItemCollapsibleState.Expanded);
      item.id = `${node.parent.root}:${node.group}`;
      item.description = `${this.inline ? `${numbers(node.total)} · ` : ''}${details(node.total)}`;
      item.tooltip = `${names[node.group]}: ${numbers(node.total)}\n${details(node.total)}\n${node.group === 'staged' ? text.headIndex : text.indexWorktreeUntracked}\n${text.excludes}`;
      item.iconPath = new vscode.ThemeIcon(node.group === 'staged' ? 'check' : 'diff');
      return item;
    }
    if (node.type === 'error') {
      const item = new vscode.TreeItem(text.failedClick);
      item.iconPath = new vscode.ThemeIcon('warning');
      item.tooltip = node.error;
      item.command = { command: 'scmLineStats.showOutput', title: text.showLog };
      return item;
    }
    const uri = vscode.Uri.file(path.join(node.parent.root, node.path));
    const item = new vscode.TreeItem(uri);
    item.id = `${node.parent.root}:${node.group}:${node.path}`;
    const kind = node.kind === 'text' ? undefined : text[node.kind];
    const count = kind || numbers(node);
    const folder = path.posix.dirname(node.path);
    item.description = [this.inline ? count : kind, folder === '.' ? undefined : folder].filter(Boolean).join(' · ');
    item.tooltip = `${node.path}\n${names[node.group]} · ${statusNames[node.status] || node.status}\n${count}${node.originalPath ? `\n${text.originalPath}: ${node.originalPath}` : ''}${node.error ? `\n${node.error}` : ''}`;
    item.contextValue = 'scmLineStats.file';
    item.command = { command: 'scmLineStats.openDiff', title: text.openDiff, arguments: [node] };
    return item;
  }

  async openDiff(node) {
    if (!node || node.type !== 'file') return;
    const uri = vscode.Uri.file(path.join(node.parent.root, node.path));
    if (node.kind !== 'text') {
      if (node.status !== 'D') await vscode.commands.executeCommand('vscode.open', uri);
      else vscode.window.showInformationMessage(text.deletedFile);
      return;
    }
    const staged = node.group === 'staged';
    const added = staged ? node.status === 'A' : node.status === '?' || node.worktree === 'A';
    const removed = node.status === 'D';
    const renamed = staged ? /[RC]/.test(node.index) : /[RC]/.test(node.worktree);
    const originalPath = renamed ? node.originalPath || node.path : node.path;
    const makeUri = (filePath, ref) => vscode.Uri.from({
      scheme: SCHEME, path: path.join(node.parent.root, filePath).replace(/\\/g, '/'),
      query: JSON.stringify({ root: node.parent.repository.rootUri.toString(), path: filePath, ref, revision: this.revision }),
    });
    const left = makeUri(originalPath, added ? 'EMPTY' : staged ? 'HEAD' : 'INDEX');
    const right = removed ? makeUri(node.path, 'EMPTY') : staged ? makeUri(node.path, 'INDEX') : uri;
    await vscode.commands.executeCommand('vscode.diff', left, right,
      `${path.basename(node.path)} (${names[node.group]} ${numbers(node)})`, { preview: true });
  }

  async provideTextDocumentContent(uri) {
    const data = JSON.parse(uri.query);
    if (data.ref === 'EMPTY') return '';
    const repository = this.api?.repositories.find(repo => repo.rootUri.toString() === data.root);
    if (!repository) throw new Error(text.repoClosed);
    // The public Git API decodes blobs using the editor's file encoding settings.
    return repository.show(data.ref === 'INDEX' ? '' : 'HEAD', path.join(repository.rootUri.fsPath, data.path));
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const listener of this.repoListeners.values()) listener.dispose();
    this.repoListeners.clear();
    this.native?.dispose();
    this.emitter.dispose();
  }
}

async function activate(context) {
  const output = vscode.window.createOutputChannel(text.title);
  const provider = new StatsProvider(output, context.globalStorageUri.fsPath);
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });
  provider.view = view;
  const runCommand = task => async (...args) => {
    try { return await task(...args); }
    catch (error) {
      output.appendLine(error.stack || error.message);
      vscode.window.showErrorMessage(`${text.title}: ${error.message}`);
    }
  };
  context.subscriptions.push(output, provider, view,
    vscode.window.registerFileDecorationProvider(provider),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand('scmLineStats.refresh', runCommand(() => provider.refresh())),
    vscode.commands.registerCommand('scmLineStats.openDiff', runCommand(node => provider.openDiff(node))),
    vscode.commands.registerCommand('scmLineStats.showOutput', () => output.show()),
    vscode.commands.registerCommand('scmLineStats.enableNativeHover', runCommand(async () => {
      const result = await setupRenderer(true);
      await provider.refresh();
      if (result.state === 'missing-loader') {
        await vscode.commands.executeCommand('workbench.extensions.search', '@id:be5invis.vscode-custom-css');
        vscode.window.showInformationMessage(text.loaderNeeded);
      }
      return result;
    })),
    vscode.workspace.onDidSaveTextDocument(() => provider.schedule()),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('scmLineStats')) provider.schedule(); }),
  );
  let setupTask;
  let rendererState = { state: 'pending' };
  function setupRenderer(resetMode = false) {
    if (setupTask) return setupTask;
    setupTask = ensureRenderer({ vscode, context, output, text, resetMode })
      .then(result => { rendererState = result; return result; })
      .catch(error => {
        rendererState = { state: 'failed', error: error.message };
        output.appendLine(error.stack || error.message);
        vscode.window.showErrorMessage(`${text.title}: ${text.rendererFailed} ${error.message}`);
        return rendererState;
      }).finally(() => { setupTask = undefined; });
    return setupTask;
  }
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('scmLineStats.displayMode') || event.affectsConfiguration('scmLineStats.presentation')) {
      void setupRenderer();
    }
  }));
  const git = vscode.extensions.getExtension('vscode.git');
  let apiListeners = [];
  context.subscriptions.push({ dispose: () => apiListeners.forEach(listener => listener.dispose()) });
  try {
    if (!git) throw new Error(text.missingGit);
    const exports = await git.activate();
    provider.native = new NativeIntegration(exports, output, text);
    const connect = enabled => {
      apiListeners.forEach(listener => listener.dispose());
      apiListeners = [];
      const api = enabled ? exports.getAPI(1) : undefined;
      provider.setApi(api);
      if (api) apiListeners = [
        api.onDidOpenRepository(() => { provider.syncRepositories(); provider.schedule(); }),
        api.onDidCloseRepository(() => { provider.syncRepositories(); provider.schedule(); }),
        api.onDidChangeState(() => provider.schedule()),
      ];
    };
    context.subscriptions.push(exports.onDidChangeEnablement(connect));
    connect(exports.enabled);
    await provider.refresh();
  } catch (error) {
    output.appendLine(error.stack || error.message);
    view.message = text.gitUnavailable;
  }
  // Expose the model to extension-host smoke tests and other local integrations.
  // Startup only checks readiness. Applying a new renderer is an explicit command
  // so it cannot race another extension's Custom CSS update during startup.
  await setupRenderer();
  return { refresh: () => provider.refresh(), getSnapshot: () => provider.results, getRendererState: () => rendererState };
}

module.exports = { activate, StatsProvider };
