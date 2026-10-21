// Hand-rolled Markdown fence parser (no dependencies).
//
// Handles: ``` and ~~~ fences of length >= 3, info strings, nested content
// (inner fences stay content of the outer block), CRLF/CR line endings,
// unclosed fences (run to EOF), and nearest-preceding-heading tracking for
// stable snippet anchors.

export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

const OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/**
 * Parse a Markdown document into top-level fences.
 * Returns { lines, fences } where each fence is:
 *   { path, index, info, content, fenceLine, startLine, endLine, anchor, closed }
 * All line numbers are 1-based; `startLine` is the first content line.
 */
export function parseMarkdown(text, filePath = '<memory>') {
  const lines = String(text).split(/\r\n|\n|\r/);
  const fences = [];
  let heading = null; // slug of the nearest preceding heading (outside fences)
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      heading = slugify(headingMatch[2]);
      i++;
      continue;
    }

    const open = OPEN_RE.exec(line);
    if (open) {
      const marker = open[1];
      const char = marker[0];
      const len = marker.length;
      const rest = open[2];
      // For backtick fences the info string may not contain backticks
      // (otherwise ```inline code``` would open a fence).
      const infoOk = char === '~' ? !rest.includes('~') : !rest.includes('`');
      if (!infoOk) {
        i++;
        continue;
      }

      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const close = CLOSE_RE.exec(lines[j]);
        if (close && close[1][0] === char && close[1].length >= len) {
          closed = true;
          break;
        }
      }

      const contentEnd = closed ? j : lines.length;
      fences.push({
        path: filePath,
        index: fences.length,
        info: rest.trim(),
        content: lines.slice(i + 1, contentEnd).join('\n'),
        fenceLine: i + 1,
        startLine: i + 2,
        endLine: closed ? j + 1 : lines.length,
        anchor: heading,
        closed,
        fenceChar: char,
        fenceLen: len,
      });

      i = closed ? j + 1 : lines.length;
      continue;
    }

    i++;
  }

  return { lines, fences };
}
