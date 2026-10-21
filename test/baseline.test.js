// Baseline semantics: known failures still run and are reported, but do not
// fail CI. All baseline files are written inside os.tmpdir workspaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, tmpDir, FIXTURES } from './helpers.js';

function setupWorkspace(prefix) {
  const dir = tmpDir(prefix);
  fs.copyFileSync(path.join(FIXTURES, 'baseline.md'), path.join(dir, 'doc.md'));
  const listed = runCli(['list', 'doc.md', '--format', 'json'], { cwd: dir });
  assert.equal(listed.code, 0, listed.stderr);
  const id = JSON.parse(listed.stdout).snippets[0].id;
  assert.match(id, /^snip-[0-9a-f]{16}$/);
  return { dir, id };
}

test('baseline-known failure: runs, reported, exit 0', () => {
  const { dir, id } = setupWorkspace('snipci-base1-');
  fs.writeFileSync(
    path.join(dir, '.snipci-baseline.json'),
    `${JSON.stringify({ version: 1, ids: [id] }, null, 2)}\n`,
    'utf8',
  );

  const res = runCli(['run', 'doc.md', '--format', 'json'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.results[0].status, 'fail'); // still runs and reports
  assert.equal(parsed.results[0].baselineKnown, true);
  assert.equal(parsed.summary.baselineKnown, 1);
  assert.equal(parsed.summary.failing, 0);
});

test('the same failure without the baseline fails CI (exit 1)', () => {
  const { dir, id } = setupWorkspace('snipci-base2-');
  const withBaselineIgnored = runCli(['run', 'doc.md', '--format', 'json', '--no-baseline'], { cwd: dir });
  assert.equal(withBaselineIgnored.code, 1);
  const parsed = JSON.parse(withBaselineIgnored.stdout);
  assert.equal(parsed.results[0].baselineKnown, false);
  assert.equal(parsed.summary.failing, 1);
  assert.equal(parsed.results[0].id, id); // same snippet, different baseline treatment
});

test('--update-baseline records current failures and silences them', () => {
  const { dir, id } = setupWorkspace('snipci-base3-');

  const update = runCli(['run', 'doc.md', '--format', 'json', '--update-baseline'], { cwd: dir });
  assert.equal(update.code, 0, update.stderr); // maintenance run exits 0
  const baseline = JSON.parse(fs.readFileSync(path.join(dir, '.snipci-baseline.json'), 'utf8'));
  assert.equal(baseline.version, 1);
  assert.deepEqual(baseline.ids, [id]);

  const rerun = runCli(['run', 'doc.md', '--format', 'json'], { cwd: dir });
  assert.equal(rerun.code, 0);
  assert.equal(JSON.parse(rerun.stdout).summary.baselineKnown, 1);
});

test('malformed baseline file is a config error (exit 2)', () => {
  const dir = tmpDir('snipci-base4-');
  fs.writeFileSync(path.join(dir, 'doc.md'), '```javascript\nconsole.log(1);\n```\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.snipci-baseline.json'), '{"ids": [42]}', 'utf8');
  const res = runCli(['run', 'doc.md'], { cwd: dir });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /baseline must be/);
});
