// Snippet model: one extracted code block with stable identity.

import { extractFenceMeta } from './directives.js';
import { snippetId } from './hash.js';

/**
 * Build a snippet from a parsed fence.
 * id = explicit `id=` directive, else hash(path + nearest-heading anchor +
 * content) — stable across runs and renames of surrounding prose.
 */
export function buildSnippet(fence, { file, repoPath } = {}) {
  const { meta, lang, rawLang, anchor, attrs } = extractFenceMeta(fence, { file });
  const id = meta.id ? `snip-custom-${meta.id}` : snippetId({ path: repoPath ?? file, anchor, content: fence.content });

  return {
    id,
    customId: meta.id ?? null,
    path: repoPath ?? file,
    lang,
    rawLang,
    anchor,
    meta,
    content: fence.content,
    fenceLine: fence.fenceLine,
    line: fence.startLine,
    endLine: fence.endLine,
    attrs,
  };
}
