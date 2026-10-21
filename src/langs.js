// Language normalization: fence aliases → canonical adapter names.

const LANG_ALIASES = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  py: 'python',
  python: 'python',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
};

export function normalizeLang(raw) {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase();
  return LANG_ALIASES[key] ?? key;
}
