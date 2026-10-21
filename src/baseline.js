// Baseline: ids of snippets that still run and report their failure, but do
// not fail CI (SPEC §5 step 3).

import path from 'node:path';
import { configError } from './errors.js';

export function loadBaseline(root, config, { fs } = {}) {
  const file = path.join(root, config.baseline.file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { file, ids: [] };
    throw err;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw configError(`invalid JSON: ${err.message}`, config.baseline.file);
  }
  const ids = Array.isArray(raw) ? raw : raw?.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw configError('baseline must be {"version": 1, "ids": ["snip-…"]}', config.baseline.file);
  }
  return { file, ids };
}

export function writeBaseline(failures, root, config, { fs } = {}) {
  const file = path.join(root, config.baseline.file);
  const ids = [...new Set(failures.map((f) => f.id))].sort();
  const payload = `${JSON.stringify({ version: 1, ids }, null, 2)}\n`;
  fs.writeFileSync(file, payload, 'utf8');
  return { file, ids };
}
