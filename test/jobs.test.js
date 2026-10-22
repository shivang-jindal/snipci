// --jobs N: parallel snippet execution with reports identical to sequential.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../src/args.js';
import { runCommand } from '../src/commands.js';
import { makeWhich } from '../src/exec.js';
import { runCli, tmpDir, writeFixture } from './helpers.js';

const DOC = [
  '# Jobs demo',
  '',
  '```javascript',
  'console.log("one");',
  '```',
  '',
  '```javascript',
  'console.log("two");',
  '```',
  '',
  '```javascript',
  'console.log("three");',
  '```',
  '',
  '```javascript',
  'console.log("four");',
  '```',
  '',
].join('\n');

/**
 * Fake process runner: never spawns. Completion order is scrambled by giving
 * earlier snippets longer delays, so a --jobs 4 pool completes in reverse.
 */
function scrambledExec(delays) {
  const started = [];
  const completed = [];
  let call = 0;
  const exec = async () => {
    const index = call++;
    started.push(index);
    await new Promise((resolve) => setTimeout(resolve, delays[index] ?? 10));
    completed.push(index);
    return { exitCode: 0, stdout: `out-${index}\n`, stderr: '', timedOut: false, spawnError: null };
  };
  return { exec, started, completed };
}

function fakeIo(root, exec) {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      root,
      fs,
      exec,
      env: process.env,
      platform: process.platform,
      now: () => 0, // frozen clock: every durationMs is a deterministic 0
      tmpdir: () => os.tmpdir(),
      nodePath: process.execPath,
      which: makeWhich(process.env, process.platform, fs, path),
      stdout: {
        write: (s) => {
          out.stdout += s;
        },
      },
      stderr: {
        write: (s) => {
          out.stderr += s;
        },
      },
    },
  };
}

function freshDocDir() {
  const dir = tmpDir('snipci-jobs-');
  writeFixture(dir, 'doc.md', DOC);
  return dir;
}

function stripDurations(value) {
  if (Array.isArray(value)) return value.map(stripDurations);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === 'durationMs') continue;
      out[key] = stripDurations(v);
    }
    return out;
  }
  return value;
}

test('--jobs 4 with scrambled completion keeps the JSON report identical to jobs=1', async () => {
  const args1 = parseArgs(['run', 'doc.md', '--format', 'json']);
  const args4 = parseArgs(['run', 'doc.md', '--format', 'json', '--jobs', '4']);

  const dir1 = freshDocDir();
  const fake1 = scrambledExec([90, 60, 30, 5]);
  const io1 = fakeIo(dir1, fake1.exec);
  const code1 = await runCommand(args1, io1.io);
  assert.equal(code1, 0, io1.out.stderr);

  const dir4 = freshDocDir();
  const fake4 = scrambledExec([90, 60, 30, 5]);
  const io4 = fakeIo(dir4, fake4.exec);
  const code4 = await runCommand(args4, io4.io);
  assert.equal(code4, 0, io4.out.stderr);

  // The pool really ran concurrently: snippets started in order but finished
  // in reverse (the fake exec scrambles completion on purpose).
  assert.deepEqual(fake4.started, [0, 1, 2, 3]);
  assert.deepEqual(fake4.completed, [3, 2, 1, 0]);

  const report1 = JSON.parse(io1.out.stdout);
  const report4 = JSON.parse(io4.out.stdout);
  assert.equal(report4.summary.pass, 4);
  assert.deepEqual(stripDurations(report4), stripDurations(report1));
});

test('--jobs 4 keeps the terminal report identical to jobs=1', async () => {
  const args1 = parseArgs(['run', 'doc.md']);
  const args4 = parseArgs(['run', 'doc.md', '--jobs', '4']);

  const dir1 = freshDocDir();
  const fake1 = scrambledExec([90, 60, 30, 5]);
  const io1 = fakeIo(dir1, fake1.exec);
  const code1 = await runCommand(args1, io1.io);
  assert.equal(code1, 0, io1.out.stderr);

  const dir4 = freshDocDir();
  const fake4 = scrambledExec([90, 60, 30, 5]);
  const io4 = fakeIo(dir4, fake4.exec);
  const code4 = await runCommand(args4, io4.io);
  assert.equal(code4, 0, io4.out.stderr);

  assert.deepEqual(fake4.completed, [3, 2, 1, 0]);
  assert.match(io1.out.stdout, /docs: passing/);
  // Frozen clock makes durations deterministic 0ms, so the two human reports
  // must be byte-identical, not merely equivalent.
  assert.equal(io4.out.stdout, io1.out.stdout);
});

test('default (no --jobs) is byte-identical to explicit --jobs 1', async () => {
  const argsDefault = parseArgs(['run', 'doc.md', '--format', 'json']);
  const argsOne = parseArgs(['run', 'doc.md', '--format', 'json', '--jobs', '1']);
  assert.equal(argsDefault.jobs, 1);

  const dirA = freshDocDir();
  const fakeA = scrambledExec([90, 60, 30, 5]);
  const ioA = fakeIo(dirA, fakeA.exec);
  const codeA = await runCommand(argsDefault, ioA.io);
  assert.equal(codeA, 0, ioA.out.stderr);

  const dirB = freshDocDir();
  const fakeB = scrambledExec([90, 60, 30, 5]);
  const ioB = fakeIo(dirB, fakeB.exec);
  const codeB = await runCommand(argsOne, ioB.io);
  assert.equal(codeB, 0, ioB.out.stderr);

  assert.deepEqual(fakeA.completed, [0, 1, 2, 3], 'default path stays sequential');
  assert.equal(ioB.out.stdout, ioA.out.stdout);
  assert.equal(ioB.out.stderr, ioA.out.stderr);
});

test('invalid --jobs values (0, -1, x) print a usage error and exit 2', () => {
  for (const value of ['0', '-1', 'x']) {
    const res = runCli(['run', '--jobs', value]);
    assert.equal(res.code, 2, `--jobs ${value} → ${res.stderr}`);
    assert.match(res.stderr, /--jobs must be a positive integer/);
    assert.doesNotMatch(res.stderr, /^\s+at /m, 'no stack traces for usage errors');
  }
});
