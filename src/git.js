// `--changed-only`: map a PR/working-tree diff to docs via
// `git diff --name-only`. Any git failure (not a repo, no git binary, no
// HEAD yet) falls back to a full run with a note — never a silent empty run.

export async function changedFiles({ exec, cwd }) {
  const result = await exec('git', ['diff', '--name-only', 'HEAD'], { cwd });
  if (result.spawnError || result.exitCode !== 0) {
    return { ok: false, reason: describeFailure(result) };
  }
  const files = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: true, files };
}

function describeFailure(result) {
  if (result.spawnError) return 'git not available';
  const stderr = (result.stderr || '').toLowerCase();
  if (stderr.includes('not a git repository')) return 'not a git repository';
  if (stderr.includes('does not have any commits') || stderr.includes('unknown revision')) {
    return 'no commits yet';
  }
  return `git diff failed (exit ${result.exitCode})`;
}
