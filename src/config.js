// Config loading: `snipci.config.json` at the repo root (cwd).
// Zero-config is supported: missing file → defaults.

import path from 'node:path';
import { configError } from './errors.js';
import { matchGlob } from './glob.js';

export const CONFIG_FILE = 'snipci.config.json';

export function defaultConfig() {
  return {
    version: 1,
    default: 'run', // zero-config: fenced blocks with a known adapter run
    paths: ['**/*.md'],
    ignore: ['node_modules/**', '.git/**'],
    timeout: 30,
    baseline: { file: '.snipci-baseline.json' },
  };
}

export function validateConfig(raw, file = CONFIG_FILE) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw configError('config must be a JSON object', file);
  }
  const cfg = defaultConfig();

  if (raw.version !== undefined) {
    if (raw.version !== 1) throw configError(`unsupported config version ${JSON.stringify(raw.version)} (expected 1)`, file);
    cfg.version = raw.version;
  }
  if (raw.default !== undefined) {
    if (raw.default !== 'run' && raw.default !== 'skip') {
      throw configError(`"default" must be "run" or "skip" (got ${JSON.stringify(raw.default)})`, file);
    }
    cfg.default = raw.default;
  }
  for (const key of ['paths', 'ignore']) {
    if (raw[key] !== undefined) {
      if (!Array.isArray(raw[key]) || raw[key].some((p) => typeof p !== 'string')) {
        throw configError(`"${key}" must be an array of strings`, file);
      }
      cfg[key] = [...raw[key]];
    }
  }
  if (raw.timeout !== undefined) {
    const t = raw.timeout;
    if (!Number.isInteger(t) || t < 1 || t > 300) {
      throw configError(`"timeout" must be an integer between 1 and 300 (got ${JSON.stringify(t)})`, file);
    }
    cfg.timeout = t;
  }
  if (raw.baseline !== undefined) {
    if (raw.baseline === null || typeof raw.baseline !== 'object' || Array.isArray(raw.baseline)) {
      throw configError('"baseline" must be an object like {"file": ".snipci-baseline.json"}', file);
    }
    if (raw.baseline.file !== undefined) {
      if (typeof raw.baseline.file !== 'string' || raw.baseline.file === '') {
        throw configError('"baseline.file" must be a non-empty string', file);
      }
      cfg.baseline.file = raw.baseline.file;
    }
  }

  const unknown = Object.keys(raw).filter((k) => !['version', 'default', 'paths', 'ignore', 'timeout', 'baseline'].includes(k));
  if (unknown.length > 0) {
    throw configError(`unknown config key${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, file);
  }

  return cfg;
}

/** Load config from `root`. Missing file → defaults. Malformed → exit-2 error. */
export function loadConfig(root, { fs, configPath = null } = {}) {
  const abs = configPath ? configPath : path.join(root, CONFIG_FILE);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    if (configPath) {
      throw configError(`config file not found: ${configPath}`, configPath);
    }
    if (err && err.code === 'ENOENT') return defaultConfig();
    throw err;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw configError(`invalid JSON: ${err.message}`, CONFIG_FILE);
  }
  return validateConfig(raw, CONFIG_FILE);
}

/** True if a relative path matches any glob in `patterns`. */
export function matchesAny(patterns, relPath) {
  return patterns.some((p) => matchGlob(p, relPath));
}
