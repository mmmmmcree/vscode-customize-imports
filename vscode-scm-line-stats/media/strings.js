/* Shared UI strings for the extension host and workbench renderer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.scmLineStatsStrings = factory();
})(typeof window === 'undefined' ? globalThis : window, () => {
  'use strict';
  const en = {
    changes: 'Changes', staged: 'Staged Changes', untracked: 'Untracked Changes', merge: 'Merge Changes',
    title: 'Line Stats', added: 'lines added', deleted: 'lines deleted',
    files: '{0} files', binaryFiles: '{0} binary files', conflicts: '{0} conflicts', unavailableFiles: '{0} files unavailable',
    binary: 'Binary file', conflict: 'Conflict', other: 'Directory / submodule', unavailable: 'Unavailable',
    indexWorktree: 'Index → Working Tree', headIndex: 'HEAD → Index',
    indexWorktreeUntracked: 'Index → Working Tree (including untracked files)',
    savedOnly: 'Saved content · Binary files and conflicts excluded', groupTotal: 'Group total',
    excludes: 'Binary files, conflicts and unreadable files are excluded from line totals.',
    enableGit: 'Enable the built-in VS Code Git extension.',
    openRepo: 'Open a Git repository to see working tree and staged line counts.',
    repoErrors: '{0} repositories could not be counted. Refresh or check the output log.',
    someUnavailable: 'Some files could not be counted. See their tooltips for details.',
    failed: 'Statistics unavailable', failedClick: 'Statistics unavailable. Click to view log.',
    showLog: 'Show Output', openDiff: 'Open Changes', originalPath: 'Original path',
    deletedFile: 'This file was deleted; a text comparison is unavailable.',
    repoClosed: 'The Git repository was closed.', missingGit: 'The built-in VS Code Git extension was not found.',
    gitUnavailable: 'Git is unavailable. Enable the built-in Git extension and reload the window.',
    loaderNeeded: 'Native hover cards require Custom CSS and JS Loader. Install it, then run Enable Native Hover again.',
    statusM: 'Modified', statusA: 'Added', statusD: 'Deleted', statusR: 'Renamed', statusC: 'Copied', statusT: 'Type changed', statusUntracked: 'Untracked',
    workbenchMissing: 'Could not locate the VS Code workbench HTML.',
    rendererFailed: 'The colored hover renderer was not applied. Run Enable Native Hover and check the output log.',
    rendererReload: 'Colored hover cards are installed. Reload the VS Code window to activate them.',
    rendererUpdateRequired: 'Run Enable Native Hover to install or update colored hover cards. Startup does not modify VS Code files.',
    nativeIntegration: 'Native integration', restoreGroups: 'Restore native Git groups',
  };
  const zhCN = {
    changes: '更改', staged: '暂存的更改', untracked: '未跟踪的更改', merge: '合并更改',
    title: '更改统计', added: '新增行', deleted: '删除行',
    files: '{0} 个文件', binaryFiles: '{0} 个二进制文件', conflicts: '{0} 个冲突', unavailableFiles: '{0} 个文件无法统计',
    binary: '二进制文件', conflict: '冲突', other: '目录 / 子模块', unavailable: '无法统计',
    indexWorktree: '暂存区 → 工作区', headIndex: 'HEAD → 暂存区',
    indexWorktreeUntracked: '暂存区 → 工作区（含未跟踪文件）',
    savedOnly: '已保存内容 · 二进制文件和冲突不计入行数', groupTotal: '组总计',
    excludes: '二进制文件、冲突和无法读取的文件不计入行数。',
    enableGit: '请启用 VS Code 内置 Git 扩展。', openRepo: '打开 Git 仓库后，这里会显示更改和暂存的更改行数。',
    repoErrors: '{0} 个仓库统计失败，可刷新重试或查看日志。', someUnavailable: '部分文件无法统计，详情见文件提示。',
    failed: '统计失败', failedClick: '统计失败，点击查看日志', showLog: '查看日志', openDiff: '打开更改对比', originalPath: '原路径',
    deletedFile: '此文件已删除，无法显示文本行数对比。', repoClosed: 'Git 仓库已关闭', missingGit: '未找到 VS Code 内置 Git 扩展',
    gitUnavailable: 'Git 暂不可用，请启用内置 Git 扩展后重新加载窗口。',
    loaderNeeded: '原生悬停需要 Custom CSS and JS Loader。安装后再次运行“启用原生悬停”。',
    statusM: '修改', statusA: '新增', statusD: '删除', statusR: '重命名', statusC: '复制', statusT: '类型更改', statusUntracked: '未跟踪',
    workbenchMissing: '找不到 VS Code 的工作台页面。',
    rendererFailed: '彩色悬停界面未能启用，请运行“启用原生悬停”并查看日志。',
    rendererReload: '彩色悬停卡片已安装，重新加载 VS Code 窗口后生效。',
    rendererUpdateRequired: '请运行“启用原生悬停”安装或更新彩色卡片；启动检查不会改写 VS Code 文件。',
    nativeIntegration: '原生集成', restoreGroups: '恢复原生 Git 分组',
  };
  const zhTW = {
    ...zhCN, changes: '變更', staged: '暫存的變更', untracked: '未追蹤的變更', merge: '合併變更',
    title: '變更統計', added: '新增行', deleted: '刪除行', files: '{0} 個檔案', binaryFiles: '{0} 個二進位檔案',
    conflicts: '{0} 個衝突', unavailableFiles: '{0} 個檔案無法統計', binary: '二進位檔案', conflict: '衝突',
    other: '目錄 / 子模組', unavailable: '無法統計', indexWorktree: '暫存區 → 工作樹', headIndex: 'HEAD → 暫存區',
    indexWorktreeUntracked: '暫存區 → 工作樹（含未追蹤檔案）', savedOnly: '已儲存內容 · 二進位檔案與衝突不計入行數',
    groupTotal: '群組總計', excludes: '二進位檔案、衝突和無法讀取的檔案不計入行數。',
    enableGit: '請啟用 VS Code 內建 Git 擴充功能。', openRepo: '開啟 Git 存放庫後即可查看變更與暫存行數。',
    repoErrors: '{0} 個存放庫統計失敗，請重新整理或查看記錄。', someUnavailable: '部分檔案無法統計，詳見檔案提示。',
    failed: '統計失敗', failedClick: '統計失敗，按一下查看記錄', showLog: '查看記錄', openDiff: '開啟變更比較', originalPath: '原始路徑',
    deletedFile: '此檔案已刪除，無法顯示文字比較。', repoClosed: 'Git 存放庫已關閉', missingGit: '找不到 VS Code 內建 Git 擴充功能',
    gitUnavailable: 'Git 暫時無法使用，請啟用內建 Git 擴充功能並重新載入視窗。',
    loaderNeeded: '原生暫留卡片需要 Custom CSS and JS Loader。安裝後再次執行「啟用原生暫留」。',
    statusM: '修改', statusA: '新增', statusD: '刪除', statusR: '重新命名', statusC: '複製', statusT: '類型變更', statusUntracked: '未追蹤',
    workbenchMissing: '找不到 VS Code 工作台頁面。',
    rendererFailed: '彩色暫留介面未能啟用，請執行「啟用原生暫留」並查看記錄。',
    rendererReload: '彩色暫留卡片已安裝，重新載入 VS Code 視窗後生效。',
    rendererUpdateRequired: '請執行「啟用原生暫留」安裝或更新彩色卡片；啟動檢查不會改寫 VS Code 檔案。',
    nativeIntegration: '原生整合', restoreGroups: '還原原生 Git 群組',
  };
  function createStrings(locale = 'en') {
    const language = locale.toLowerCase();
    const strings = { ...en, ...(language.startsWith('zh') ? /tw|hk|hant/.test(language) ? zhTW : zhCN : {}) };
    return { ...strings, format: (id, ...args) => {
      const singular = !language.startsWith('zh') && args[0] === 1 ? {
        files: '{0} file', binaryFiles: '{0} binary file', conflicts: '{0} conflict', unavailableFiles: '{0} file unavailable',
      }[id] : undefined;
      return (singular || strings[id]).replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)]));
    } };
  }
  return { createStrings };
});
