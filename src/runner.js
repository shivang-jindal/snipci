// Executes planned snippets: temp working dir, clean env, timeout with
// process-tree kill, then the assertion engine. Results follow SPEC §6:
//   status: pass | fail | error | skipped

import path from 'node:path';
import { cleanEnv } from './exec.js';
import { checkExpectations } from './assert.js';

function baseResult(snippet) {
  return {
    id: snippet.id,
    path: snippet.path,
    line: snippet.line,
    lang: snippet.lang,
    status: 'pass',
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: 0,
    reason: null,
    assertion: null,
    failure: null,
    baselineKnown: snippet.baselineKnown === true,
  };
}

export async function runSnippet(snippet, ctx) {
  const result = baseResult(snippet);
  const started = ctx.now();

  if (!snippet.plan.run) {
    result.status = 'skipped';
    result.reason = snippet.plan.reason;
    result.durationMs = Math.max(0, ctx.now() - started);
    return result;
  }

  const meta = snippet.meta;
  const timeoutSec = meta.timeout ?? ctx.defaultTimeout ?? 30;
  const execution = snippet.plan.execution;

  const workdir = ctx.fs.mkdtempSync(path.join(ctx.tmpdir(), 'snipci-'));
  try {
    for (const file of execution.files) {
      ctx.fs.writeFileSync(path.join(workdir, file.name), file.content, 'utf8');
    }

    const fileArgs = new Set(execution.files.map((f) => f.name));
    const args = execution.args.map((a) => (fileArgs.has(a) ? path.join(workdir, a) : a));

    let cwd = workdir;
    if (meta.cwd) {
      cwd = path.resolve(ctx.root, meta.cwd);
      if (!ctx.fs.existsSync(cwd)) {
        result.status = 'error';
        result.failure = { phase: 'sandbox', message: `cwd not found: ${meta.cwd}` };
        result.durationMs = Math.max(0, ctx.now() - started);
        return result;
      }
    }

    const execResult = await ctx.exec(execution.command, args, {
      cwd,
      env: cleanEnv(ctx.env),
      timeoutMs: timeoutSec * 1000,
    });

    result.exitCode = execResult.exitCode;
    result.stdout = execResult.stdout;
    result.stderr = execResult.stderr;

    if (execResult.spawnError) {
      result.status = 'error';
      result.failure = { phase: 'sandbox', message: `failed to start: ${execResult.stderr || execResult.spawnError.message}` };
    } else if (execResult.timedOut) {
      result.status = 'error';
      result.failure = { phase: 'runtime', message: `timeout after ${timeoutSec}s (process tree killed)` };
    } else {
      const assertion = checkExpectations(meta, execResult);
      if (assertion) {
        result.status = 'fail';
        result.assertion = assertion;
      } else {
        result.status = 'pass';
      }
    }
  } catch (err) {
    // Unexpected internal error (fs, spawn wrapper, …): keep going, but let
    // the CLI print partial results and exit 3.
    result.status = 'error';
    result.failure = { phase: 'sandbox', message: err?.message ?? String(err) };
    result.internal = `${snippet.path}:${snippet.line}: ${err?.message ?? String(err)}`;
  } finally {
    try {
      ctx.fs.rmSync(workdir, { recursive: true, force: true });
    } catch {
      // temp cleanup is best-effort
    }
  }

  result.durationMs = Math.max(0, ctx.now() - started);
  return result;
}

/**
 * Run all planned snippets. `ctx.jobs` (default 1) controls the size of the
 * worker pool; results always come back in snippet order so reports are
 * identical to a sequential run (durations aside). Unexpected per-snippet
 * exceptions become error results and are collected in `internal` so the CLI
 * can print partial results and exit 3.
 */
export async function runAll(snippets, ctx) {
  const jobs = Math.max(1, Math.floor(ctx.jobs || 1));
  const results = new Array(snippets.length);
  const internalByIndex = [];
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= snippets.length) return;
      const snippet = snippets[i];
      let result;
      try {
        result = await runSnippet(snippet, ctx);
      } catch (err) {
        // Defensive: runSnippet reports its own errors, but never lose a snippet.
        result = baseResult(snippet);
        result.status = 'error';
        result.failure = { phase: 'sandbox', message: err?.message ?? String(err) };
        result.internal = `${snippet.path}:${snippet.line}: ${err?.message ?? String(err)}`;
      }
      if (result.internal) internalByIndex.push([i, result.internal]);
      results[i] = result;
    }
  }

  const pool = [];
  for (let w = 0; w < Math.min(jobs, Math.max(1, snippets.length)); w++) pool.push(worker());
  await Promise.all(pool);

  // Parallel workers finish out of order; report internals in snippet order so
  // even stderr stays byte-identical to a sequential run.
  internalByIndex.sort((a, b) => a[0] - b[0]);
  return { results, internal: internalByIndex.map(([, msg]) => msg) };
}
