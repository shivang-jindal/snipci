#!/usr/bin/env node
// snipci CLI entry point. Hand-rolled dispatch; exit codes per SPEC §9:
//   0 all pass · 1 failures · 2 usage/config · 3 internal (partial results)
//
// This file is the bin script: it always runs main(). Tests exercise it by
// spawning `node src/cli.js …` (or import the pure modules directly).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './args.js';
import { SnipciError } from './errors.js';
import { createExec, makeWhich } from './exec.js';
import { runCommand, listCommand, initCommand, printHelp } from './commands.js';

// Minimal file:// → path conversion (kept dependency- and node:url-free).
function fileUrlToPath(url) {
  let p = String(url).replace(/^file:\/\//, '');
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // Windows drive letter
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep raw
  }
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
}

const HERE = path.dirname(fileUrlToPath(import.meta.url));

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function makeIo() {
  const exec = createExec();
  const which = makeWhich(process.env, process.platform, fs, path);
  return {
    root: process.cwd(),
    fs,
    exec,
    env: process.env,
    platform: process.platform,
    now: () => Date.now(),
    tmpdir: () => os.tmpdir(),
    nodePath: process.execPath,
    which,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

export async function main(argv, io = makeIo()) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    io.stderr.write(`snipci: ${err.message}\n`);
    return 2;
  }

  if (opts.command === 'help') {
    printHelp((text) => io.stdout.write(text));
    return 0;
  }
  if (opts.command === 'version') {
    io.stdout.write(`snipci ${readVersion()}\n`);
    return 0;
  }

  try {
    if (opts.command === 'init') return initCommand(opts, io);
    if (opts.command === 'list') return listCommand(opts, io);
    return await runCommand(opts, io);
  } catch (err) {
    if (err instanceof SnipciError) {
      io.stderr.write(`snipci: ${err.format()}\n`);
      return err.exitCode;
    }
    io.stderr.write(`snipci: internal error: ${err?.stack ?? err}\n`);
    return 3;
  }
}

process.exitCode = await main(process.argv.slice(2));
