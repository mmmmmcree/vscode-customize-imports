'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createStrings } = require('../media/strings');

test('display language selects English, Simplified Chinese, or Traditional Chinese', () => {
  for (const [locale, expected] of [['en', 'Changes'], ['en-US', 'Changes'], ['zh-cn', '更改'], ['zh-CN', '更改'], ['zh-tw', '變更'], ['zh-hant', '變更'], ['zh-hk', '變更']]) {
    const strings = createStrings(locale);
    assert.equal(strings.changes, expected);
    for (const [key, value] of Object.entries(strings)) {
      if (key === 'format') continue;
      assert.equal(typeof value, 'string', `${locale}: ${key}`);
      assert.ok(value.length, `${locale}: ${key}`);
    }
  }
  assert.equal(createStrings('en').format('files', 2), '2 files');
  assert.equal(createStrings('zh-cn').format('files', 2), '2 个文件');
  assert.equal(createStrings('zh-tw').format('files', 2), '2 個檔案');
  assert.equal(createStrings('fr').changes, 'Changes');
});

test('manifest translations cover every visible command and setting token', () => {
  const project = path.resolve(__dirname, '..');
  const manifest = fs.readFileSync(path.join(project, 'package.json'), 'utf8');
  const tokens = [...manifest.matchAll(/%([\w.]+)%/g)].map(match => match[1]);
  for (const name of ['package.nls.json', 'package.nls.zh-cn.json', 'package.nls.zh-tw.json']) {
    const strings = JSON.parse(fs.readFileSync(path.join(project, name), 'utf8'));
    for (const token of tokens) assert.ok(strings[token], `${name}: ${token}`);
  }
});
