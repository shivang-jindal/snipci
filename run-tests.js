// Entry shim for `node --test test/`.
//
// On Node >= 21, positional arguments to `--test` are glob patterns, and the
// bare pattern `test/` matches the *directory itself* — the runner then tries
// to execute `test/` as a test file. `test/package.json` points that entry at
// this module (and pins `type: module` for everything under test/), which
// imports the whole suite. On older Node versions, where `node --test test/`
// searches the directory directly, this file is never used.
//
// This file deliberately lives at the repo root with a name that matches none
// of the test-runner default patterns, so a bare `node --test` still runs
// each test file exactly once.

import './test/fence.test.js';
import './test/directives.test.js';
import './test/adapters.test.js';
import './test/exec.test.js';
import './test/fixtures.test.js';
import './test/cli.test.js';
import './test/baseline.test.js';
import './test/planner.test.js';
import './test/jobs.test.js';
import './test/selfhost.test.js';
