# snipci — technical specification

> Companion to [`README.md`](./README.md). Build document for v0–v1: annotation
> grammar, extraction, planner, runners, isolation, caching, reporting.

---

## 1. Design invariants

1. **Zero-config first.** A repo with plain fenced code blocks must get value
   with no config file and no annotations. Meta directives are escape hatches,
   never requirements.
2. **Never a false green.** If a snippet's result is uncertain (timeout,
   sandbox error), it is reported as *error*, not *pass*. Trust is the product.
3. **Conservative by default.** Anything touching the network, the filesystem
   outside the workspace, or secrets is skipped unless explicitly enabled.
4. **Cheap on CI.** PR runs execute only affected snippets by default
   (changed-docs mapping + content hash). Full runs are nightly/manual.
5. **Self-hosting.** snipci's own docs are executed by snipci in its own CI.
   If that breaks, the release is blocked.

## 2. Annotation grammar

Directives live in the fence info string after the language, or as the first
line comment inside the block.

````markdown
```python title=quickstart snipci="run timeout=20 expect='ok'"
```bash snipci="skip reason=needs-network"
```js snipci="group=api run"                # group for shared session
````

| Directive | Meaning |
|-----------|---------|
| `run` | execute (default for `lang` blocks in docs listed under `paths`, if `default=run`) |
| `skip [reason=…]` | never run; reason printed in report |
| `cwd=<path>` | working directory relative to repo root |
| `env=K=V,K2=V2` | extra env vars (values must be literal; no secret interpolation) |
| `expect=<string>` | exact stdout match after trim + line-ending normalization |
| `expect-regex=<re>` | regex match on stdout |
| `expect-exit=<n>` | expected exit code (default 0) |
| `expect-error` | shorthand for `expect-exit=1` + stderr non-empty |
| `timeout=<s>` | per-snippet timeout (default 30, max 300) |
| `image=<ref>` | sandbox image override |
| `fixture=<path>` | mount a repo file read-only into the sandbox |
| `seed=<n>` | seed passed to the snippet (paired with a runtime shim) |
| `group=<name>` | snippets in a group share one session, in file order |
| `id=<stable-id>` | stable identity for baselines and reporting |
| `setup=<name>` | run a named setup block first (declared in config) |

Inline directives may appear as `// snipci: run` / `# snipci: skip` on the
first lines for languages where fence-meta is awkward (e.g. notebooks).

**Precedence:** inline directive > fence meta > config default. Unknown
directives are hard errors (typo protection — silent ignores are how docs lie).

## 3. Configuration

`.snipci.toml` at repo root:

```toml
[snipci]
version = 1
default = "skip"              # conservative default
paths = ["README.md", "docs/**", "*.md"]
ignore = ["docs/archive/**"]
timeout = 30

[snipci.images]
node   = "ghcr.io/snipci/node:22-bookworm"
python = "ghcr.io/snipci/python:3.12-slim"
bash   = "ghcr.io/snipci/bash:5.2"

[snipci.network]
enabled = false               # global kill switch
allow = ["registry.npmjs.org"] # egress allowlist when enabled

[snipci.setup.docs-env]       # named setup snippets
snippets = ["setup:install"]  # references ids defined in docs

[snipci.baseline]
file = ".snipci-baseline.json" # known failures that don't fail CI
```

## 4. Extraction

Supported sources and their parsers:

| Source | Parser | Notes |
|--------|--------|-------|
| `.md` | mdast (remark) | info string → meta; `title=` extracted for display |
| `.mdx` | remark-mdx | evaluates nothing; treats JSX code fences like md |
| `.rst` | docutils-compatible parser | `.. code-block:: py` + `:snipci:` options |
| `.ipynb` | nbformat | `# snipci:` directives in cell 1; outputs asserted vs `expect` |
| docstrings | tree-sitter | `>>>` doctest blocks + ` ``` ` fences inside docstrings |
| `*.snippet.md` | mdast | include-able blocks referenced from docs (`snipci include`) |

Each extracted snippet becomes:

```ts
type Snippet = {
  id: string;              // stable: hash(path + anchor + content)
  source: { path: string; line: number; fenceLine: number };
  lang: string;            // normalized (ts → typescript, py → python…)
  meta: Meta;              // parsed directives
  content: string;
  group?: string;
};
```

`anchor` prefers the fence's `id=`/`title=`, else the nearest preceding heading
path (`docs/quickstart.md#install`). Stable IDs are what make baselines,
caching, and PR comments coherent across renames.

