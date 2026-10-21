// Hand-rolled argument parsing (no dependencies, no util.parseArgs).

import { usageError } from './errors.js';

export const COMMANDS = ['run', 'check', 'list', 'init', 'help', 'version'];
export const FORMATS = ['terminal', 'json'];

export function defaultOptions() {
  return {
    command: null,
    paths: [],
    format: 'terminal',
    changedOnly: false,
    all: false,
    baseline: true,
    updateBaseline: false,
    force: false,
    quiet: false,
    verbose: false,
    color: 'auto',
    jobs: 1,
    configPath: null,
    help: false,
    version: false,
  };
}

function takeValue(argv, i, flag) {
  const eq = argv[i].indexOf('=');
  if (eq !== -1) return { value: argv[i].slice(eq + 1), next: i + 1 };
  if (i + 1 >= argv.length) throw usageError(`${flag} requires a value`);
  return { value: argv[i + 1], next: i + 2 };
}

export function parseArgs(argv) {
  const opts = defaultOptions();
  let sawDoubleDash = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (sawDoubleDash) {
      opts.paths.push(arg);
      continue;
    }
    if (arg === '--') {
      sawDoubleDash = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-V') {
      opts.version = true;
      continue;
    }
    if (arg === '--changed-only') {
      opts.changedOnly = true;
      continue;
    }
    if (arg === '--all') {
      opts.all = true;
      continue;
    }
    if (arg === '--baseline') {
      opts.baseline = true;
      continue;
    }
    if (arg === '--no-baseline') {
      opts.baseline = false;
      continue;
    }
    if (arg === '--update-baseline') {
      opts.updateBaseline = true;
      continue;
    }
    if (arg === '--force') {
      opts.force = true;
      continue;
    }
    if (arg === '--quiet' || arg === '-q') {
      opts.quiet = true;
      continue;
    }
    if (arg === '--verbose') {
      opts.verbose = true;
      continue;
    }
    if (arg === '--no-color') {
      opts.color = 'never';
      continue;
    }
    if (arg.startsWith('--format')) {
      const { value, next } = takeValue(argv, i, '--format');
      if (!FORMATS.includes(value)) {
        throw usageError(`unsupported format "${value}" (v0 supports: ${FORMATS.join(', ')})`);
      }
      opts.format = value;
      i = next - 1;
      continue;
    }
    if (arg.startsWith('--jobs')) {
      const { value, next } = takeValue(argv, i, '--jobs');
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        throw usageError(`--jobs must be a positive integer (got "${value}")`);
      }
      opts.jobs = Number(value);
      i = next - 1;
      continue;
    }
    if (arg.startsWith('--config')) {
      const { value, next } = takeValue(argv, i, '--config');
      if (value === '') throw usageError('--config requires a path');
      opts.configPath = value;
      i = next - 1;
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') {
      throw usageError(`unknown option "${arg}" (see snipci --help)`);
    }

    if (!opts.command) {
      opts.command = arg;
    } else {
      opts.paths.push(arg);
    }
  }

  if (opts.help) {
    opts.command = 'help';
    return opts;
  }
  if (opts.version) {
    opts.command = 'version';
    return opts;
  }
  if (!opts.command) {
    throw usageError('missing command (see snipci --help)');
  }
  if (!COMMANDS.includes(opts.command)) {
    throw usageError(`unknown command "${opts.command}" (see snipci --help)`);
  }
  if (opts.changedOnly && opts.all) {
    throw usageError('--changed-only and --all are mutually exclusive');
  }
  if (opts.command === 'init' && opts.paths.length > 0) {
    throw usageError('init takes no path arguments');
  }
  if ((opts.command === 'help' || opts.command === 'version') && opts.paths.length > 0) {
    throw usageError(`${opts.command} takes no arguments`);
  }

  return opts;
}
