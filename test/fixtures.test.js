// End-to-end fixture runs: every failure mode from the test strategy gets a
// fixture doc; assertions parse `--format json` output. No network, and all
// temp work happens in os.tmpdir (via the CLI itself).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runCli, FIXTURES } from './helpers.js';

function runFixture(name, extraArgs = [], opts = {}) {
  const file = path.join(FIXTURES, name);
  const res = runCli(['run', file, '--format', 'json', ...extraArgs], opts);
  let json = null;
  if (res.stdout.trim() !== '') {
    json = JSON.parse(res.stdout);
  }
  return { ...res, json };
}

test('passing fixture: exit 0, expectations of every kind pass', () => {
  const res = runFixture('passing.md');
  assert.equal(res.code, 0, res.stderr);
  assert.ok(res.json);
  const s = res.json.summary;
  assert.equal(s.snippets, 9);
  assert.equal(s.pass, 8);
  assert.equal(s.skipped, 1);
  assert.equal(s.failing, 0);

  const skipped = res.json.results.filter((r) => r.status === 'skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'illustrative-only');

  // expect-exit=3 → really exited 3 and passed
  const exit3 = res.json.results.find((r) => r.exitCode === 3);
  assert.equal(exit3?.status, 'pass');
  // expect-error → really exited 1 with stderr
  const exit1 = res.json.results.find((r) => r.exitCode === 1);
  assert.equal(exit1?.status, 'pass');
  // inline first-line directive ran and matched
  const inline = res.json.results.find((r) => r.stdout.includes('inline-ok'));
  assert.equal(inline?.status, 'pass');
});

test('failing exact expectation: exit 1 with expected-vs-actual detail', () => {
  const res = runFixture('failing-exact.md');
  assert.equal(res.code, 1);
  const [result] = res.json.results;
  assert.equal(result.status, 'fail');
  assert.equal(result.assertion.kind, 'expect');
  assert.equal(result.assertion.expected, 'ok');
  assert.equal(result.assertion.actual, 'not ok');
  assert.equal(res.json.summary.failing, 1);
});

test('failing regex expectation: exit 1', () => {
  const res = runFixture('failing-regex.md');
  assert.equal(res.code, 1);
  const [result] = res.json.results;
  assert.equal(result.status, 'fail');
  assert.equal(result.assertion.kind, 'regex');
  assert.match(result.assertion.expected, /hello/);
});

test('non-zero exit: unasserted failure and wrong expect-exit both fail', () => {
  const res = runFixture('nonzero-exit.md');
  assert.equal(res.code, 1);
  assert.equal(res.json.results.length, 2);
  for (const result of res.json.results) assert.equal(result.status, 'fail');
  assert.equal(res.json.results[0].assertion.kind, 'exit');
  assert.equal(res.json.results[0].assertion.actual, 'exit code 2');
  assert.equal(res.json.results[1].assertion.expected, 'exit code 1');
});

test('timeout: killed and reported as error (never a pass)', () => {
  const res = runFixture('timeout.md');
  assert.equal(res.code, 1);
  const [result] = res.json.results;
  assert.equal(result.status, 'error');
  assert.match(result.failure.message, /timeout after 1s/);
  assert.match(result.failure.message, /process tree killed/);
});

test('skip: never executed, reasons reported, exit 0', () => {
  const res = runFixture('skip.md');
  assert.equal(res.code, 0);
  assert.equal(res.json.summary.skipped, 2);
  assert.equal(res.json.summary.pass, 1);
  const reasons = res.json.results.filter((r) => r.status === 'skipped').map((r) => r.reason);
  assert.deepEqual(reasons.sort(), ['doc-only', 'needs-network']);
});

test('env isolation: snippet cannot see parent secrets', () => {
  const res = runFixture('env-secret.md', [], {
    env: { ...process.env, SNIPCI_TEST_SECRET: 'shhh-do-not-leak' },
  });
  assert.equal(res.code, 0, res.stderr);
  const [result] = res.json.results;
  assert.equal(result.status, 'pass');
  assert.equal(result.stdout.trim(), 'absent');
  assert.doesNotMatch(result.stdout, /shhh-do-not-leak/);
});

test('typescript: no-runtime for real TS, plain JS in .ts fences runs', () => {
  const res = runFixture('typescript.md');
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.json.results.length, 2);
  assert.equal(res.json.results[0].status, 'skipped');
  assert.equal(res.json.results[0].reason, 'no-runtime');
  assert.equal(res.json.results[1].status, 'pass');
});

test('python: no-interpreter when absent, passes when present', (t) => {
  const res = runFixture('python.md');
  assert.equal(res.code, 0, res.stderr);
  const [result] = res.json.results;
  if (result.status === 'skipped') {
    assert.equal(result.reason, 'no-interpreter');
  } else {
    assert.equal(result.status, 'pass');
  }
});

test('bash: no-bash when the shell is missing, passes when found', () => {
  const res = runFixture('bash.md');
  assert.equal(res.code, 0, res.stderr);
  const [result] = res.json.results;
  if (result.status === 'skipped') {
    assert.equal(result.reason, 'no-bash');
  } else {
    assert.equal(result.status, 'pass');
  }
});

test('cwd directive: existing dir runs, missing dir is an error', () => {
  const ok = runFixture('cwd-ok.md');
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.json.results[0].status, 'pass');

  const missing = runFixture('cwd-missing.md');
  assert.equal(missing.code, 1);
  assert.equal(missing.json.results[0].status, 'error');
  assert.equal(missing.json.results[0].failure.phase, 'sandbox');
  assert.match(missing.json.results[0].failure.message, /cwd not found/);
});

test('zero-config default runs an unannotated fence', () => {
  const res = runFixture('default-policy.md');
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.json.results[0].status, 'pass');
});

test('unknown directive: hard error with file:line, exit 2, no run', () => {
  const res = runFixture('unknown-directive.md');
  assert.equal(res.code, 2);
  assert.equal(res.stdout, '', 'no report should be printed on extraction errors');
  assert.match(res.stderr, /unknown-directive\.md:6/);
  assert.match(res.stderr, /unknown directive "expec"/);
});
