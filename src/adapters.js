// Language adapters. Each adapter decides availability honestly:
//   javascript → node (.mjs)
//   typescript → node, but only when the snippet is plain JS (otherwise
//                skipped: no-runtime — we do NOT strip types in v0)
//   bash       → skipped: no-bash on win32 unless bash is found on PATH
//   python     → skipped: no-interpreter when python is absent
//
// All environment decisions go through the injected ctx
// { platform, env, which, fs, nodePath } so tests are deterministic.

export const DEFAULT_TIMEOUT = 30;
export const MAX_TIMEOUT = 300;

const TS_PATTERNS = [
  /\binterface\s+\w+\s*(?:<[^>]*>)?\s*\{/,
  /^\s*(?:export\s+)?type\s+\w+\s*(?:<[^>]*>)?\s*=/m,
  /\benum\s+\w+\s*\{/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+\s+extends\s+</m,
  /^\s*(?:declare|namespace|module)\s+\w+/m,
  /:\s*(?:string|number|boolean|any|unknown|never|void|object|bigint|symbol)(?:\[\])?\s*[,)=;]/,
  /\bas\s+(?:const|keyof|typeof|satisfies|string|number|boolean)\b/,
  /\b(?:function|class)\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*:\s*[\w.[\]{}|]/,
  /^\s*(?:let|const|var)\s+\w+\s*:\s*[\w.[\]{}|]/m,
  /\b(?:import|export)\s+type\s+/,
];

/**
 * Honest heuristic: does this `.ts` fence contain TypeScript-only syntax?
 * If it looks like TS and there is no TS runtime, we skip (no-runtime)
 * instead of pretending it ran.
 */
export function looksLikeTypeScript(code) {
  return TS_PATTERNS.some((re) => re.test(code));
}

/** POSIX-only fallback when PATH lookup fails. */
export function resolveBashPath(ctx) {
  const found = ctx.which('bash');
  if (found) return found;
  if (ctx.platform !== 'win32') {
    for (const candidate of ['/bin/bash', '/usr/bin/bash']) {
      try {
        if (ctx.fs.existsSync(candidate)) return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

export function resolvePythonPath(ctx) {
  return ctx.which('python3') ?? ctx.which('python');
}

function withFinalNewline(content) {
  const text = String(content ?? '');
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Decide whether a snippet runs and, if so, how.
 * Returns { run: true, command, args, files } or { run: false, reason }.
 */
export function buildExecution(snippet, ctx) {
  const content = withFinalNewline(snippet.content);

  switch (snippet.lang) {
    case 'javascript': {
      return {
        run: true,
        command: ctx.nodePath,
        args: ['snippet.mjs'],
        files: [{ name: 'snippet.mjs', content }],
      };
    }
    case 'typescript': {
      if (looksLikeTypeScript(snippet.content)) {
        return { run: false, reason: 'no-runtime' };
      }
      return {
        run: true,
        command: ctx.nodePath,
        args: ['snippet.mjs'],
        files: [{ name: 'snippet.mjs', content }],
      };
    }
    case 'bash': {
      const bash = resolveBashPath(ctx);
      if (!bash) return { run: false, reason: 'no-bash' };
      return {
        run: true,
        command: bash,
        args: ['-e', '-u', '-o', 'pipefail', 'snippet.sh'],
        files: [{ name: 'snippet.sh', content }],
      };
    }
    case 'python': {
      const python = resolvePythonPath(ctx);
      if (!python) return { run: false, reason: 'no-interpreter' };
      return {
        run: true,
        command: python,
        args: ['-I', 'snippet.py'],
        files: [{ name: 'snippet.py', content }],
      };
    }
    default:
      return { run: false, reason: snippet.lang === '' ? 'no-language' : 'no-adapter' };
  }
}