## 5. Planner

```
1. filter    by paths/ignore config
2. annotate  parse meta; validate; unknown directive → error
3. baseline  mark known-failing snippets (still run, but don't fail CI)
4. diff      in PR mode: git diff to map changed docs → snippets; plus
             snippets whose language image or setup block changed
5. dedupe    identical (lang, content, env, image) snippets run once, results
             fan out to all occurrences
6. expand    groups → ordered session chains; setup blocks prepend
7. plan      ordered DAG with per-snippet cache keys
```

Cache key:

```
sha256(lang, content, normalized meta, image digest, setup ids, snipci major)
```

A cache hit is a guaranteed result replay (reported as `cached`). Content-
addressed local store + CI cache export (`--export-cache` emits a tarball for
`actions/cache`).

## 6. Runners (language adapters)

Each adapter implements:

```ts
interface Adapter {
  prepare(session: Session, image: string): Promise<void>;
  run(session: Session, snippet: Snippet): Promise<Result>;
  teardown(session: Session): Promise<void>;
}
```

| Adapter | Execution model |
|---------|-----------------|
| typescript/javascript | `node --experimental-strip-types` (or tsx) running a generated harness file; supports top-level await |
| python | `python -I -` stdin harness; captures stdout/stderr/exit |
| go | scratch module in tmpdir, `go run` |
| rust | prebuilt base image with cargo; compile+run (long timeout) |
| bash | `bash -euo pipefail` with a controlled PATH |
| sql | optional v2: sqlite/duckdb in-image |

`Result`:

```ts
type Result = {
  status: "pass" | "fail" | "error" | "skipped" | "cached";
  exitCode?: number;
  stdout: string; stderr: string;
  durationMs: number;
  assertion?: { kind: "expect" | "regex" | "exit"; detail: string };
  failure?: { phase: "compile" | "runtime" | "assert" | "sandbox"; message: string };
};
```

**Assertion engine:** normalize line endings, trim trailing whitespace, optional
`trim` mode. Multi-line `expect` compares normalized blocks. Regex uses
Rust/`RE2` semantics (no catastrophic backtracking on untrusted patterns).

**Group sessions** keep one container/process alive across a snippet chain so
docs like "create client → call method → assert" work naturally.

## 7. Isolation & security

- Every snippet runs in a container (Docker/Podman), **network disabled by
  default**, read-only rootfs, tmpfs workdir, `--memory=512m --cpus=1`,
  non-root user, `--pids-limit=64`, seccomp default profile.
- No host env passthrough except an allowlist (`CI`, `LANG=C.UTF-8`).
- Secrets: never injected. Fork PRs run in a reduced profile with no egress.
- `fixture=` mounts repo files read-only; write attempts outside tmpfs fail.
- Egress allowlist is enforced via a proxy sidecar (v1) — declared `network`
  snippets can reach only allowlisted hosts.
- Report output redacts values matching configured secret patterns before
  rendering PR comments.

This is the security posture of a CI system, because *it is one*: you are
running arbitrary code from docs, possibly authored by PR contributors.

## 8. Reporting

**Terminal** (default):

```
docs/quickstart.md      3 snippets   ✅ 1.2s   (1 cached)
docs/migration.md      11 snippets   ❌ 1      line 44
README.md               6 snippets   ✅ 0.4s
──────────────────────────────────────────────
28 snippets · 27 passing · 1 failing · 4.1s
```

Failure detail prints the snippet, expected vs actual diff, and a `snipci
replay <id>` command that re-runs it locally with the sandbox shell attached.

