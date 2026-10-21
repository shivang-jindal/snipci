// Shared test helpers (side-effect free).
//
// If the test runner happens to collect this file, it simply passes with
// zero tests — all actual assertions live in *.test.js files.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// import.meta.url → filesystem path without importing node:url.
function metaDir() {
  let p = String(import.meta.url).replace(/^file:\/\//, '');
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep raw
  }
  return path.dirname(process.platform === 'win32' ? p.replace(/\//g, '\\') : p);
}

export const TEST_DIR = metaDir();
export const BASE = path.resolve(TEST_DIR, '..');
export const CLI = path.join(BASE, 'src', 'cli.js');
export const FIXTURES = path.join(TEST_DIR, 'fixtures');

/** Run the snipci CLI in a child process (shell:false, spaces-safe). */
export function runCli(args, { cwd = BASE, env = process.env } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 60_000,
  });
  if (res.error) throw res.error;
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Fresh temp workspace (all test writes stay in os.tmpdir). */
export function tmpDir(prefix = 'snipci-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFixture(dir, name, content) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

export function parseJson(stdout) {
  return JSON.parse(stdout);
}
