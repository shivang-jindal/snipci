// CLI surface: help/version, exit codes 0/1/2, config handling, init, list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, tmpDir, writeFixture, FIXTURES, BASE } from './helpers.js';

test('--help exits 0 and documents commands, directives, exit codes', () => {
  const res = runCli(['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /Usage:/);
  assert.match(res.stdout, /snipci run/);
  assert.match(res.stdout, /Exit codes:/);
  assert.match(res.stdout, /expect-regex/);
});

test('--version exits 0 and matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8'));
  const res = runCli(['--version']);
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), `snipci ${pkg.version}`);
});

test('usage errors exit 2: missing command, unknown command, unknown option, bad format', () => {
  for (const args of [[], ['bogus'], ['run', '--nope'], ['run', '--format', 'junit'], ['run', '--jobs', 'zero']]) {
    const res = runCli(args);
    assert.equal(res.code, 2, `args=${JSON.stringify(args)} → ${res.stderr}`);
    assert.match(res.stderr, /snipci:/);
    assert.doesNotMatch(res.stderr, /^\s+at /m, 'no stack traces for usage errors');
  }
});

test('run with no matching files exits 0 with a note', () => {
  const dir = tmpDir('snipci-empty-');
  const res = runCli(['run'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /no markdown files matched/);
});

test('invalid config JSON exits 2 naming the file', () => {
  const dir = tmpDir('snipci-cfg-');
  writeFixture(dir, 'snipci.config.json', '{ not json');
  const res = runCli(['run'], { cwd: dir });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /invalid JSON/);
  assert.match(res.stderr, /snipci\.config\.json/);
});

test('unknown config key exits 2', () => {
  const dir = tmpDir('snipci-cfg2-');
  writeFixture(dir, 'snipci.config.json', JSON.stringify({ default: 'run', typo_key: 1 }));
  const res = runCli(['run'], { cwd: dir });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /unknown config key: typo_key/);
});

test('config default=skip parks unannotated snippets', () => {
  const dir = tmpDir('snipci-default-');
  writeFixture(dir, 'snipci.config.json', JSON.stringify({ version: 1, default: 'skip' }));
  writeFixture(dir, 'doc.md', '```javascript\nconsole.log("never");\n```\n');
  const res = runCli(['run', 'doc.md', '--format', 'json'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  const [result] = JSON.parse(res.stdout).results;
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'default-skip');
});

test('snipci init writes config, refuses overwrite without --force', () => {
  const dir = tmpDir('snipci-init-');
  const first = runCli(['init'], { cwd: dir });
  assert.equal(first.code, 0, first.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'snipci.config.json'), 'utf8'));
  assert.equal(cfg.version, 1);
  assert.match(first.stdout, /Directives/);
  assert.match(first.stdout, /unknown directives/i);

  const second = runCli(['init'], { cwd: dir });
  assert.equal(second.code, 2);
  assert.match(second.stderr, /already exists/);

  const forced = runCli(['init', '--force'], { cwd: dir });
  assert.equal(forced.code, 0);
});

test('snipci list prints ids/directives as text and json', () => {
  const file = path.join(FIXTURES, 'skip.md');
  const text = runCli(['list', file]);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /^snip-[0-9a-f]{16} /m);
  assert.match(text.stdout, /skip \(needs-network\)/);
  assert.match(text.stdout, /3 snippets/);

  const json = runCli(['list', file, '--format', 'json']);
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.snippets.length, 3);
  const runEntry = parsed.snippets.find((s) => s.run);
  assert.equal(runEntry.directives.expect, 'all-good');
  const skippedEntry = parsed.snippets.find((s) => !s.run);
  assert.equal(skippedEntry.reason, 'needs-network');
});

test('check: exit 0 with quiet summary when passing, exit 1 when failing', () => {
  const ok = runCli(['check', path.join(FIXTURES, 'passing.md')]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /docs: passing/);
  assert.doesNotMatch(ok.stdout, /Failures:/);

  const bad = runCli(['check', path.join(FIXTURES, 'failing-exact.md')]);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /expected vs actual/);
});

test('terminal report includes per-file counts, diff and verdict', () => {
  const res = runCli(['run', path.join(FIXTURES, 'failing-exact.md')]);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /failing-exact\.md\s+1 snippets/);
  assert.match(res.stdout, /- ok/);
  assert.match(res.stdout, /\+ not ok/);
  assert.match(res.stdout, /docs: failing/);
});

test('--changed-only outside a git repo falls back to the full set', () => {
  const dir = tmpDir('snipci-git-');
  writeFixture(dir, 'doc.md', '```javascript\nconsole.log("ok");\n```\n');
  const res = runCli(['run', '--changed-only', '--format', 'json'], { cwd: dir });
  assert.equal(res.code, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.summary.snippets, 1);
  assert.ok(parsed.notes.some((n) => /changed-only unavailable .*full set/.test(n)), parsed.notes.join('; '));
});
