// Planner units: glob expansion + ignore, policy resolution, changed-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { matchGlob, expandFiles } from '../src/glob.js';
import { plan, resolvePlan } from '../src/planner.js';
import { defaultConfig } from '../src/config.js';
import { tmpDir, writeFixture } from './helpers.js';

function adapterCtx(overrides = {}) {
  return {
    platform: 'linux',
    env: {},
    which: () => null,
    fs: { existsSync: () => false },
    nodePath: '/usr/bin/node',
    ...overrides,
  };
}

function snippet(meta, lang = 'javascript', content = 'console.log(1)') {
  return { meta, lang, content, id: 'snip-test', path: 'doc.md', line: 1 };
}

test('glob matching: **, *, ?, separators', () => {
  assert.equal(matchGlob('**/*.md', 'README.md'), true);
  assert.equal(matchGlob('**/*.md', 'docs/a/b.md'), true);
  assert.equal(matchGlob('*.md', 'README.md'), true);
  assert.equal(matchGlob('*.md', 'docs/a.md'), false);
  assert.equal(matchGlob('docs/**', 'docs/archive/x.md'), true);
  assert.equal(matchGlob('docs/**', 'docs/'), true); // dir prune check
  assert.equal(matchGlob('docs/*', 'docs/sub/a.md'), false);
  assert.equal(matchGlob('docs/?', 'docs/a'), true);
  assert.equal(matchGlob('docs/?', 'docs/a.md'), false); // ? is exactly one char
  assert.equal(matchGlob('docs/?.md', 'docs/ab.md'), false);
});

test('expandFiles: patterns, ignore pruning, directory expansion, md filter', () => {
  const dir = tmpDir('snipci-glob-');
  writeFixture(dir, 'README.md', '# r\n');
  writeFixture(dir, path.join('docs', 'a.md'), '# a\n');
  writeFixture(dir, path.join('docs', 'nested', 'b.md'), '# b\n');
  writeFixture(dir, 'notes.txt', 'not markdown\n');
  writeFixture(dir, path.join('node_modules', 'dep.md'), '# dep\n');
  const filter = (abs) => /\.md$/i.test(abs);

  const found = expandFiles({ root: dir, patterns: ['**/*.md'], ignore: ['node_modules/**'], fs, filter });
  assert.deepEqual(
    found.map((f) => path.relative(dir, f).replace(/\\/g, '/')),
    ['README.md', 'docs/a.md', 'docs/nested/b.md'],
  );

  const explicitDir = expandFiles({ root: dir, patterns: ['docs'], ignore: [], fs, filter });
  assert.deepEqual(
    explicitDir.map((f) => path.relative(dir, f).replace(/\\/g, '/')),
    ['docs/a.md', 'docs/nested/b.md'],
  );

  const explicitFile = expandFiles({ root: dir, patterns: ['notes.txt'], ignore: [], fs, filter });
  assert.deepEqual(explicitFile, [], 'md filter applies to explicit files too');

  // applyIgnore:false → CLI-named files bypass ignore
  const forced = expandFiles({
    root: dir,
    patterns: [path.join('node_modules', 'dep.md')],
    ignore: ['node_modules/**'],
    applyIgnore: false,
    fs,
    filter,
  });
  assert.equal(forced.length, 1);
});

test('resolvePlan: config default and explicit actions', () => {
  const runCfg = defaultConfig(); // default: run
  const skipCfg = { ...defaultConfig(), default: 'skip' };
  const ctx = adapterCtx();

  // zero-config default runs known adapters
  assert.equal(resolvePlan(snippet({}), runCfg, ctx).run, true);
  // default=skip parks unannotated snippets
  const parked = resolvePlan(snippet({}), skipCfg, ctx);
  assert.equal(parked.run, false);
  assert.equal(parked.reason, 'default-skip');
  // explicit skip wins over default run
  const skipped = resolvePlan(snippet({ action: 'skip', reason: 'needs-network' }), runCfg, ctx);
  assert.equal(skipped.run, false);
  assert.equal(skipped.reason, 'needs-network');
  // explicit run cannot conjure a missing interpreter
  const py = resolvePlan(snippet({ action: 'run' }, 'python', 'print(1)'), runCfg, ctx);
  assert.equal(py.run, false);
  assert.equal(py.reason, 'no-interpreter');
  // unknown language has no adapter
  assert.equal(resolvePlan(snippet({}, 'yaml', 'k: v'), runCfg, ctx).reason, 'no-adapter');
});

test('changed-only: git diff intersects the file set', async () => {
  const dir = tmpDir('snipci-chg-');
  writeFixture(dir, 'README.md', '```javascript\nconsole.log(1);\n```\n');
  writeFixture(dir, path.join('docs', 'a.md'), '```javascript\nconsole.log(2);\n```\n');
  const exec = async () => ({ exitCode: 0, stdout: 'README.md\n', stderr: '', timedOut: false, spawnError: null });

  const planned = await plan({
    root: dir,
    config: defaultConfig(),
    cliPaths: [],
    changedOnly: true,
    baselineIds: [],
    exec,
    fs,
    adapterCtx: adapterCtx(),
  });
  assert.deepEqual(planned.files.map((f) => path.relative(dir, f).replace(/\\/g, '/')), ['README.md']);
  assert.ok(planned.notes.some((n) => n.includes('changed-only: 1/2')));
});

test('changed-only: git failure falls back to the full set with a note', async () => {
  const dir = tmpDir('snipci-chg2-');
  writeFixture(dir, 'README.md', '```javascript\nconsole.log(1);\n```\n');
  writeFixture(dir, path.join('docs', 'a.md'), '```javascript\nconsole.log(2);\n```\n');
  const exec = async () => ({
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: not a git repository',
    timedOut: false,
    spawnError: null,
  });

  const planned = await plan({
    root: dir,
    config: defaultConfig(),
    cliPaths: [],
    changedOnly: true,
    baselineIds: [],
    exec,
    fs,
    adapterCtx: adapterCtx(),
  });
  assert.equal(planned.files.length, 2);
  assert.ok(planned.notes.some((n) => /changed-only unavailable \(not a git repository\); running the full set/.test(n)));
});

test('planner extracts snippets with baseline flags', async () => {
  const dir = tmpDir('snipci-plan-');
  writeFixture(dir, 'doc.md', '# t\n\n```javascript\nconsole.log(1);\n```\n');
  const planned = await plan({
    root: dir,
    config: defaultConfig(),
    cliPaths: [],
    changedOnly: false,
    baselineIds: ['snip-deadbeef'],
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    fs,
    adapterCtx: adapterCtx(),
  });
  assert.equal(planned.snippets.length, 1);
  assert.equal(planned.snippets[0].plan.run, true);
  assert.equal(planned.snippets[0].baselineKnown, false);
  assert.equal(planned.snippets[0].anchor, 't');
});
