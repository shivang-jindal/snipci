// Planner: resolve target files → extract snippets → decide what runs.
//
//   1. filter   by CLI paths or config paths/ignore
//   2. annotate parse meta; unknown directive → hard error (file:line)
//   3. policy   explicit `skip`/`run` > config default (`run`/`skip`)
//   4. avail    adapters may still skip honestly (no-runtime, no-interpreter…)
//   5. baseline mark known-failing ids (still run, don't fail CI)
//   6. diff     --changed-only via git diff, with full-run fallback

import path from 'node:path';
import { parseMarkdown } from './fence.js';
import { buildSnippet } from './snippet.js';
import { buildExecution } from './adapters.js';
import { expandFiles, toPosix } from './glob.js';
import { changedFiles } from './git.js';

const MARKDOWN_RE = /\.(md|markdown)$/i;

export function resolvePlan(snippet, config, ctx) {
  const meta = snippet.meta;

  if (meta.action === 'skip') {
    return { run: false, reason: meta.reason ?? 'explicit-skip', execution: null };
  }

  const wantRun = meta.action === 'run' ? true : config.default === 'run';
  if (!wantRun) {
    return { run: false, reason: 'default-skip', execution: null };
  }

  const execution = buildExecution(snippet, ctx);
  if (!execution.run) {
    return { run: false, reason: execution.reason, execution: null };
  }
  return { run: true, reason: null, execution };
}

export async function plan({ root, config, cliPaths, changedOnly, baselineIds, exec, fs, adapterCtx }) {
  const notes = [];
  const explicit = cliPaths.length > 0;
  const patterns = explicit ? cliPaths : config.paths;

  let files = expandFiles({
    root,
    patterns,
    ignore: config.ignore,
    applyIgnore: !explicit,
    fs,
    filter: (abs) => MARKDOWN_RE.test(abs),
  });

  if (changedOnly) {
    const changed = await changedFiles({ exec, cwd: root });
    if (changed.ok) {
      const changedSet = new Set(changed.files.map(toPosix));
      const before = files.length;
      files = files.filter((abs) => {
        const rel = toPosix(path.relative(root, abs));
        return changedSet.has(rel);
      });
      notes.push(`changed-only: ${files.length}/${before} doc(s) touched by git diff`);
    } else {
      notes.push(`changed-only unavailable (${changed.reason}); running the full set`);
    }
  }

  const snippets = [];
  for (const abs of files) {
    const rel = toPosix(path.relative(root, abs)) || toPosix(path.basename(abs));
    const text = fs.readFileSync(abs, 'utf8');
    const { fences } = parseMarkdown(text, rel);
    for (const fence of fences) {
      const snippet = buildSnippet(fence, { file: rel, repoPath: rel });
      const planForSnippet = resolvePlan(snippet, config, adapterCtx);
      snippet.plan = planForSnippet;
      snippet.baselineKnown = baselineIds.includes(snippet.id);
      snippets.push(snippet);
    }
  }

  return { files, snippets, notes };
}
