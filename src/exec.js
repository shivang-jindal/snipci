// Process execution: spawn (shell:false), clean env, timeout with
// process-tree kill, and 64 KB output truncation (SPEC §13).
// The exec runner is injectable so tests can substitute fakes.

import { spawn } from 'node:child_process';

export const OUTPUT_LIMIT = 64 * 1024;
export const TRUNCATION_MARKER = '\n… [snipci: output truncated at 64KB]';

// SPEC §7: no host env passthrough except an allowlist.
export const ENV_ALLOWLIST = ['PATH', 'SYSTEMROOT', 'TEMP', 'LANG'];

export function pickEnv(env, key) {
  if (env == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(env, key)) return env[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === lower) return env[k];
  }
  return undefined;
}

export function cleanEnv(env) {
  const out = {};
  for (const key of ENV_ALLOWLIST) {
    const value = pickEnv(env, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Resolve a command via PATH (hand-rolled; no `which`/`where` subprocess). */
export function makeWhich(env, platform, fs, pathMod) {
  return function which(name) {
    const pathVar = pickEnv(env, 'PATH');
    if (!pathVar) return null;
    const dirs = pathVar.split(pathMod.delimiter).filter(Boolean);
    const exts = platform === 'win32' ? ['', '.exe'] : [''];
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = pathMod.join(dir, name + ext);
        try {
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
          // keep looking
        }
      }
    }
    return null;
  };
}

export function killTree(pid, { platform, spawnImpl = spawn } = {}) {
  if (pid == null) return;
  if (platform === 'win32') {
    try {
      spawnImpl('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
    } catch {
      // best effort
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL'); // detached → own process group
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

function appendCapped(store, chunk) {
  if (store.bytes >= OUTPUT_LIMIT) {
    store.truncated = true;
    return;
  }
  const remaining = OUTPUT_LIMIT - store.bytes;
  const text = chunk.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') > remaining) {
    store.text += Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8');
    store.bytes = OUTPUT_LIMIT;
    store.truncated = true;
    return;
  }
  store.text += text;
  store.bytes += Buffer.byteLength(text, 'utf8');
}

function finish(store) {
  return store.truncated ? store.text + TRUNCATION_MARKER : store.text;
}

/**
 * Create an exec runner. Returns:
 *   Promise<{ exitCode, stdout, stderr, timedOut, spawnError }>
 * `spawnError` is set when the process could not be started at all.
 */
export function createExec({ spawnImpl = spawn, platform = process.platform } = {}) {
  return function exec(file, args, { cwd, env, timeoutMs = 0 } = {}) {
    return new Promise((resolve) => {
      let child;
      const out = { text: '', bytes: 0, truncated: false };
      const err = { text: '', bytes: 0, truncated: false };

      try {
        child = spawnImpl(file, args, {
          cwd,
          env,
          shell: false,
          windowsHide: true,
          detached: platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (spawnErr) {
        resolve({ exitCode: null, stdout: '', stderr: String(spawnErr.message ?? spawnErr), timedOut: false, spawnError: spawnErr });
        return;
      }

      let timedOut = false;
      let settled = false;

      const timer = timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child.pid, { platform, spawnImpl });
          }, timeoutMs)
        : null;

      const done = (exitCode) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          exitCode,
          stdout: finish(out),
          stderr: finish(err),
          timedOut,
          spawnError: null,
        });
      };

      if (child.stdout) {
        child.stdout.on('data', (chunk) => appendCapped(out, chunk));
        child.stderr.on('data', (chunk) => appendCapped(err, chunk));
      }

      child.on('error', (spawnErr) => {
        if (timer) clearTimeout(timer);
        settled = true;
        resolve({ exitCode: null, stdout: finish(out), stderr: String(spawnErr.message ?? spawnErr), timedOut, spawnError: spawnErr });
      });
      child.on('close', (code, signal) => {
        if (timedOut) {
          done(null);
          return;
        }
        done(code == null && signal != null ? 128 : code);
      });
    });
  };
}
