'use client';

import { useEffect, useState } from 'react';
import type { CodeSnippet } from '@/src/core/utils/code.ts';

interface SnapshotResponse {
  url: string;
  rendered: boolean;
  rawBytes: number;
  gzipBytes: number;
  located: boolean;
  reason?: string;
  label?: string;
  offset?: number;
  snippet: CodeSnippet | null;
  error?: string;
}

/**
 * Minimal HTML tokeniser for display.
 *
 * A full syntax-highlighting dependency is not worth ~40 KB to colour tag names
 * and attributes in an eleven-line excerpt, and every token here is escaped as
 * text — nothing from the crawled page is ever interpreted as markup.
 */
function highlight(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Split on tags, keeping the delimiters.
  const parts = line.split(/(<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->|<!doctype[^>]*>)/i);

  parts.forEach((part, i) => {
    if (!part) return;

    if (/^<!--/.test(part)) {
      out.push(<span key={i} className="text-muted italic">{part}</span>);
      return;
    }
    if (!/^<\/?[a-zA-Z]|^<!doctype/i.test(part)) {
      out.push(<span key={i}>{part}</span>);
      return;
    }

    // Inside a tag: name, then attribute name/value pairs.
    const inner: React.ReactNode[] = [];
    const tagRe = /(<\/?)([a-zA-Z][\w:-]*)|([\w:-]+)(=)("[^"]*"|'[^']*')|(\/?>)|(\s+)|([^\s]+)/g;
    let k = 0;
    for (let m = tagRe.exec(part); m; m = tagRe.exec(part)) {
      k++;
      if (m[2]) {
        inner.push(<span key={k}><span className="text-muted">{m[1]}</span><span className="text-accent">{m[2]}</span></span>);
      } else if (m[3]) {
        inner.push(
          <span key={k}>
            <span style={{ color: 'rgb(var(--warning))' }}>{m[3]}</span>
            <span className="text-muted">{m[4]}</span>
            <span style={{ color: 'rgb(var(--opportunity))' }}>{m[5]}</span>
          </span>,
        );
      } else if (m[6]) {
        inner.push(<span key={k} className="text-muted">{m[6]}</span>);
      } else {
        inner.push(<span key={k}>{m[0]}</span>);
      }
    }
    out.push(<span key={i}>{inner}</span>);
  });

  return out;
}

const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';

export function CodeViewer({
  crawlId, url, checkId, onClose,
}: {
  crawlId: string; url: string; checkId: string; onClose: () => void;
}) {
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ url, checkId, context: '6' });
    fetch(`/api/crawl/${crawlId}/snapshot?${params}`)
      .then(async (res) => {
        const body = await res.json() as SnapshotResponse;
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
        else setData(body);
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [crawlId, url, checkId]);

  // Escape closes, matching every other dismissible surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const snippet = data?.snippet;

  return (
    <div className="mt-3 overflow-hidden rounded border border-line bg-ground">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
          Source
        </span>
        <span className="font-mono text-[11px] text-muted">
          {(() => { try { return new URL(url).pathname; } catch { return url; } })()}
        </span>
        {snippet && (
          <span className="tnum font-mono text-[11px] text-ink">
            line {snippet.lineNumber.toLocaleString()}
            <span className="text-muted"> of {snippet.totalLines.toLocaleString()}</span>
          </span>
        )}
        {data?.label && (
          <span className="font-mono text-[11px] text-muted">· matched {data.label}</span>
        )}
        {data && (
          <span className="font-mono text-[10.5px] text-muted">
            · {data.rendered ? 'rendered DOM' : 'server HTML'} {fmtBytes(data.rawBytes)}
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      {loading && (
        <p className="px-3 py-4 font-mono text-[12px] text-muted">Loading source…</p>
      )}

      {error && (
        <p className="px-3 py-4 font-mono text-[12px] text-warning">{error}</p>
      )}

      {!loading && !error && data && !data.located && (
        <p className="px-3 py-4 text-[12.5px] leading-relaxed text-muted">
          {data.reason ?? 'This finding has no identifiable position in the source.'}
        </p>
      )}

      {snippet && (
        <div className="scroll-x">
          <table className="w-full border-collapse font-mono text-[11.5px] leading-[1.7]">
            <tbody>
              {snippet.lines.map((line, i) => {
                const isTarget = i === snippet.highlightIndex;
                const lineNo = snippet.startLine + i;
                return (
                  <tr
                    key={lineNo}
                    style={isTarget
                      ? {
                          background: 'rgb(var(--blocker) / 0.10)',
                          boxShadow: 'inset 3px 0 0 0 rgb(var(--blocker))',
                        }
                      : undefined}
                  >
                    <td
                      className="tnum select-none border-r border-line px-2.5 py-0.5 text-right align-top text-muted"
                      style={isTarget ? { color: 'rgb(var(--blocker))', fontWeight: 700 } : undefined}
                    >
                      {lineNo}
                    </td>
                    <td className="whitespace-pre px-3 py-0.5 align-top text-ink">
                      {line.length === 0 ? ' ' : highlight(line)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
