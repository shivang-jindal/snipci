// Adapter availability decisions — fully deterministic via injected
// platform / which / fs (no dependence on the actual machine).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExecution, looksLikeTypeScript, resolveBashPath } from '../src/adapters.js';

function makeCtx({ platform = 'linux', whichResult = {}, existingFiles = [] } = {}) {
  return {
    platform,
    nodePath: '/usr/bin/node',
    which: (name) => whichResult[name] ?? null,
    fs: { existsSync: (p) => existingFiles.includes(p) },
    env: {},
  };
}

function snippet(lang, content = 'echo hi') {
  return { lang, content, meta: {} };
}

test('bash on win32: skipped (no-bash) unless bash is found on PATH', () => {
  const noBash = makeCtx({ platform: 'win32', whichResult: {} });
  const planned = buildExecution(snippet('bash'), noBash);
  assert.equal(planned.run, false);
  assert.equal(planned.reason, 'no-bash');

  const withBash = makeCtx({
    platform: 'win32',
    whichResult: { bash: 'C:\\Program Files\\Git\\bin\\bash.exe' },
  });
  const runs = buildExecution(snippet('bash', 'echo hello-bash'), withBash);
  assert.equal(runs.run, true);
  assert.equal(runs.command, 'C:\\Program Files\\Git\\bin\\bash.exe');
  assert.deepEqual(runs.args.slice(0, 5), ['-e', '-u', '-o', 'pipefail', 'snippet.sh']);
});

test('bash on POSIX: PATH lookup, then /bin/bash fallback, else no-bash', () => {
  // PATH hit
  const viaPath = makeCtx({ platform: 'linux', whichResult: { bash: '/usr/local/bin/bash' } });
  assert.equal(resolveBashPath(viaPath), '/usr/local/bin/bash');

  // PATH miss but /bin/bash exists → still runs (POSIX only)
  const viaFallback = makeCtx({ platform: 'linux', existingFiles: ['/bin/bash'] });
  assert.equal(resolveBashPath(viaFallback), '/bin/bash');

  // win32 never falls back to /bin/bash
  const winFallback = makeCtx({ platform: 'win32', existingFiles: ['/bin/bash'] });
  assert.equal(resolveBashPath(winFallback), null);
  assert.equal(buildExecution(snippet('bash'), winFallback).reason, 'no-bash');

  // nothing anywhere → no-bash
  const none = makeCtx({ platform: 'linux' });
  assert.equal(resolveBashPath(none), null);
  assert.equal(buildExecution(snippet('bash'), none).reason, 'no-bash');
});

test('python: skipped with no-interpreter when python is absent', () => {
  const absent = makeCtx({ whichResult: {} });
  const planned = buildExecution(snippet('python', 'print(1)'), absent);
  assert.equal(planned.run, false);
  assert.equal(planned.reason, 'no-interpreter');

  const present = makeCtx({ whichResult: { python3: '/usr/bin/python3' } });
  const runs = buildExecution(snippet('python', 'print(1)'), present);
  assert.equal(runs.run, true);
  assert.equal(runs.command, '/usr/bin/python3');
  assert.deepEqual(runs.args, ['-I', 'snippet.py']);
});

test('typescript: real TS is skipped (no-runtime), plain JS runs as .mjs', () => {
  const ts = 'interface X { a: number }\nconst x: X = { a: 1 };';
  assert.equal(looksLikeTypeScript(ts), true);
  const planned = buildExecution(snippet('typescript', ts), makeCtx());
  assert.equal(planned.run, false);
  assert.equal(planned.reason, 'no-runtime');

  const plain = 'console.log("hello");';
  assert.equal(looksLikeTypeScript(plain), false);
  const runs = buildExecution(snippet('typescript', plain), makeCtx());
  assert.equal(runs.run, true);
  assert.equal(runs.files[0].name, 'snippet.mjs');
  assert.equal(runs.command, '/usr/bin/node');
});

test('javascript always runs via node; unknown/empty languages skip honestly', () => {
  const js = buildExecution(snippet('javascript', 'console.log(1)'), makeCtx());
  assert.equal(js.run, true);
  assert.equal(js.files[0].name, 'snippet.mjs');

  const yaml = buildExecution(snippet('yaml', 'key: value'), makeCtx());
  assert.equal(yaml.run, false);
  assert.equal(yaml.reason, 'no-adapter');

  const none = buildExecution(snippet('', 'plain text'), makeCtx());
  assert.equal(none.run, false);
  assert.equal(none.reason, 'no-language');
});

test('TypeScript pattern coverage stays conservative (JS-looking stays JS)', () => {
  assert.equal(looksLikeTypeScript('const a = { status: 1 };'), false);
  assert.equal(looksLikeTypeScript('for (const x of xs) { x.go(); }'), false);
  assert.equal(looksLikeTypeScript('import type { Foo } from "./foo";'), true);
  assert.equal(looksLikeTypeScript('let total: number = 0;'), true);
});
