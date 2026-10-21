// Execution plumbing: env allowlist/isolation, PATH resolution, output cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExec, cleanEnv, ENV_ALLOWLIST, makeWhich, OUTPUT_LIMIT, TRUNCATION_MARKER } from '../src/exec.js';
import { tmpDir } from './helpers.js';

test('cleanEnv only passes the allowlist', () => {
  const parent = {
    PATH: 'C:\\bin',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
    LANG: 'C.UTF-8',
    SNIPCI_TEST_SECRET: 'shhh',
    AWS_SECRET_ACCESS_KEY: 'nope',
    npm_token: 'nope',
    path: 'lowercase-dup',
  };
  const env = cleanEnv(parent);
  assert.deepEqual(Object.keys(env).sort(), [...ENV_ALLOWLIST].sort());
  assert.equal(env.SNIPCI_TEST_SECRET, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.LANG, 'C.UTF-8');
  // case-insensitive fallback for Windows-style SystemRoot
  assert.equal(env.SYSTEMROOT, 'C:\\Windows');
});

test('exec runs a command and captures stdout/stderr/exit (shell:false)', async () => {
  const exec = createExec();
  const result = await exec(process.execPath, ['-e', 'console.log("out"); console.error("err")'], {
    env: cleanEnv(process.env),
    cwd: os.tmpdir(),
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /out/);
  assert.match(result.stderr, /err/);
  assert.equal(result.timedOut, false);
});

test('exec reports non-zero exits', async () => {
  const exec = createExec();
  const result = await exec(process.execPath, ['-e', 'process.exit(7)'], {
    env: cleanEnv(process.env),
    cwd: os.tmpdir(),
  });
  assert.equal(result.exitCode, 7);
});

test('exec kills on timeout and flags timedOut', async () => {
  const exec = createExec();
  const started = Date.now();
  const result = await exec(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
    env: cleanEnv(process.env),
    cwd: os.tmpdir(),
    timeoutMs: 500,
  });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 8000, 'kill should not wait for the snippet to finish');
});

test('output is capped at 64KB with a truncation marker', async () => {
  const exec = createExec();
  const big = 'x'.repeat(200 * 1024);
  // Write, then exit only after the pipe has flushed — otherwise a large
  // process.stdout.write can be dropped on implicit exit. The script goes in
  // a file: 200 KB on a command line exceeds Windows' CreateProcess limit.
  const dir = tmpDir();
  const script = path.join(dir, 'big.js');
  fs.writeFileSync(script, `const b = ${JSON.stringify(big)}; process.stdout.write(b, () => process.exit(0));`, 'utf8');
  const result = await exec(process.execPath, [script], {
    env: cleanEnv(process.env),
    cwd: os.tmpdir(),
    timeoutMs: 20_000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length < big.length);
  assert.ok(result.stdout.endsWith(TRUNCATION_MARKER));
  assert.ok(result.stdout.length <= OUTPUT_LIMIT + TRUNCATION_MARKER.length);
});

test('makeWhich resolves executables from PATH (case-insensitive ext on win32)', () => {
  const dir = tmpDir();
  const exeName = process.platform === 'win32' ? 'mytool.exe' : 'mytool';
  fs.writeFileSync(path.join(dir, exeName), '', 'utf8');

  const which = makeWhich({ PATH: dir }, process.platform, fs, path);
  const found = which('mytool');
  assert.ok(found !== null);
  assert.equal(path.basename(found), exeName);

  assert.equal(makeWhich({ PATH: dir }, process.platform, fs, path)('other'), null, 'missing tool → null');
  assert.equal(makeWhich({}, process.platform, fs, path)('mytool'), null, 'no PATH → null');
});
