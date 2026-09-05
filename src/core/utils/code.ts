/**
 * Byte offset -> line number and surrounding source.
 *
 * Used by "view issue in code": a check reports where in the HTML it found the
 * problem, and this turns that offset into something a human can read.
 */

export interface CodeSnippet {
  /** 1-based line containing the offset */
  lineNumber: number;
  /** 1-based column within that line */
  column: number;
  /** the extracted lines, first to last */
  lines: string[];
  /** 1-based line number of `lines[0]`, for rendering the gutter */
  startLine: number;
  /** index into `lines` of the offending line */
  highlightIndex: number;
  /** the offending line on its own */
  codeSnippet: string;
  /** total lines in the document */
  totalLines: number;
  /**
   * Column range to underline within the highlighted line, when the caller
   * supplied a match length. Both 0-based, end exclusive.
   */
  highlightRange: { start: number; end: number } | null;
}

/** Longest single line we will hand to the UI before truncating. */
const MAX_LINE_CHARS = 400;

/**
 * Extract the line at `offset` plus `contextLines` either side.
 *
 * Offsets are counted in UTF-16 code units — the same units `String.prototype`
 * uses — not bytes. Every producer of an offset in this codebase is a regex or
 * `indexOf` over the same string, so the units agree end to end. Mixing in a
 * true byte offset would silently drift on any page containing non-ASCII.
 */
export function getSnippetFromOffset(
  html: string,
  offset: number,
  contextLines = 5,
  matchLength = 0,
): CodeSnippet {
  const clamped = Math.max(0, Math.min(offset, html.length));

  // Count newlines up to the offset. A single pass with indexOf beats splitting
  // the whole document, which on a 700 KB page allocates an array of thousands
  // of strings just to learn one number.
  let lineNumber = 1;
  let lineStart = 0;
  for (let i = html.indexOf('\n'); i !== -1 && i < clamped; i = html.indexOf('\n', i + 1)) {
    lineNumber++;
    lineStart = i + 1;
  }
  const column = clamped - lineStart + 1;

  const allLines = html.split('\n');
  const totalLines = allLines.length;

  const startLine = Math.max(1, lineNumber - contextLines);
  const endLine = Math.min(totalLines, lineNumber + contextLines);

  const lines = allLines
    .slice(startLine - 1, endLine)
    .map((l) => (l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + ' …' : l));

  const highlightIndex = lineNumber - startLine;

  // A match that runs past the end of its line is clipped rather than dropped:
  // minified HTML routinely puts an entire document on line 1.
  let highlightRange: CodeSnippet['highlightRange'] = null;
  if (matchLength > 0) {
    const lineLength = allLines[lineNumber - 1]?.length ?? 0;
    const start = Math.min(column - 1, lineLength);
    highlightRange = { start, end: Math.min(start + matchLength, lineLength) };
  }

  return {
    lineNumber,
    column,
    lines,
    startLine,
    highlightIndex,
    codeSnippet: lines[highlightIndex] ?? '',
    totalLines,
    highlightRange,
  };
}

/**
 * Whole-document line count, for the UI to show "line 812 of 1,204".
 */
export function countLines(html: string): number {
  let n = 1;
  for (let i = html.indexOf('\n'); i !== -1; i = html.indexOf('\n', i + 1)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Minified documents
// ---------------------------------------------------------------------------

/**
 * Does this document have essentially no line breaks?
 *
 * Production HTML usually does not. Next.js, and every other framework that
 * minifies its output, emits the entire document on one line — so "show me the
 * source around this finding" produced one 400 KB line, truncated to 400
 * characters, with the offending tag somewhere off the right-hand edge.
 *
 * Counted rather than split: splitting a 400 KB string to learn one number
 * allocates thousands of substrings, and the loop exits as soon as the
 * document is dense enough to disprove the question.
 */
export function looksMinified(html: string): boolean {
  if (html.length < 2000) return false;
  const enough = html.length / 200; // roughly one break per 200 chars
  let newlines = 0;
  for (let i = html.indexOf('\n'); i !== -1; i = html.indexOf('\n', i + 1)) {
    if (++newlines > enough) return false;
  }
  return true;
}

/** Elements whose contents are raw text and must not be reformatted. */
const RAW_TEXT = ['script', 'style', 'pre', 'textarea'];

/** Void elements never increase indent depth. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const INDENT = '  ';
const MAX_DEPTH = 12; // stop indenting past this, or deep trees walk off-screen

/**
 * Re-break minified HTML onto one line per tag, and carry an offset with it.
 *
 * Returns the offset's new position so the caller can still point at the exact
 * finding: reformatting the source is only useful if the highlight follows it.
 *
 * Tags are emitted whole, so a match that covers a single tag — which is what
 * every locator produces — stays contiguous on one line and can still be
 * underlined. Script and style bodies are passed through untouched: they are
 * not markup, and breaking a JSON payload on angle brackets would produce
 * nonsense.
 */
export function prettyPrintHtml(html: string, offset: number): { text: string; offset: number } {
  const out: string[] = [];
  let outLen = 0;
  let mapped = -1;
  let depth = 0;
  let i = 0;

  /** Append a segment, mapping `offset` if it falls inside this one. */
  const push = (text: string, origStart: number, origEnd: number): void => {
    if (mapped === -1 && offset >= origStart && offset < origEnd) {
      mapped = outLen + (offset - origStart);
    }
    out.push(text);
    outLen += text.length;
  };

  const newline = (): void => {
    if (outLen === 0) return;
    const pad = '\n' + INDENT.repeat(Math.min(depth, MAX_DEPTH));
    out.push(pad);
    outLen += pad.length;
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);

    // Trailing text after the last tag.
    if (lt === -1) {
      const text = html.slice(i);
      if (text.trim()) { newline(); push(text.trim(), i, html.length); }
      break;
    }

    // Text between tags.
    if (lt > i) {
      const raw = html.slice(i, lt);
      if (raw.trim()) { newline(); push(raw.trim(), i, lt); }
      else if (mapped === -1 && offset >= i && offset < lt) mapped = outLen;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) { newline(); push(html.slice(lt), lt, html.length); break; }

    const tag = html.slice(lt, gt + 1);
    const nameMatch = tag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
    const name = (nameMatch?.[1] ?? '').toLowerCase();
    const isClose = tag.startsWith('</');
    const selfClosing = tag.endsWith('/>') || VOID_TAGS.has(name);

    if (isClose) depth = Math.max(0, depth - 1);
    newline();
    push(tag, lt, gt + 1);
    i = gt + 1;

    // Raw-text elements: copy through to the matching close tag verbatim.
    if (!isClose && !selfClosing && RAW_TEXT.includes(name)) {
      const closeIdx = html.toLowerCase().indexOf('</' + name, i);
      const end = closeIdx === -1 ? html.length : closeIdx;
      if (end > i) push(html.slice(i, end), i, end);
      i = end;
      continue;
    }

    if (!isClose && !selfClosing) depth++;
  }

  return { text: out.join(''), offset: mapped === -1 ? 0 : mapped };
}
