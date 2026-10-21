// Directive grammar: fence meta, inline comments, precedence, hard errors
// with file:line, validation bounds, stable ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInfoString, parseDirectiveText, parseInlineDirectives, extractFenceMeta } from '../src/directives.js';
import { parseMarkdown } from '../src/fence.js';
import { buildSnippet } from '../src/snippet.js';

function fenceFrom(doc, file = 'doc.md') {
  const { fences } = parseMarkdown(doc, file);
  assert.equal(fences.length, 1);
  return fences[0];
}

test('info string meta: run, timeout, quoted expect', () => {
  const info = parseInfoString(`ts title=quickstart snipci="run timeout=10 expect='ok'"`, { file: 'd.md', line: 1 });
  assert.equal(info.lang, 'ts');
  assert.equal(info.attrs.title, 'quickstart');
  const meta = parseDirectiveText(info.directiveText, { file: 'd.md', line: 1 });
  assert.deepEqual(meta, { action: 'run', timeout: '10', expect: 'ok' });
});

test('info string meta without snipci is lenient (title/linenos are not directives)', () => {
  const info = parseInfoString('js title="my example" linenos', { file: 'd.md', line: 1 });
  assert.equal(info.lang, 'js');
  assert.equal(info.directiveText, null);
  assert.equal(info.attrs.title, 'my example');
});

test('inline first-line comments in all supported styles', () => {
  const js = parseInlineDirectives('// snipci: expect "pong"\nconsole.log("pong");', { file: 'd.md', startLine: 10 });
  assert.deepEqual(js, { expect: 'pong' });

  const py = parseInlineDirectives('# snipci: skip reason=network\nprint(1)', { file: 'd.md', startLine: 4 });
  assert.deepEqual(py, { action: 'skip', reason: 'network' });

  const html = parseInlineDirectives('<!-- snipci: run -->\n<b>', { file: 'd.md', startLine: 7 });
  assert.deepEqual(html, { action: 'run' });
});

test('inline directives only scan the first 5 lines', () => {
  const content = ['1', '2', '3', '4', '5', '// snipci: skip'].join('\n');
  assert.deepEqual(parseInlineDirectives(content, { file: 'd.md', startLine: 1 }), {});
});

test('inline beats fence meta (per field)', () => {
  const fence = fenceFrom(
    ['```js snipci="run expect=from-fence timeout=5"', '// snipci: expect "from-inline"', 'x();', '```'].join('\n'),
  );
  const { meta } = extractFenceMeta(fence, { file: 'doc.md' });
  assert.equal(meta.action, 'run'); // fence
  assert.equal(meta.expect, 'from-inline'); // inline wins
  assert.equal(meta.timeout, '5'); // fence only
});

test('inline skip overrides fence run', () => {
  const fence = fenceFrom(['```js snipci="run"', '// snipci: skip reason=later', 'x();', '```'].join('\n'));
  const { meta } = extractFenceMeta(fence, { file: 'doc.md' });
  assert.equal(meta.action, 'skip');
  assert.equal(meta.reason, 'later');
});

test('unknown directive is a hard error naming file:line (fence)', () => {
  const fence = fenceFrom(['# t', '', '```js snipci="run expec=ok"', 'x();', '```'].join('\n'));
  assert.throws(
    () => extractFenceMeta(fence, { file: 'oops.md' }),
    (err) => {
      assert.match(err.message, /unknown directive "expec"/);
      assert.equal(err.location, 'oops.md:3');
      assert.equal(err.exitCode, 2);
      return true;
    },
  );
});

test('unknown directive is a hard error naming file:line (inline)', () => {
  const fence = fenceFrom(['```js', '// snipci: runn', 'x();', '```'].join('\n'));
  assert.throws(
    () => extractFenceMeta(fence, { file: 'oops.md' }),
    (err) => {
      assert.match(err.message, /unknown directive "runn"/);
      assert.equal(err.location, 'oops.md:2');
      return true;
    },
  );
});

