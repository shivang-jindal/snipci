# snipci — docs that don't lie

> **CI that runs every code snippet in your README, docs, and docstrings.**
> Ship a badge the day your examples start rotting.

**Archetype:** CLI + GitHub Action + badge · **Buzz:** 🔥🔥🔥🔥🔥 · **Build speed:** Fast

---

## The problem

The single worst first experience in software: you copy the README's 6-line
quickstart, paste it, and get `TypeError`. The example is 14 months old, the API
changed, nobody ran it since.

There *are* per-language tools (`doctest`, `mdsh`, `runme`, Jupyter, swift-doc)
but nothing that walks a whole repo — markdown + MDX + RST + notebooks +
docstrings — across languages, in one CI step, with a badge.

And docs rot invisibly. There's no signal. So it never gets fixed.

## The idea

Annotate nothing by default. Fence meta where you need control:

````markdown snipci="skip reason=docs-demo"
```ts title=quickstart
import { connect } from "acme";
const c = await connect();          // snipci: run
console.log(c.ping());              // snipci: expect "pong"
```

```bash
npm install acme                    # snipci: skip  (network)
```

```python
from acme import connect            # snipci: expect-error  (renamed in v3)
```
````

```bash snipci="skip reason=sample-output"
$ snipci run
  docs/quickstart.md        3 snippets  ✅ 1.2s   (cached: 2)
  docs/migration.md        11 snippets  ❌ 1      ← line 44: ReferenceError
  README.md                 6 snippets  ✅ 0.4s
  src/*.py docstrings       8 snippets  ✅ 2.1s
  ────────────────────────────────────────────────
  28 snippets · 27 passing · 4.1s   docs: failing
```

- **PR comment** shows the failing example + the diff that would fix it.
- **Badge** `docs: passing | failing` (shields endpoint included).
- **Cache by snippet hash** — unchanged examples don't re-run. Cold on a PR,
  warm on main. Sub-10s on most repos.
- **Isolation:** Docker/Podman, or microVM later. Never runs on your runner bare.

## Why it wins

- **Universal coverage is the whole product.** Everyone has *some* doctesting;
  nobody has "the whole repo, any language, one badge."
- **Badge virality is proven** (coverage, CI status, security). Same psychology,
  new currency: *docs trust*.
- **It's a bug detector for your front door.** Broken examples = churned users who
  never file an issue — you never even learn you lost them.
- **Composes:** feeds `dxlint` (README quickstart validity rule) and `firstday`
  (guaranteed-to-run onboarding).

## Who wants it

Maintainers of libraries with 50+ README/doc examples (SDKs, frameworks, CLIs,
data tools), docs teams, and anyone whose "Getting Started" is their sales page.

## Features

**v0 (weekend):** markdown only · node + python runners · explicit meta tags ·
local `snipci run` · exit code.
**v1:** GitHub Action + PR comment + badge · snippet cache · `expect`/`expect-error`
assertions · docker isolation · RST + MDX.
**v2:** notebooks + docstrings · `snipci suggest` (LLM proposes the corrected
snippet, opens a PR) · multi-language matrix per snippet · docs site plugin ·
`docs:` score leaderboard.

## Architecture

``` snipci="skip reason=architecture-diagram"
parsers (md/mdx/rst/ipynb/pydoc)
        │  → AST of code blocks + meta
        ▼
  planner (dedupe, hash, skip rules, changed-files filter)
        │
        ▼
  runner pool (docker/podman)  ← language adapters: node, py, go, rust…
        │
        ▼
  reporter: terminal · JSON · PR comment · shields.io endpoint · cache (content-addressed)
```

Roughly: **parser (1 day) → planner (half day) → adapters (2 days) → reporter
(half day).** Everything else is polish.

## Growth loop

1. Badge → every README becomes an ad.
2. `snipci init` writes annotations in <30s and prints before/after.
3. **Open PRs against popular repos** where you found a broken example. Merge
   rate on "your README is broken, here's the fix + the badge" is extremely high.
   That is your entire distribution strategy, week 1.
4. Weekly "docs are rotting" report for stars of the ecosystem.

## Competitors & wedge

| Existing | Gap you exploit |
|----------|-----------------|
| `doctest` / `pytest --doctest-modules` | One language, one ecosystem |
| `runme` / `mdsh` | Execution-oriented, no CI/badge/multi-lang story |
| Jupyter / Quarto | Notebook-first, heavy |
| `criterion`/`insta`-style | Tests code, not prose |

**Wedge:** cross-language + cache + badge + "opens the fix PR for you."

## 48-hour MVP

1. Day 1: markdown fence parser with meta tags → runner for node/python →
   `snipci run` locally with pass/fail table.
