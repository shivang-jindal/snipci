// Self-hosting gate: snipci's own README must be executable by snipci.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './helpers.js';

test('snipci run README.md exits 0 (self-hosting gate)', () => {
  const res = runCli(['run', 'README.md']);
  assert.equal(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assert.match(res.stdout, /docs: passing/);
  assert.match(res.stdout, /snippets/);
});

test('every README fence is either runnable or explicitly skipped with a reason', () => {
  const res = runCli(['list', 'README.md', '--format', 'json']);
  assert.equal(res.code, 0, res.stderr);
  const snippets = JSON.parse(res.stdout).snippets;
  assert.ok(snippets.length >= 5, `expected the known README fences, saw ${snippets.length}`);

  const annotatedSkipReasons = new Set(['docs-demo', 'sample-output', 'architecture-diagram', 'command-menu']);
  for (const s of snippets) {
    if (s.run) continue;
    assert.ok(
      annotatedSkipReasons.has(s.reason),
      `README.md:${s.line} skipped without an explicit annotation (reason: ${s.reason})`,
    );
  }
  assert.ok(snippets.some((s) => s.run), 'README must contain at least one genuinely running snippet');
});

test('snipci check README.md passes (CI gate form)', () => {
  const res = runCli(['check', 'README.md']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /docs: passing/);
});
