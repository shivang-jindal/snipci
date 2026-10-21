// Assertion engine: `expect`, `expect-regex`, `expect-exit`, `expect-error`.
// Output is normalized (CRLF → LF, trailing whitespace trimmed) before any
// comparison — exact after trim, per SPEC §6.

export function normalizeOutput(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Evaluate a snippet result against its meta.
 * Returns null (all good) or { kind, expected, actual, detail }.
 * Checked in order: exit code → expect → expect-regex.
 */
export function checkExpectations(meta, { stdout = '', stderr = '', exitCode = null } = {}) {
  const expectedExit = meta.expectError ? 1 : meta.expectExit !== undefined ? Number(meta.expectExit) : 0;

  if (exitCode !== expectedExit) {
    return {
      kind: 'exit',
      expected: `exit code ${expectedExit}`,
      actual: exitCode === null ? 'no exit code (killed?)' : `exit code ${exitCode}`,
      detail: `expected ${expectedExit}, got ${exitCode}`,
    };
  }

  if (meta.expectError) {
    if (normalizeOutput(stderr) === '') {
      return {
        kind: 'error',
        expected: 'non-empty stderr',
        actual: '(empty stderr)',
        detail: 'expect-error: process exited 1 but stderr was empty',
      };
    }
    return null;
  }

  if (meta.expect !== undefined) {
    const expected = normalizeOutput(meta.expect);
    const actual = normalizeOutput(stdout);
    if (expected !== actual) {
      return {
        kind: 'expect',
        expected,
        actual,
        detail: 'stdout did not match expect=',
      };
    }
  }

  if (meta.expectRegex !== undefined) {
    const re = new RegExp(meta.expectRegex, 'm');
    const actual = normalizeOutput(stdout);
    if (!re.test(actual)) {
      return {
        kind: 'regex',
        expected: `/${meta.expectRegex}/`,
        actual,
        detail: `stdout did not match expect-regex=${meta.expectRegex}`,
      };
    }
  }

  return null;
}
