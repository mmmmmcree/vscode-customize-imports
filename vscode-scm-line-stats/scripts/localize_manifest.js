'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const translations = {
  en: {
    displayName: 'SCM Line Stats', description: 'Hover over native Git changes, staged changes and files to see lines added and deleted.',
    title: 'Line Stats', enable: 'Enable Native Hover', refresh: 'Refresh Line Counts', openDiff: 'Open Changes', output: 'Show Output',
    presentation: 'Where to display line counts. For native hover cards, run Line Stats: Enable Native Hover.',
    native: 'Integrate into native Git Changes and Staged Changes.', panel: 'Use a separate Line Stats view.',
    displayMode: 'How to display line counts.', hover: 'Show line counts only in hover cards.', inline: 'Always show line counts in the list.',
    untracked: 'Include untracked text files in added lines under Changes.', delay: 'Delay before refreshing after changes (milliseconds).',
  },
  'zh-cn': {
    displayName: 'SCM Line Stats · 更改行数', description: '在 Git 原生更改、暂存的更改和文件上悬停查看新增、删除行数。',
    title: '更改统计', enable: '启用原生悬停', refresh: '刷新更改行数', openDiff: '打开更改对比', output: '查看日志',
    presentation: '统计显示的位置。原生悬停卡片需执行“更改统计: 启用原生悬停”。',
    native: '嵌入 Git 原生更改和暂存的更改。', panel: '使用独立的更改统计视图。',
    displayMode: '增减行数的显示方式。', hover: '仅在悬停提示中显示增减行数。', inline: '在列表中持续显示增减行数。',
    untracked: '将未跟踪的文本文件计入“更改”的新增行数。', delay: '自动刷新前的合并等待时间（毫秒）。',
  },
  'zh-tw': {
    displayName: 'SCM Line Stats · 變更行數', description: '在 Git 原生變更、暫存的變更和檔案上暫留查看新增、刪除行數。',
    title: '變更統計', enable: '啟用原生暫留', refresh: '重新整理變更行數', openDiff: '開啟變更比較', output: '查看記錄',
    presentation: '統計顯示位置。原生暫留卡片需執行「變更統計: 啟用原生暫留」。',
    native: '整合到 Git 原生變更和暫存的變更。', panel: '使用獨立的變更統計檢視。',
    displayMode: '增減行數的顯示方式。', hover: '僅在暫留提示中顯示增減行數。', inline: '在清單中持續顯示增減行數。',
    untracked: '將未追蹤的文字檔案計入「變更」的新增行數。', delay: '自動重新整理前的等待時間（毫秒）。',
  },
};
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
manifest.version = '0.2.1';
manifest.displayName = '%displayName%';
manifest.description = '%description%';
manifest.contributes.views.scm[0].name = '%title%';
manifest.contributes.configuration.title = '%title%';
const commandKeys = { enableNativeHover: 'enable', refresh: 'refresh', openDiff: 'openDiff', showOutput: 'output' };
for (const command of manifest.contributes.commands) {
  command.title = `%${commandKeys[command.command.split('.')[1]]}%`;
  command.category = '%title%';
}
const props = manifest.contributes.configuration.properties;
props['scmLineStats.presentation'].description = '%presentation%';
props['scmLineStats.presentation'].enumDescriptions = ['%native%', '%panel%'];
props['scmLineStats.displayMode'].description = '%displayMode%';
props['scmLineStats.displayMode'].enumDescriptions = ['%hover%', '%inline%'];
props['scmLineStats.includeUntracked'].description = '%untracked%';
props['scmLineStats.refreshDelay'].description = '%delay%';
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const [locale, strings] of Object.entries(translations)) {
  fs.writeFileSync(path.join(root, locale === 'en' ? 'package.nls.json' : `package.nls.${locale}.json`), JSON.stringify(strings, null, 2) + '\n');
}