test('malformed directives: missing value, value on keyword, duplicates', () => {
  assert.throws(() => parseDirectiveText('expect', { file: 'a.md', line: 1 }), /requires a value/);
  assert.throws(() => parseDirectiveText('run=now', { file: 'a.md', line: 1 }), /does not take a value/);
  assert.throws(() => parseDirectiveText('run skip', { file: 'a.md', line: 1 }), /conflicting directives/);
  assert.throws(() => parseDirectiveText('expect=a expect=b', { file: 'a.md', line: 1 }), /duplicate directive/);
  assert.throws(() => parseDirectiveText('reason=x', { file: 'a.md', line: 1 }), /only valid together with "skip"/);
});

test('timeout bounds: 1..300', () => {
  assert.deepEqual(parseDirectiveText('timeout=300'), { timeout: '300' });
  assert.throws(() => parseDirectiveText('timeout=301', { file: 'a.md', line: 2 }), /between 1 and 300/);
  assert.throws(() => parseDirectiveText('timeout=abc', { file: 'a.md', line: 2 }), /integer number of seconds/);
});

test('expect-exit validation and expect-error conflict', () => {
  assert.deepEqual(parseDirectiveText('expect-exit=3'), { expectExit: '3' });
  assert.throws(() => parseDirectiveText('expect-exit=999', { file: 'a.md', line: 1 }), /between 0 and 255/);
  assert.throws(() => parseDirectiveText('expect-error expect-exit=1', { file: 'a.md', line: 1 }), /conflicting directives/);
});

test('regex validity is checked at extraction time', () => {
  assert.throws(() => parseDirectiveText('expect-regex=(unclosed', { file: 'a.md', line: 4 }), /invalid expect-regex/);
});

test('skip accepts bracket and parenthetical reason forms', () => {
  assert.deepEqual(parseDirectiveText('skip [reason=needs-network]'), { action: 'skip', reason: 'needs-network' });
  assert.deepEqual(parseDirectiveText('skip (network)'), { action: 'skip', reason: 'network' });
  // prose parentheticals elsewhere are ignored, not directives
  assert.deepEqual(parseDirectiveText('expect-error (renamed in v3)'), { expectError: true });
});

test('id directive validation', () => {
  assert.deepEqual(parseDirectiveText('id=quickstart-v2'), { id: 'quickstart-v2' });
  assert.throws(() => parseDirectiveText('id="has spaces"', { file: 'a.md', line: 1 }), /invalid id/);
  assert.throws(() => parseDirectiveText('id=bad!id', { file: 'a.md', line: 1 }), /invalid id/);
});

test('stable ids: deterministic, sensitive to path/anchor/content', () => {
  const doc1 = ['# Install', '', '```js', 'runA();', '```'].join('\n');
  const a = buildSnippet(fenceFrom(doc1, 'doc.md'), { file: 'doc.md', repoPath: 'doc.md' });
  const b = buildSnippet(fenceFrom(doc1, 'doc.md'), { file: 'doc.md', repoPath: 'doc.md' });
  assert.equal(a.id, b.id);
  assert.match(a.id, /^snip-[0-9a-f]{16}$/);

  const doc2 = ['# Setup', '', '```js', 'runA();', '```'].join('\n');
  const c = buildSnippet(fenceFrom(doc2, 'doc.md'), { file: 'doc.md', repoPath: 'doc.md' });
  assert.notEqual(a.id, c.id); // heading anchor matters

  const d = buildSnippet(fenceFrom(doc1, 'other.md'), { file: 'other.md', repoPath: 'other.md' });
  assert.notEqual(a.id, d.id); // path matters

  const doc3 = ['# Install', '', '```js', 'runB();', '```'].join('\n');
  const e = buildSnippet(fenceFrom(doc3, 'doc.md'), { file: 'doc.md', repoPath: 'doc.md' });
  assert.notEqual(a.id, e.id); // content matters
});

test('explicit id= overrides the hash', () => {
  const fence = fenceFrom(['```js snipci="id=quickstart"', 'x();', '```'].join('\n'));
  const snippet = buildSnippet(fence, { file: 'doc.md', repoPath: 'doc.md' });
  assert.equal(snippet.id, 'snip-custom-quickstart');
});
