// Directive grammar: fence info-string meta (` ```ts snipci="run timeout=10" `)
// plus inline first-line comments (`// snipci: expect "pong"`).
//
// Unknown directives are hard errors naming file:line — typos must never
// silently skip a snippet (that's how docs lie).

import path from 'node:path';
import { directiveError } from './errors.js';
import { normalizeLang } from './langs.js';

const ACTIONS = new Set(['run', 'skip']);
const NO_VALUE = new Set(['run', 'skip', 'expect-error']);
const VALUE_KEYS = new Set(['expect', 'expect-regex', 'expect-exit', 'timeout', 'id', 'cwd', 'reason']);

// ---------------------------------------------------------------------------
// Tokenizer (quote-aware; shared by info strings and directive text)
// ---------------------------------------------------------------------------

function readQuoted(text, i, loc) {
  const quote = text[i];
  let j = i + 1;
  let value = '';
  while (j < text.length && text[j] !== quote) {
    value += text[j];
    j++;
  }
  if (j >= text.length) {
    throw directiveError(`unterminated ${quote === '"' ? 'double' : 'single'} quote`, loc);
  }
  return { value, end: j + 1 };
}

export function tokenize(text, loc = {}) {
  const tokens = [];
  let i = 0;
  let afterSkip = false;

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '[' || ch === ']') {
      i++; // decorative brackets: `skip [reason=…]`
      continue;
    }
    if (ch === '(') {
      // `skip (reason)` → reason=…; other parentheticals are prose, ignored.
      const close = text.indexOf(')', i + 1);
      if (close === -1) throw directiveError('unterminated "(" in directive', loc);
      if (afterSkip) tokens.push({ key: 'reason', val: text.slice(i + 1, close).trim(), hasVal: true });
      i = close + 1;
      afterSkip = false;
      continue;
    }
    if (ch === ')') throw directiveError('unmatched ")" in directive', loc);
    if (ch === '"' || ch === "'") throw directiveError('unexpected quoted string in directive', loc);
    if (ch === '=') throw directiveError('unexpected "=" in directive', loc);

    // bare word
    const start = i;
    while (i < text.length && !/[\s=()[\]"']/.test(text[i])) i++;
    const key = text.slice(start, i);

    if (i < text.length && text[i] === '=') {
      i++;
      if (i >= text.length) throw directiveError(`missing value for "${key}"`, loc);
      if (text[i] === '"' || text[i] === "'") {
        const { value, end } = readQuoted(text, i, loc);
        tokens.push({ key, val: value, hasVal: true });
        i = end;
      } else {
        const vs = i;
        while (i < text.length && !/[\s\]]/.test(text[i])) i++;
        tokens.push({ key, val: text.slice(vs, i), hasVal: true });
      }
    } else {
      // `expect "pong"` — bare key followed by a quoted value.
      let k = i;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (k < text.length && (text[k] === '"' || text[k] === "'") && VALUE_KEYS.has(key)) {
        const { value, end } = readQuoted(text, k, loc);
        tokens.push({ key, val: value, hasVal: true });
        i = end;
      } else {
        tokens.push({ key, hasVal: false });
      }
    }

    afterSkip = key === 'skip';
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Directive text → validated meta object
// ---------------------------------------------------------------------------

function validateFields(meta, loc) {
  if (meta.reason !== undefined && meta.action !== 'skip') {
    throw directiveError('"reason" is only valid together with "skip"', loc);
  }
  if (meta.timeout !== undefined) {
    if (!/^\d+$/.test(meta.timeout)) {
      throw directiveError(`timeout must be an integer number of seconds (got "${meta.timeout}")`, loc);
    }
    const secs = Number(meta.timeout);
    if (secs < 1 || secs > 300) {
      throw directiveError(`timeout must be between 1 and 300 seconds (got ${secs})`, loc);
    }
  }
  if (meta.expectExit !== undefined) {
    if (!/^\d+$/.test(meta.expectExit) || Number(meta.expectExit) > 255) {
      throw directiveError(`expect-exit must be an integer between 0 and 255 (got "${meta.expectExit}")`, loc);
    }
  }
  if (meta.expectError && meta.expectExit !== undefined) {
    throw directiveError('conflicting directives "expect-error" and "expect-exit"', loc);
  }
  if (meta.id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(meta.id)) {
    throw directiveError(`invalid id "${meta.id}" (use letters, digits, ".", "_", "-")`, loc);
  }
  if (meta.cwd !== undefined) {
    if (meta.cwd === '') throw directiveError('"cwd" requires a value', loc);
    if (path.isAbsolute(meta.cwd)) {
      throw directiveError(`"cwd" must be relative to the repository root (got "${meta.cwd}")`, loc);
    }
  }
  if (meta.expectRegex !== undefined) {
    try {
      new RegExp(meta.expectRegex);
    } catch (err) {
      throw directiveError(`invalid expect-regex: ${err.message}`, loc);
    }
  }
}

/**
 * Parse a directive text such as `run timeout=10 expect='ok'` into a
 * canonical meta object. Throws a file:line error on any unknown or
 * malformed directive.
 */
export function parseDirectiveText(text, loc = {}) {
  const tokens = tokenize(String(text ?? ''), loc);
  const meta = {};

  for (const token of tokens) {
    const { key, val, hasVal } = token;

    if (NO_VALUE.has(key) && hasVal) {
      throw directiveError(`"${key}" does not take a value`, loc);
    }
    if (VALUE_KEYS.has(key) && !hasVal) {
      throw directiveError(`"${key}" requires a value`, loc);
    }
    if (!NO_VALUE.has(key) && !VALUE_KEYS.has(key)) {
      const known = [...NO_VALUE, ...VALUE_KEYS].sort().join(', ');
      throw directiveError(`unknown directive "${key}" (known: ${known})`, loc);
    }

    if (ACTIONS.has(key)) {
      if (meta.action !== undefined) {
        if (meta.action === key) throw directiveError(`duplicate directive "${key}"`, loc);
        throw directiveError(`conflicting directives "${meta.action}" and "${key}"`, loc);
      }
      meta.action = key;
      continue;
    }

    const field = {
      expect: 'expect',
      'expect-regex': 'expectRegex',
      'expect-exit': 'expectExit',
      'expect-error': 'expectError',
      timeout: 'timeout',
      id: 'id',
      cwd: 'cwd',
      reason: 'reason',
    }[key];

    if (Object.prototype.hasOwnProperty.call(meta, field)) {
      throw directiveError(`duplicate directive "${key}"`, loc);
    }
    meta[field] = key === 'expect-error' ? true : val;
  }

  validateFields(meta, loc);
  return meta;
}

// ---------------------------------------------------------------------------
// Info string
// ---------------------------------------------------------------------------

/**
 * Split a fence info string into language + attributes.
 * Only the `snipci="…"` value is strict; other attributes (`title=…`,
 * `linenos`, …) are free-form and ignored.
 */
export function parseInfoString(info, loc = {}) {
  const tokens = tokenize(String(info ?? '').trim(), loc);
  let lang = '';
  let rest = tokens;
  if (tokens.length > 0 && !tokens[0].hasVal) {
    lang = tokens[0].key;
    rest = tokens.slice(1);
  }

  const attrs = {};
  let directiveText = null;

  for (const token of rest) {
    if (token.key === 'snipci') {
      if (!token.hasVal) {
        throw directiveError('snipci requires a value: snipci="run …"', loc);
      }
      directiveText = token.val;
    } else if (token.hasVal) {
      attrs[token.key] = token.val;
    }
    // bare junk words in info strings are ignored (not directives)
  }

  return { lang, attrs, directiveText };
}

// ---------------------------------------------------------------------------
// Inline directives (first lines of a snippet)
// ---------------------------------------------------------------------------

const INLINE_HASH_RE = /^\s*(?:#|\/\/|--|;)[ \t]*snipci:[ \t]*(.*)$/;
const INLINE_HTML_RE = /^\s*<!--[ \t]*snipci:[ \t]*(.*?)-->\s*$/;

/** Collect `snipci:` directives from comment lines within the first 5 lines. */
export function parseInlineDirectives(content, { file, startLine } = {}) {
  const merged = {};
  const lines = String(content ?? '').split('\n');
  const limit = Math.min(lines.length, 5);
  for (let k = 0; k < limit; k++) {
    const m = INLINE_HASH_RE.exec(lines[k]) ?? INLINE_HTML_RE.exec(lines[k]);
    if (!m) continue;
    const loc = { file, line: startLine != null ? startLine + k : undefined };
    Object.assign(merged, parseDirectiveText(m[1], loc));
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Full extraction for one fence
// ---------------------------------------------------------------------------

/**
 * Build { meta, lang, anchor } for a fence: info-string meta merged with
 * inline directives (inline > fence > config default — the config default is
 * applied later by the planner).
 */
export function extractFenceMeta(fence, { file } = {}) {
  const loc = { file, line: fence.fenceLine };
  const info = parseInfoString(fence.info, loc);
  const fenceMeta = info.directiveText !== null ? parseDirectiveText(info.directiveText, loc) : {};
  const inlineMeta = parseInlineDirectives(fence.content, { file, startLine: fence.startLine });
  const meta = { ...fenceMeta, ...inlineMeta };

  const mergeLoc = inlineMeta !== null && Object.keys(inlineMeta).length > 0
    ? { file, line: fence.startLine }
    : loc;
  validateFields(meta, mergeLoc);

  const anchor = info.attrs.id ?? info.attrs.title ?? fence.anchor ?? '';
  return { meta, lang: normalizeLang(info.lang), rawLang: info.lang, anchor, attrs: info.attrs };
}
