// Command implementations: run/check, list, init + help text.

import path from 'node:path';
import { configError } from './errors.js';
import { loadConfig, CONFIG_FILE } from './config.js';
import { loadBaseline, writeBaseline } from './baseline.js';
import { plan } from './planner.js';
import { runAll } from './runner.js';
import { summarize, exitCodeFor, renderTerminal, renderJson } from './reporters.js';

function formatDuration(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function printReport(io, opts, results, summary, notes) {
  if (opts.format === 'json') {
    io.stdout.write(renderJson(results, { summary, notes }));
    return;
  }
  if (opts.quiet && summary.failing === 0) {
    io.stdout.write(`  ${summary.snippets} snippets · ${summary.pass} passing · ${summary.skipped} skipped · ${formatDuration(summary.durationMs)}\n`);
    io.stdout.write(`  docs: passing\n\n`);
    return;
  }
  io.stdout.write(renderTerminal(results, { summary, notes }));
}

export async function runCommand(optsIn, io) {
  // `check` is the CI gate: quiet summary when passing, full report when not.
  const opts = optsIn.command === 'check' ? { ...optsIn, quiet: true } : optsIn;
  const config = loadConfig(io.root, { fs: io.fs, configPath: opts.configPath });

  let baseline = { file: null, ids: [] };
  if (opts.baseline || opts.updateBaseline) {
    baseline = loadBaseline(io.root, config, { fs: io.fs });
  }

  const adapterCtx = {
    platform: io.platform,
    env: io.env,
    which: io.which,
    fs: io.fs,
    nodePath: io.nodePath,
  };

  const planned = await plan({
    root: io.root,
    config,
    cliPaths: opts.paths,
    changedOnly: opts.changedOnly && !opts.all,
    baselineIds: baseline.ids,
    exec: io.exec,
    fs: io.fs,
    adapterCtx,
  });

  const notes = [...planned.notes];

  const t0 = io.now();
  const { results, internal } = await runAll(planned.snippets, {
    root: io.root,
    exec: io.exec,
    env: io.env,
    platform: io.platform,
    now: io.now,
    tmpdir: io.tmpdir,
    fs: io.fs,
    defaultTimeout: config.timeout,
  });
  const durationMs = io.now() - t0;

  if (opts.updateBaseline) {
    const failures = results.filter((r) => r.status === 'fail' || r.status === 'error');
    const written = writeBaseline(failures, io.root, config, { fs: io.fs });
    notes.push(`baseline updated: ${path.basename(written.file)} (${written.ids.length} known failure${written.ids.length === 1 ? '' : 's'})`);
  }

  if (planned.files.length === 0) {
    notes.push('no markdown files matched (check paths/ignore in snipci.config.json)');
  }

  const summary = summarize(results, { durationMs, notes });
  printReport(io, opts, results, summary, notes);

  if (internal.length > 0) {
    for (const message of internal) io.stderr.write(`snipci: internal error: ${message}\n`);
    return 3;
  }
  if (opts.updateBaseline) return 0;
  return exitCodeFor(summary);
}

export async function listCommand(opts, io) {
  const config = loadConfig(io.root, { fs: io.fs, configPath: opts.configPath });
  const adapterCtx = {
    platform: io.platform,
    env: io.env,
    which: io.which,
    fs: io.fs,
    nodePath: io.nodePath,
  };
  const planned = await plan({
    root: io.root,
    config,
    cliPaths: opts.paths,
    changedOnly: false,
    baselineIds: [],
    exec: io.exec,
    fs: io.fs,
    adapterCtx,
  });

  const entries = planned.snippets.map((s) => ({
    id: s.id,
    path: s.path,
    line: s.line,
    lang: s.lang,
    action: s.meta.action ?? '(default)',
    run: s.plan.run,
    reason: s.plan.reason,
    anchor: s.anchor,
    directives: Object.fromEntries(
      Object.entries(s.meta).filter(([key]) => key !== 'action'),
    ),
  }));

  if (opts.format === 'json') {
    io.stdout.write(`${JSON.stringify({ snippets: entries }, null, 2)}\n`);
    return 0;
  }

  for (const e of entries) {
    const action = e.run ? 'run' : `skip (${e.reason})`;
    const dirs = Object.entries(e.directives)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
      .join(' ');
    io.stdout.write(
      `${e.id}  ${e.path}:${e.line}  [${e.lang || 'no-language'}]  ${action}${dirs ? `  ${dirs}` : ''}\n`,
    );
  }
  io.stdout.write(`\n${entries.length} snippet${entries.length === 1 ? '' : 's'}\n`);
  return 0;
}

export function initCommand(opts, io) {
  const file = path.join(io.root, CONFIG_FILE);
  if (io.fs.existsSync(file) && !opts.force) {
    throw configError(`${CONFIG_FILE} already exists (use --force to overwrite)`, CONFIG_FILE);
  }

  const config = {
    version: 1,
    default: 'run',
    paths: ['README.md', 'docs/**', '*.md'],
    ignore: ['node_modules/**'],
    timeout: 30,
    baseline: { file: '.snipci-baseline.json' },
  };
  io.fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  io.stdout.write(`wrote ${CONFIG_FILE}\n\n`);
  io.stdout.write('Directives (v0):\n');
  io.stdout.write('  fence info string:  ```js snipci="run timeout=10 expect=ok"\n');
  io.stdout.write('  inline first lines: // snipci: run   /   # snipci: skip reason=needs-network\n');
  io.stdout.write('    run                    execute the snippet (default when default=run)\n');
  io.stdout.write('    skip [reason=…]        never execute; reason is shown in the report\n');
  io.stdout.write('    expect=<string>        exact stdout match after trim + CRLF normalization\n');
  io.stdout.write('    expect-regex=<re>       regex match on stdout\n');
  io.stdout.write('    expect-exit=<n>         expected exit code (default 0)\n');
  io.stdout.write('    expect-error            expects exit 1 with non-empty stderr\n');
  io.stdout.write('    timeout=<s>             per-snippet timeout (default 30, max 300)\n');
  io.stdout.write('    id=<stable>             stable id override (baselines, reporting)\n');
  io.stdout.write('    cwd=<path>              working directory relative to the repo root\n');
  io.stdout.write('\nUnknown directives are hard errors naming file:line — typos never silently skip.\n');
  io.stdout.write('Next: snipci run   (then wire `snipci check` into CI)\n');
  return 0;
}

export function printHelp(write) {
  write(`snipci — CI that runs every code snippet in your docs

Usage:
  snipci run [paths…]     extract + execute snippets
  snipci check [paths…]   CI gate (quiet summary; exit 1 on failures)
  snipci list [paths…]    show discovered snippets + their directives
  snipci init             write snipci.config.json + directive cheat-sheet
  snipci help             show this help
  snipci version          show version

Options:
  --format terminal|json  output format (default: terminal)
  --changed-only          only docs touched per git diff (falls back to a
                          full run outside a git repo)
  --all                   force a full run (implies ignoring --changed-only)
  --baseline              consult the .snipci-baseline.json file (default: on)
  --no-baseline           ignore the baseline file
  --update-baseline       rewrite the baseline from current results
  --config <path>         config file (default: snipci.config.json)
  --jobs <n>              accepted; v0 runs sequentially (pool deferred)
  --quiet, -q             summary only (when passing)
  --verbose               full report even when passing
  --no-color              never colorize (v0 output is plain anyway)
  -h, --help              show this help
  -V, --version           show version

Exit codes:
  0  all pass        1  failures        2  usage/config error
  3  internal error (partial results are printed first)

Directives live in the fence info string (\`\`\`js snipci="run expect=ok") or
in first-line comments (// snipci: run, # snipci: skip, <!-- snipci: run -->):
  run · skip [reason=…] · expect=<string> · expect-regex=<re>
  expect-exit=<n> · expect-error · timeout=<s> · id=<stable> · cwd=<path>
Unknown directives are hard errors naming file:line — typos never silently skip.
`);
}
