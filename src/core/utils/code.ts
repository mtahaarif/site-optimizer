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