2. Day 2 AM: GitHub Action + PR comment template + shields endpoint (it's just
   a JSON file + a shields dynamic card).
3. Day 2 PM: run it against 10 popular repos, save the failure screenshots,
   publish results. "8 of the 10 most-starred X repos have broken README examples"
   is the post.

## Monetization (open core)

- Free: CLI, Action, badge — forever. (The badge *is* the marketing.)
- **Pro:** hosted dashboard across repos, docs coverage over time, `suggest` +
  auto-fix PRs, org-wide docs score, private registry support.

## Risks

- **Snippets needing network/credentials.** Default `skip` + explicit opt-in +
  fixture mode. Be conservative; false failures are fatal to adoption.
- **Flaky examples (time, randomness).** Seeded RNG, frozen clock injection,
  retry-once then fail.
- **Annotation fatigue.** Zero-config defaults must work; meta is escape hatch only.

---

## Build & test

Zero runtime dependencies — Node ≥ 20 only. No `npm install`, no lockfile.

```bash snipci="skip reason=command-menu"
# run from the snipci directory
node src/cli.js --help          # usage, directives, exit codes
node src/cli.js run README.md   # self-hosting gate (also asserted by the test suite)
node src/cli.js check           # CI gate: exit 1 on failures not in the baseline
node --test test/               # 78 tests (parser, fixture, env-isolation, exit-code, self-tests)
```

(`run-tests.js` + `test/package.json` are a portability shim: on Node ≥ 21 the
positional argument to `--test` is a glob, and bare `test/` matches the
directory itself — the shim executes the suite in that case. On Node 20,
`node --test test/` searches the directory directly and never touches it.)

The next snippet is genuinely executed by snipci every time this README is
checked (the test suite asserts `snipci run README.md` exits 0):

```js snipci="run expect='snipci: docs do not lie'"
console.log("snipci: docs do not lie");
```

## v0 status

**Shipped, covered by 78 passing tests:**

- Markdown fence extraction: ` ``` `/`~~~` fences ≥ 3 long, info strings,
  nested blocks (4-backtick demos keep their inner fences), CRLF/CR input,
  unclosed fences; stable snippet ids = hash(path + heading anchor + content)
- Directives: `run`, `skip [reason=…]`, `expect=<string>` (exact after trim +
  CRLF normalization), `expect-regex=<re>`, `expect-exit=<n>`, `expect-error`,
  `timeout=<s>` (default 30, max 300), `id=<stable>`, `cwd=<path>` — written
  either as `snipci="run timeout=10 expect='ok'"` inside the fence info string
  or as first-line comments (`# snipci: skip`, `// snipci: expect "pong"`,
  `<!-- snipci: run -->`); inline beats fence meta; unknown directives are hard
  errors naming `file:line`
- Adapters: JavaScript → temp `.mjs`; TypeScript runs only when the fence is
  actually plain JS, otherwise `skipped: no-runtime` (v0 does not strip types);
  bash → `no-bash` unless a shell is found (win32 needs Git Bash etc.);
  Python → `no-interpreter` when python is absent
- Execution hygiene: `spawn` with `shell:false`, clean env allowlist
  (`PATH`, `SYSTEMROOT`, `TEMP`, `LANG`), fresh temp working dir per snippet,
  timeout kills the process tree (`taskkill /T /F` on win32, process group on
  POSIX), stdout/stderr capped at 64 KB
- Planner + config: `snipci.config.json` (paths, ignore, default run/skip,
  timeout, baseline file), `--changed-only` via `git diff --name-only` with
  full-run fallback outside git, `.snipci-baseline.json` (known failures still
  run and are reported but do not fail CI), `--update-baseline`
- CLI: `snipci run|check|list|init|help|version`, terminal table with
  per-file counts/durations and an expected-vs-actual line diff,
  `--format json`, exit codes 0/1/2/3 per SPEC
- Self-hosting gate: this README's fences are annotated (skips carry reasons)
  and `snipci run README.md` is asserted green by the test suite
- `--jobs N` on run/check: a worker pool executes snippets with N-way
  concurrency while human and JSON reports stay identical in content and
  ordering to the sequential run (durations aside); default `--jobs 1`

**Deferred** (v1+, per SPEC)

- Snippet cache and dedupe (`0 cached` is always printed); Docker/Podman
  isolation, network egress allowlist, secrets redaction
- GitHub Action + PR comment + badge, junit/markdown/shields reporters
- `.mdx`/`.rst`/`.ipynb`/docstring extraction; group sessions, setup blocks;
  `env=`, `image=`, `fixture=`, `seed=` directives; RE2-semantics regex safety
- `snipci explain|replay|suggest`