**Other reporters:** `--json` (full `Result[]`), `--junit` (CI test
reporters), `--markdown` (PR comment body), `--shields <path>` (writes the
JSON consumed by a Shields.io dynamic badge: `docs: passing|failing|N%`).

**PR comment** (GitHub Action) is collapsed by default:

```markdown
### snipci — docs check
27/28 snippets pass.

<details><summary>❌ docs/migration.md:44 — <code>connect()</code> no longer takes <code>retry</code></summary>
…snippet, expected/actual, suggested fix diff…
</details>

badge · run locally: `npx snipci run`
```

## 9. CLI

```
snipci run [paths…]        extract + execute
  --changed-only           only snippets affected by git diff (CI default)
  --all                    force full run
  --format terminal|json|junit|markdown
  --baseline               consult .snipci-baseline.json
  --update-baseline        rewrite baseline from current results
  --export-cache <tar> / --import-cache <tar>
  --jobs <n>
snipci list                show discovered snippets + their directives
snipci explain <id>        why a snippet is skipped / its cache key
snipci replay <id>         re-run one snippet interactively in its sandbox
snipci suggest [paths…]    propose annotations + fixes for failing snippets
                           (opt-in LLM step; never auto-applies)
snipci init                write .snipci.toml + Action workflow + badge
snipci check               CI gate: exit 1 on failures not in baseline
```

Exit codes: `0` all pass · `1` failures · `2` usage/config error · `3` internal
(partial results still printed).

## 10. GitHub Action

```yaml
- uses: snipci/action@v1
  with:
    paths: "README.md,docs/**"
    comment: true
    badge: snipci-badge.json
```

Runs `--changed-only` on `pull_request`, full run on `schedule` (nightly).
Writes the badge JSON to `gh-pages` (or an artifact) for the Shields card.

## 11. Test strategy

1. **Self-hosting gate.** snipci's README + docs run under snipci in CI on
   every PR (dogfood or die).
2. **Fixture repos.** `fixtures/` with: a passing repo, a repo with one broken
   snippet per failure mode (compile, runtime, assert, timeout, sandbox),
   a network-needing repo (must be skipped), a group/session repo.
3. **Golden reports.** Terminal/JSON/markdown outputs snapshot-tested.
4. **Cache correctness.** Warm run must be byte-identical in results and
   >10× faster; any meta change must invalidate.
5. **Adversarial security tests.** Snippets attempting host FS access, network,
   env exfiltration, and fork-PR secret access must fail closed.
6. **Parser corpus.** Markdown/MDX/RST/ipynb files from real-world docs sites;
   extraction counts asserted.

## 12. Performance budgets

| Scenario | Budget |
|----------|--------|
| Extract 1,000 snippets | < 300 ms |
| PR run (5 changed snippets) | < 15 s including sandbox spin-up |
| Full run, 200 snippets, cache-cold | < 90 s with 4 parallel sandboxes |
| Warm full run | < 5 s (all cached) |

Sandbox pooling (keep N warm containers per image) is the main lever for PR
latency; it's a v1 item.

## 13. Failure modes

| Failure | Behavior |
|---------|----------|
| Sandbox unavailable (no docker) | error with instructions; never silently run on host |
| Snippet exceeds timeout | kill process group; report `error` with partial output |
| Flaky snippet (passes on rerun) | report `flaky` flag; advise `seed=`/fixture; not auto-retried into green |
| Malformed directive | hard error naming file:line (typos must not silently skip) |
| Non-UTF8 / weird line endings | normalize; note in report |
| Huge output | capture truncated at 64 KB with a marker |

## 14. v1 → v2 cut line

v1 ships when: md+mdx+rst+ipynb extraction, node/python/bash adapters, container
isolation, cache, Action + badge, baseline mode, self-hosting gate green.

v2: docstring extraction, go/rust adapters, egress proxy, `suggest` auto-fix
PRs, docs-site plugin, `docs:` score leaderboard, remote cache service.
