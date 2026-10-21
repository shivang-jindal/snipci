// Reporters: terminal table (with expected-vs-actual failure diff) and
// `--format json`. Output is colorless when stdout is not a TTY so tests
// and CI logs stay deterministic.

export function summarize(results, { durationMs = 0, notes = [] } = {}) {
  const summary = {
    files: new Set(results.map((r) => r.path)).size,
    snippets: results.length,
    pass: 0,
    fail: 0,
    error: 0,
    skipped: 0,
    baselineKnown: 0,
    failing: 0, // fails that actually fail CI
    durationMs,
    cached: 0, // caching is deferred in v0
  };
  for (const r of results) {
    if (r.status === 'pass') summary.pass++;
    else if (r.status === 'fail') summary.fail++;
    else if (r.status === 'error') summary.error++;
    else if (r.status === 'skipped') summary.skipped++;
    if ((r.status === 'fail' || r.status === 'error') && r.baselineKnown) summary.baselineKnown++;
  }
  summary.failing = summary.fail + summary.error - summary.baselineKnown;
  summary.notes = notes;
  return summary;
}

export function exitCodeFor(summary) {
  return summary.failing > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Expected-vs-actual line diff (small LCS; deterministic)
// ---------------------------------------------------------------------------

export function diffLines(expected, actual) {
  const a = String(expected).split('\n');
  const b = String(actual).split('\n');

  if (a.length * b.length > 250000) {
    return ['- (diff too large; showing raw sides)', `- ${a.join('\n- ')}`, `+ ${b.join('\n+ ')}`].join('\n');
  }

  // LCS table
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < a.length) lines.push(`- ${a[i++]}`);
  while (j < b.length) lines.push(`+ ${b[j++]}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Terminal reporter
// ---------------------------------------------------------------------------

function iconFor(fileResults) {
  const failing = fileResults.some((r) => r.status === 'fail' || r.status === 'error');
  const passed = fileResults.some((r) => r.status === 'pass');
  if (failing) return '❌';
  if (passed) return '✅';
  return '⏭';
}

function pad(text, width) {
  // Count only base characters so emoji/CJK widths don't blow up columns.
  return String(text) + ' '.repeat(Math.max(0, width - String(text).length));
}

function fmtDuration(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function truncate(text, max = 4000) {
  return text.length > max ? `${text.slice(0, max)}\n… [snipci: output truncated]` : text;
}

export function renderTerminal(results, { summary, notes = [], color = false } = {}) {
  const out = [];
  const byFile = new Map();
  for (const r of results) {
    if (!byFile.has(r.path)) byFile.set(r.path, []);
    byFile.get(r.path).push(r);
  }

  const files = [...byFile.keys()].sort();
  out.push('');
  for (const file of files) {
    const fileResults = byFile.get(file);
    const passed = fileResults.filter((r) => r.status === 'pass').length;
    const failed = fileResults.filter((r) => r.status === 'fail' || r.status === 'error').length;
    const skipped = fileResults.filter((r) => r.status === 'skipped').length;
    const ms = fileResults.reduce((acc, r) => acc + r.durationMs, 0);
    const detail = failed > 0 ? `${failed} failing` : `${passed} passing${skipped > 0 ? `, ${skipped} skipped` : ''}`;
    out.push(
      `  ${pad(file, 34)} ${pad(`${fileResults.length} snippets`, 14)} ${iconFor(fileResults)} ${pad(detail, 20)} ${fmtDuration(ms)}`,
    );
  }

  out.push(`  ${'─'.repeat(72)}`);
  const parts = [`${summary.snippets} snippets`, `${summary.pass} passing`];
  if (summary.fail + summary.error > 0) parts.push(`${summary.fail + summary.error} failing`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.baselineKnown > 0) parts.push(`${summary.baselineKnown} in baseline`);
  parts.push('0 cached');
  parts.push(fmtDuration(summary.durationMs));
  out.push(`  ${parts.join(' · ')}`);

  const failingResults = results.filter((r) => r.status === 'fail' || r.status === 'error');
  if (failingResults.length > 0) {
    out.push('');
    out.push('  Failures:');
    for (const r of failingResults) {
      const tag = r.status === 'error' ? 'ERROR' : 'FAIL';
      const known = r.baselineKnown ? ' (baseline: known failure, not failing CI)' : '';
      out.push('');
      out.push(`  ${tag} ${r.path}:${r.line} — ${r.lang || 'no-language'}${known}`);
      out.push(`    id: ${r.id}`);
      if (r.reason) out.push(`    reason: ${r.reason}`);

      if (r.failure) {
        out.push(`    ${r.failure.phase}: ${r.failure.message}`);
      }
      if (r.assertion) {
        out.push(`    ${r.assertion.detail}`);
        out.push('    expected vs actual:');
        for (const line of diffLines(r.assertion.expected, r.assertion.actual).split('\n')) {
          out.push(`      ${line}`);
        }
      }
      if (r.stderr && r.status !== 'pass') {
        out.push('    stderr:');
        for (const line of truncate(r.stderr, 2000).split('\n')) out.push(`      ${line}`);
      }
      if (r.stdout && (r.assertion || r.failure) && r.status === 'fail' && r.assertion?.kind === 'exit') {
        out.push('    stdout:');
        for (const line of truncate(r.stdout, 2000).split('\n')) out.push(`      ${line}`);
      }
      out.push(`    replay: snipci run ${r.path}`);
    }
  }

  const skippedResults = results.filter((r) => r.status === 'skipped' && r.reason);
  if (skippedResults.length > 0) {
    out.push('');
    out.push('  Skipped:');
    for (const r of skippedResults) {
      out.push(`    ⏭ ${r.path}:${r.line} — ${r.reason}`);
    }
  }

  if (notes.length > 0) {
    out.push('');
    for (const note of notes) out.push(`  note: ${note}`);
  }

  out.push('');
  const verdict = summary.failing > 0 ? 'docs: failing' : 'docs: passing';
  out.push(`  ${verdict}`);
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// JSON reporter
// ---------------------------------------------------------------------------

export function renderJson(results, { summary, notes = [] }) {
  return `${JSON.stringify(
    {
      snipci: '0.1.0',
      summary: {
        files: summary.files,
        snippets: summary.snippets,
        pass: summary.pass,
        fail: summary.fail,
        error: summary.error,
        skipped: summary.skipped,
        baselineKnown: summary.baselineKnown,
        failing: summary.failing,
        cached: summary.cached,
        durationMs: summary.durationMs,
      },
      notes,
      results: results.map((r) => ({
        id: r.id,
        path: r.path,
        line: r.line,
        lang: r.lang,
        status: r.status,
        exitCode: r.exitCode,
        durationMs: r.durationMs,
        reason: r.reason,
        baselineKnown: r.baselineKnown,
        assertion: r.assertion,
        failure: r.failure,
        stdout: r.stdout,
        stderr: r.stderr,
      })),
    },
    null,
    2,
  )}\n`;
}
