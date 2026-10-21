// Fence parser: info strings, nested blocks, headings, CRLF, edge cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, slugify } from '../src/fence.js';

test('extracts backtick fences with info strings and content', () => {
  const doc = ['# Title', '', '```js title=quickstart', 'console.log(1);', '```', ''].join('\n');
  const { fences } = parseMarkdown(doc, 'a.md');
  assert.equal(fences.length, 1);
  assert.equal(fences[0].info, 'js title=quickstart');
  assert.equal(fences[0].content, 'console.log(1);');
  assert.equal(fences[0].fenceLine, 3);
  assert.equal(fences[0].startLine, 4);
  assert.equal(fences[0].endLine, 5);
  assert.equal(fences[0].anchor, 'title');
  assert.equal(fences[0].closed, true);
});

test('tilde fences and longer closing fences', () => {
  const doc = ['~~~python', 'x = 1', '~~~~', ''].join('\n');
  const { fences } = parseMarkdown(doc, 'a.md');
  assert.equal(fences.length, 1);
  assert.equal(fences[0].info, 'python');
  assert.equal(fences[0].content, 'x = 1');
});

test('nested fences stay inside a 4-backtick block', () => {
  const doc = [
    '````markdown',
    '```js',
    'console.log("inner");',
    '```',
    '```bash',
    'echo hi',
    '```',
    '````',
    '',
    '```js',
    'outer();',
    '```',
  ].join('\n');
  const { fences } = parseMarkdown(doc, 'a.md');
  assert.equal(fences.length, 2);
  assert.equal(fences[0].fenceLen, 4);
  assert.ok(fences[0].content.includes('console.log("inner");'));
  assert.ok(fences[0].content.includes('echo hi'));
  assert.equal(fences[1].content, 'outer();');
});

test('info strings containing backticks do not open a fence', () => {
  const doc = ['x ```inline``` y', '```js', 'a();', '```'].join('\n');
  const { fences } = parseMarkdown(doc, 'a.md');
  assert.equal(fences.length, 1);
  assert.equal(fences[0].content, 'a();');
});

test('unclosed fence runs to EOF', () => {
  const doc = ['```js', 'never();', 'closed();'].join('\n');
  const { fences } = parseMarkdown(doc, 'a.md');
  assert.equal(fences.length, 1);
  assert.equal(fences[0].closed, false);
  assert.equal(fences[0].content, 'never();\nclosed();');
});

test('CRLF line endings normalize to LF content', () => {
  const doc = ['# T\r\n\r\n```js\r\na();\r\nb();\r\n```\r\n'].join('');
  const { fences } = parseMarkdown(doc, 'a.md');
  assert.equal(fences.length, 1);
  assert.equal(fences[0].content, 'a();\nb();');
});

test('headings outside fences become anchors; headings inside do not', () => {
  const doc = [
    '# Install',
    '',
    '```bash',
    '# not a heading',
    'echo 1',
    '```',
    '',
    '## Usage details',
    '',
    '```js',
    'x();',
    '```',
  ].join('\n');
  const { fences } = parseMarkdown(doc, 'a.md');
  assert.equal(fences[0].anchor, 'install');
  assert.equal(fences[1].anchor, 'usage-details');
});

test('slugify is stable and readable', () => {
  assert.equal(slugify('Usage Details!'), 'usage-details');
  assert.equal(slugify('  API v2 (beta)  '), 'api-v2-beta');
});
