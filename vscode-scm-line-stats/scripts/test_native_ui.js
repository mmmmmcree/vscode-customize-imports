'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
  process.env.no_proxy = process.env.NO_PROXY;
  const { chromium } = require(process.argv[2]);
  const locale = process.argv[3] || 'en';
  const strings = require('../media/strings').createStrings(locale);
  const project = path.resolve(__dirname, '..');
  const results = process.env.SCM_STATS_TEST_RESULTS || path.join(project, 'test-results');
  let browser;
  const checks = [];
  try {
    const logs = await Promise.all(['native-ui-host.log', 'native-ui-host-stderr.log'].map(async name => {
      const buffer = await fs.readFile(path.join(results, name)).catch(() => Buffer.from(''));
      return buffer.toString(buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf16le' : 'utf8');
    }));
    const log = logs.join('\n');
    const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log)?.[1];
    assert.ok(endpoint, 'isolated VS Code exposes a DevTools endpoint');
    browser = await chromium.connectOverCDP(endpoint);
    const pages = browser.contexts().flatMap(context => context.pages());
    const page = pages.find(candidate => candidate.url().includes('workbench')) || pages[0];
    assert.ok(page, 'VS Code workbench exists');
    await page.waitForSelector('.resource-group', { timeout: 20000 });
    const actualLocale = await page.evaluate(() => window.scmLineStatsDisplayLanguage || window._VSCODE_NLS_LANGUAGE || document.documentElement.lang || 'en');
    assert.equal(actualLocale, locale, 'uses VS Code display language, independent of OS locale');
    await page.waitForFunction(() => window.scmLineStatsNativeHover?.version === '0.2.6');
    assert.equal(await page.locator('#scm-line-stats-native-style').count(), 1);
    checks.push('installed renderer initializes from the head script without runtime injection');

    const groups = await page.locator('.resource-group').all();
    let working;
    let staged;
    let workingName;
    for (const group of groups) {
      const name = await group.locator('.name').textContent();
      const count = Number(await group.locator('.count').textContent());
      if (!count) continue;
      const metadata = await group.evaluate(node => window.scmLineStatsProtocol.parseGroupLabel(node.querySelector('.name').textContent));
      assert.ok(metadata);
      assert.doesNotMatch(name, /[+−\d]/u, 'default group label contains no inline numeric text, including before renderer styling');
      if (metadata.staged) staged = group;
      else { working = group; workingName = metadata.title; }
    }
    assert.ok(working && staged, 'both native Git groups are present');
    await page.evaluate(() => {
      window.scmLineStatsFadeEvents = [];
      document.addEventListener('animationstart', event => {
        if (!event.target.matches('.scm-lines-hover')) return;
        window.scmLineStatsFadeEvents.push({
          name: event.animationName,
          frames: event.target.getAnimations().map(animation => ({
            duration: animation.effect.getTiming().duration,
            keyframes: animation.effect.getKeyframes().map(frame => frame.opacity),
          })),
        });
      });
    });
    await working.locator('.name').hover();
    const card = page.locator('.scm-lines-hover');
    await card.waitFor({ state: 'visible', timeout: 5000 });
    const fade = await card.evaluate(node => ({
      name: getComputedStyle(node).animationName,
      duration: getComputedStyle(node).animationDuration,
      easing: getComputedStyle(node).animationTimingFunction,
    }));
    assert.equal(fade.name, 'fadein');
    assert.equal(fade.duration, '0.1s');
    assert.equal(fade.easing, 'linear');
    await page.waitForFunction(() => window.scmLineStatsFadeEvents.length > 0);
    const initialFade = await page.evaluate(() => window.scmLineStatsFadeEvents[0]);
    assert.equal(initialFade.name, 'fadein');
    assert.ok(initialFade.frames.some(animation => animation.duration === 100 && animation.keyframes[0] === '0' && animation.keyframes.at(-1) === '1'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.scm-lines-hover')).opacity === '1');
    const eventCount = await page.evaluate(() => window.scmLineStatsFadeEvents.length);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.scmLineStatsFadeEvents.length), eventCount, 'hover content updates do not replay fade-in');
    checks.push('first card uses native 100 ms opacity fade-in and stays opaque during updates');
    assert.match(await card.textContent(), /\+2/);
    assert.match(await card.textContent(), /−1/);
    assert.ok((await card.textContent()).includes(strings.format('files', 1)));
    assert.ok((await card.textContent()).includes(strings.added));
    assert.ok((await card.textContent()).includes(strings.deleted));
    assert.doesNotMatch(await working.locator('.name').innerText(), /[+−]\d/);
    const drawing = await card.evaluate(node => {
      const added = node.querySelector('.sl-added');
      const deleted = node.querySelector('.sl-deleted');
      const addBar = node.querySelector('.sl-bar-add');
      const delBar = node.querySelector('.sl-bar-del');
      return {
        added: getComputedStyle(added).color, deleted: getComputedStyle(deleted).color,
        addBar: getComputedStyle(addBar).backgroundColor, delBar: getComputedStyle(delBar).backgroundColor,
        addWidth: addBar.getBoundingClientRect().width, delWidth: delBar.getBoundingClientRect().width,
      };
    });
    assert.notEqual(drawing.added, drawing.deleted, 'added and deleted text have different theme colors');
    assert.equal(drawing.added, drawing.addBar);
    assert.equal(drawing.deleted, drawing.delBar);
    assert.ok(drawing.addWidth > 0 && drawing.delWidth > 0, 'both bar segments are drawn');
    assert.ok(Math.abs(drawing.addWidth / drawing.delWidth - 2) < 0.05, 'bar reflects +2 / -1 ratio');
    checks.push('computed theme colors and drawn bar proportions match the actual line counts');
    await page.screenshot({ path: path.join(results, `native-working-hover-${locale}.png`) });
    checks.push('original Changes group shows a rich hover with independent totals and hides inline numbers');

    await card.hover();
    await page.waitForTimeout(250);
    assert.equal(await card.isVisible(), true, 'card remains available for reading and copying');
    await page.keyboard.press('Escape');
    assert.equal(await card.count(), 0);
    checks.push('hover remains readable when entered and Escape dismisses it');

    await staged.locator('.name').hover();
    await card.waitFor({ state: 'visible' });
    assert.ok((await card.textContent()).includes(strings.headIndex));
    assert.match(await card.textContent(), /\+2/);
    await page.screenshot({ path: path.join(results, `native-staged-hover-${locale}.png`) });
    checks.push('original Staged Changes group shows its own hover and comparison base');

    await page.keyboard.press('Escape');
    const workFileSelector = `.resource[data-tooltip*="\\a ${workingName}: +2 −1"]`;
    const workFile = page.locator(workFileSelector);
    assert.equal(await workFile.count(), 1, 'original file row carries the correct group statistics');
    await workFile.locator('.label-name').hover();
    await card.waitFor({ state: 'visible' });
    assert.match(await card.textContent(), /app\.ts/);
    assert.match(await card.textContent(), /\+2/);
    assert.match(await card.textContent(), /−1/);
    assert.ok((await card.locator('.sl-subtitle').textContent()).startsWith(workingName));
    await page.screenshot({ path: path.join(results, `native-file-hover-${locale}.png`) });
    checks.push('original Git file row shows a rich card with its own additions and deletions');

    const smoke = JSON.parse(await fs.readFile(path.join(results, 'smoke-path.json'), 'utf8'));
    await page.keyboard.press('Escape');
    await fs.writeFile(path.join(results, 'native-host-edit.json'), JSON.stringify({ id: Date.now(), root: path.join(smoke.base, 'partial') }));
    await page.mouse.move(900, 80);
    const updatedFile = page.locator(`.resource[data-tooltip*="\\a ${workingName}: +3 −1"]`);
    await updatedFile.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await card.count(), 0, 'saving does not open a card without a hover');
    await updatedFile.locator('.label-name').hover();
    await card.waitFor({ state: 'visible' });
    const updatedCount = await card.locator('.sl-value').first().textContent();
    assert.equal(updatedCount, '+3');
    await page.keyboard.press('Escape');
    await working.locator('.name').hover();
    await card.waitFor({ state: 'visible' });
    assert.match(await card.textContent(), /\+3/);
    await page.keyboard.press('Escape');
    await staged.locator('.name').hover();
    await card.waitFor({ state: 'visible' });
    assert.match(await card.textContent(), /\+2/);
    checks.push('saving refreshes both file and group cards while staged totals remain independent');

    await page.keyboard.press('Escape');
    await page.mouse.move(900, 80);
    const sendEdit = async edit => {
      const id = Date.now();
      await fs.writeFile(path.join(results, 'native-host-edit.json'), JSON.stringify({ id, root: path.join(smoke.base, 'partial'), ...edit }));
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await fs.readFile(path.join(results, 'native-host-action-result.json'), 'utf8').then(JSON.parse).catch(() => undefined);
        if (result?.id === id) { assert.ifError(result.error); return; }
        await page.waitForTimeout(100);
      }
      throw new Error('Installed extension host did not finish ' + edit.action);
    };
    await sendEdit({ action: 'folders' });
    await page.locator('.resource .folder-icon').first().waitFor();
    await page.evaluate(root => { window.scmLineStatsTestRoot = window.scmLineStatsProtocol.normalizePath(root); }, path.join(smoke.base, 'partial'));
    const folderRows = async () => page.locator('.resource').evaluateAll(nodes => nodes.flatMap(node => {
      const label = node.querySelector('.folder-icon');
      const absolute = label?.getAttribute('aria-label')?.split(' • ')[0];
      const root = window.scmLineStatsTestRoot;
      const relative = absolute && window.scmLineStatsProtocol.normalizePath(absolute).slice(root.length + 1);
      const data = relative && { path: relative };
      if (!data) return [];
      const row = node.closest('.monaco-list-row');
      return [{ path: data.path, staged: !!node.querySelector('.actions .codicon-remove'), rowId: row.id, data, expanded: row.getAttribute('aria-expanded'), text: node.textContent }];
    }));
    const folderRow = async (directory, staged) => {
      const rows = await folderRows();
      const match = rows.find(row => row.path === directory && row.staged === staged);
      assert.ok(match, `native directory ${directory} staged=${staged}: ${JSON.stringify(rows.map(r => ({ path: r.path, staged: r.staged })))}`);
      assert.doesNotMatch(match.text, /[+−]\d/u, 'folders never show inline counts');
      return page.locator('#' + match.rowId);
    };
    const hoverFolder = async (directory, staged, additions, deletions, fileCount) => {
      await page.keyboard.press('Escape');
      await page.mouse.move(900, 80);
      const row = await folderRow(directory, staged);
      await row.locator('.label-name').last().hover();
      await card.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await card.locator('.sl-title').textContent(), directory);
      assert.equal(await card.locator('.sl-added .sl-value').textContent(), '+' + additions);
      assert.equal(await card.locator('.sl-deleted .sl-value').textContent(), '−' + deletions);
      assert.ok((await card.locator('.sl-subtitle').textContent()).includes(strings.format('files', fileCount)));
      assert.ok((await card.textContent()).includes(staged ? strings.headIndex : strings.indexWorktree));
      const widths = await card.evaluate(node => [node.querySelector('.sl-bar-add').getBoundingClientRect().width, node.querySelector('.sl-bar-del').getBoundingClientRect().width]);
      assert.ok(Math.abs(widths[0] / widths[1] - additions / deletions) < 0.05);
      return row;
    };
    let src = await hoverFolder('src', false, 3, 2, 2);
    await page.screenshot({ path: path.join(results, `native-folder-hover-${locale}.png`) });
    checks.push('tree folder recursively totals its own descendants, excluding similarly named sibling directories');
    await page.keyboard.press('Escape');
    if (await src.getAttribute('aria-expanded') === 'true') await src.locator('.monaco-tl-twistie').click();
    src = await hoverFolder('src', false, 3, 2, 2);
    assert.equal(await src.getAttribute('aria-expanded'), 'false');
    await page.screenshot({ path: path.join(results, `native-collapsed-folder-hover-${locale}.png`) });
    checks.push('collapsed directories retain totals for files that are not rendered in the tree');
    await hoverFolder('src/feature/deep', true, 3, 1, 1);
    await page.screenshot({ path: path.join(results, `native-staged-folder-hover-${locale}.png`) });
    checks.push('compressed directory path in Staged Changes has its own staged counts and comparison base');
    await page.keyboard.press('Escape');
    await page.mouse.move(900, 80);
    await sendEdit({ path: 'src/feature/deep/item.ts' });
    assert.equal(await card.count(), 0, 'saving inside a collapsed folder never opens its card');
    await hoverFolder('src', false, 4, 2, 2);
    await hoverFolder('src/feature/deep', true, 3, 1, 1);
    checks.push('saved edits update collapsed folder counts while staged folder totals stay independent');
    await page.keyboard.press('Escape');
    await page.mouse.move(900, 80);
    await sendEdit({ action: 'stage', path: 'src/feature/deep/item.ts' });
    await hoverFolder('src/feature/deep', true, 6, 2, 1);
    checks.push('staging updates directory totals from actual Git index data');


    await fs.writeFile(path.join(results, `native-ui-result-${locale}.json`), JSON.stringify({ passed: true, locale, checks }, null, 2));
    console.log(JSON.stringify({ passed: true, locale, checks }, null, 2));
  } catch (error) {
    if (browser) {
      const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
      if (page) {
        await page.screenshot({ path: path.join(results, 'native-ui-error.png') }).catch(() => {});
        await fs.writeFile(path.join(results, 'native-ui-error-dom.json'), JSON.stringify(await page.locator('.resource, .resource-group').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, tooltip: node.getAttribute('data-tooltip') }))), null, 2));
      }
    }
    await fs.writeFile(path.join(results, 'native-ui-result.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2));
    throw error;
  } finally {
    if (browser) await fs.writeFile(path.join(results, 'native-host-release.txt'), 'done');
    await browser?.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
