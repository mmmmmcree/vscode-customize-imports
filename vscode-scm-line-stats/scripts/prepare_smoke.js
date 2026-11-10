'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runGit } = require('../src/git');

async function main() {
  const project = path.resolve(__dirname, '..');
  const results = process.env.SCM_STATS_TEST_RESULTS || path.join(project, 'test-results');
  const base = await fs.mkdtemp(path.join(results, 'smoke-'));
  for (const name of ['partial', 'clean']) {
    const root = path.join(base, name);
    await fs.mkdir(root);
    await runGit('git', root, ['init', '--initial-branch=main']);
    await runGit('git', root, ['config', 'core.autocrlf', 'false']);
    await runGit('git', root, ['config', 'commit.gpgsign', 'false']);
    await fs.writeFile(path.join(root, 'app.ts'), 'one\ntwo\nthree\n');
    if (name === 'partial') {
      for (const file of ['src/sibling.ts', 'src/feature/deep/item.ts', 'src-other/other.ts']) {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), 'one\ntwo\nthree\n');
      }
    }
    await runGit('git', root, ['add', '--all']);
    await runGit('git', root, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'baseline']);
    if (name === 'partial') {
      await fs.writeFile(path.join(root, 'app.ts'), 'one\nTWO\nthree\nfour\n');
      await runGit('git', root, ['add', '--', 'app.ts']);
      await fs.writeFile(path.join(root, 'app.ts'), 'ONE\nTWO\nthree\nfour\nfive\n');
    }
  }
  const workspace = path.join(base, 'smoke.code-workspace');
  await fs.writeFile(workspace, JSON.stringify({ folders: [{ path: 'partial' }, { path: 'clean' }], settings: {
    'git.openRepositoryInParentFolders': 'never',
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'workbench.startupEditor': 'none',
  } }, null, 2));
  await fs.writeFile(path.join(results, 'smoke-path.json'), JSON.stringify({ workspace, base }, null, 2));
  console.log(workspace);
}

fs.mkdir(process.env.SCM_STATS_TEST_RESULTS || path.resolve(__dirname, '../test-results'), { recursive: true }).then(main).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
