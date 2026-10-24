// Minimal, dependency-free glob support (only the constructs snipci needs):
// `**` (any number of path segments), `*` (within a segment), `?` (one char).
// Patterns always use `/` separators; paths are normalized before matching.

import path from 'node:path';

function escapeRe(ch) {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

export function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:[^/]*\\/)*'; // `**/` matches zero or more segments
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`);
}

const regexCache = new Map();
export function matchGlob(pattern, relPath) {
  let re = regexCache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    regexCache.set(pattern, re);
  }
  return re.test(String(relPath).replace(/\\/g, '/'));
}

export function hasMagic(pattern) {
  return /[*?]/.test(String(pattern));
}

export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

// Recursively collect files under `root`, pruning ignored directories so we
// never descend into node_modules/.git/etc.
function walk(root, ignore, fs) {
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules']);

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, abs));
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (ignore.some((ig) => matchGlob(ig, rel) || matchGlob(ig, `${rel}/`))) continue;
        visit(abs);
      } else if (entry.isFile()) {
        out.push({ abs, rel });
      }
    }
  }

  visit(root);
  return out;
}

/**
 * Expand a list of path patterns (CLI args or config `paths`) into an
 * absolute, de-duplicated, sorted file list.
 * - Non-magic entries may be files or directories (directories expand to
 *   every .md file underneath them).
 * - `ignore` globs filter out matches (applied for config paths; callers may
 *   pass `applyIgnore:false` when the user named the file explicitly).
 */
export function expandFiles({ root, patterns, ignore = [], applyIgnore = true, fs, filter = () => true }) {
  const results = new Set();
  const ignoreList = applyIgnore ? ignore : [];
  let needsWalk = false;

  for (const pattern of patterns) {
    if (hasMagic(pattern)) {
      needsWalk = true;
      continue;
    }
    const abs = path.resolve(root, pattern);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      needsWalk = true;
      continue; // handled by the walk below; dir patterns expand to **/*.md
    }
    const rel = toPosix(path.relative(root, abs));
    if (ignoreList.some((ig) => matchGlob(ig, rel))) continue;
    if (filter(abs)) results.add(abs);
  }

  if (needsWalk) {
    const magicPatterns = patterns.filter((p) => hasMagic(p));
    const dirOnly = [];
    const outOfRootDirs = [];
    for (const p of patterns) {
      if (hasMagic(p)) continue;
      const abs = path.resolve(root, p);
      let isDir = false;
      try {
        isDir = fs.statSync(abs).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      // Build the pattern from the ROOT-RELATIVE posix path: raw `p` may be
      // `.\docs`, `docs/`, or absolute — none of which ever match the
      // walk()'s rel paths, silently producing zero files.
      const relDir = toPosix(path.relative(root, abs));
      const outside = relDir === '..' || relDir.startsWith('../') || path.isAbsolute(relDir);
      if (outside) outOfRootDirs.push(abs);
      else dirOnly.push(relDir ? `${relDir}/**/*.md` : '**/*.md');
    }
    const effective = [...magicPatterns, ...dirOnly];
    if (effective.length) {
      for (const { abs, rel } of walk(root, ignoreList, fs)) {
        if (!filter(abs)) continue;
        if (ignoreList.some((ig) => matchGlob(ig, rel))) continue;
        if (effective.some((p) => matchGlob(p, rel))) results.add(abs);
      }
    }
    // Explicit OUT-OF-ROOT directories: the root walk can't see them, so
    // walk each dir directly (root-relative ignore globs don't apply
    // outside the root — same rule as explicitly named files).
    for (const dir of outOfRootDirs) {
      for (const { abs } of walk(dir, [], fs)) {
        if (filter(abs)) results.add(abs);
      }
    }
  }

  return [...results].sort();
}
