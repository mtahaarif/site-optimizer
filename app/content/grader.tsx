'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocationFilter, type LocationRow } from './places.tsx';

export interface PageRow {
  url: string;
  title: string | null;
  words: number;
  pageRank: number;
  hasSnapshot: boolean;
}

export interface LocalFitRow {
  location: string;
  score: number;
  note: string;
}

export interface GradeRow {
  url: string;
  overall: number; depth: number; relevance: number; readability: number;
  originality: number; trust: number; structure: number;
  verdict: string; intent: string;
  strengths: string[];
  fixes: { fix: string; why: string }[];
  gradedAt: number;
  words: number;
  /** The places this grade was made against; empty for a plain quality grade. */
  locations: string[];
  localFit: LocalFitRow[];
}

const band = (n: number) =>
  n >= 75 ? 'rgb(var(--opportunity))' : n >= 50 ? 'rgb(var(--warning))' : 'rgb(var(--blocker))';

// Same thresholds as `band`, as utility classes. Only the meter's width is a
// computed value that has to travel in a style attribute; its colour, and every
// score in the tables, is one of three fixed choices and belongs in the
// stylesheet where the browser can share the rule.
const bandText = (n: number) =>
  n >= 75 ? 'text-opportunity' : n >= 50 ? 'text-warning' : 'text-blocker';

const bandFill = (n: number) =>
  n >= 75 ? 'bg-opportunity' : n >= 50 ? 'bg-warning' : 'bg-blocker';

const shortUrl = (u: string, max = 46) => {
  try { const x = new URL(u); const s = x.pathname + x.search; return (s === '/' ? x.hostname : s).slice(0, max); }
  catch { return u.slice(0, max); }
};

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] text-muted">{label}</span>
        <span className={'tnum text-[12px] font-medium ' + bandText(value)}>{value}</span>
      </div>
      <div className="mt-1 h-[5px] bg-surface-2">
        <div className={'h-full ' + bandFill(value)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function ContentGrader({
  crawlId, siteId, pages, grades, configured,
  locations, pickedLocations, onToggleLocation, onAllLocations, onNoLocations,
  selected, onSelectedChange,
}: {
  crawlId: string;
  siteId: number;
  pages: PageRow[];
  grades: Record<string, GradeRow>;
  configured: boolean;
  locations: LocationRow[];
  pickedLocations: Set<number>;
  onToggleLocation: (id: number) => void;
  onAllLocations: () => void;
  onNoLocations: () => void;
  /** Lifted, because the summary in card 01 reports on whatever is ticked here. */
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const toggle = (url: string) => {
    const next = new Set(selected);
    if (next.has(url)) next.delete(url); else next.add(url);
    onSelectedChange(next);
  };

  const pickedLabels = locations.filter((l) => pickedLocations.has(l.id)).map((l) => l.label);

  // A grade made against a different set of places is not the grade being asked
  // for, so it counts as ungraded rather than quietly standing in for one.
  const matchesPicked = (g: GradeRow | undefined): boolean => {
    if (!g) return false;
    if (g.locations.length !== pickedLabels.length) return false;
    const have = [...g.locations].sort();
    const want = [...pickedLabels].sort();
    return have.every((v, i) => v === want[i]);
  };
  const ungraded = pages.filter((p) => p.hasSnapshot && !matchesPicked(grades[p.url]));

  async function grade(urls: string[], force = false) {
    if (urls.length === 0) return;
    setBusy(true); setErrors([]); setProgress(`Reading ${urls.length} page${urls.length > 1 ? 's' : ''}…`);
    try {
      const res = await fetch('/api/content-grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          crawlId, urls, force, siteId, locationIds: [...pickedLocations],
        }),
      });
      const data = await res.json() as { results?: { url: string; ok: boolean; error?: string }[]; error?: string };
      if (!res.ok) { setErrors([data.error ?? 'Grading failed.']); setBusy(false); setProgress(null); return; }
      const failed = (data.results ?? []).filter((r) => !r.ok);
      setErrors(failed.map((f) => `${shortUrl(f.url)} — ${f.error}`));
      router.refresh();
    } catch {
      setErrors(['Could not reach the grader. Please try again.']);
    }
    setBusy(false); setProgress(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <LocationFilter
        locations={locations}
        picked={pickedLocations}
        onToggle={onToggleLocation}
        onAll={onAllLocations}
        onNone={onNoLocations}
        label="Grade against these places"
        hint={pickedLabels.length === 0
          ? 'None ticked — pages are graded on writing quality alone.'
          : `Each page is also judged on how well it serves ${pickedLabels.join(', ')}. `
            + 'Ticking a different set makes a page count as ungraded again, because the '
            + 'stored answer was to a different question.'}
      />

      <div className="flex flex-wrap items-center gap-2 border border-line bg-surface p-4">
        <button
          onClick={() => grade([...selected])}
          disabled={busy || !configured || selected.size === 0}
          className="border border-ink bg-ink px-5 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-40">
          {busy ? 'Grading…' : `Grade ${selected.size || ''} selected`.trim()}
        </button>
        <button
          onClick={() => grade(ungraded.slice(0, 10).map((p) => p.url))}
          disabled={busy || !configured || ungraded.length === 0}
          className="border border-line px-4 py-2 text-[13px] text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40">
          Grade next {Math.min(10, ungraded.length)} ungraded
        </button>
        <button
          onClick={() => onSelectedChange(new Set(pages.filter((p) => p.hasSnapshot).map((p) => p.url)))}
          disabled={busy}
          className="border border-line px-3 py-2 text-[12.5px] text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40">
          Select all
        </button>
        <button
          onClick={() => onSelectedChange(new Set())}
          disabled={busy || selected.size === 0}
          className="border border-line px-3 py-2 text-[12.5px] text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40">
          Clear
        </button>
        {progress && <span className="text-[12.5px] text-muted">{progress} this can take a moment per page.</span>}
        {!progress && <span className="text-[12px] text-muted">Each page is one AI call — up to 10 at a time.</span>}
      </div>

      {errors.length > 0 && (
        <div className="border border-warning bg-surface p-4">
          {errors.map((e, i) => <p key={i} className="text-[12.5px] leading-relaxed text-warning">{e}</p>)}
        </div>
      )}

      <div className="scroll-x border border-line bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <caption className="sr-only">Pages available to grade, with word count and content quality score</caption>
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-muted">Page</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-muted">Words</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-muted">Quality</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-muted">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p, idx) => {
              const g = grades[p.url];
              const isOpen = open === p.url;
              return (
                <Fragment key={p.url + idx}>
                  <tr className="border-b border-line/60 hover:bg-surface-2">
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(p.url)} disabled={!p.hasSnapshot || busy}
                        onChange={() => toggle(p.url)} aria-label={`Select ${p.url}`} />
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => setOpen(isOpen ? null : p.url)} disabled={!g}
                        className={'text-left ' + (g ? 'text-ink hover:text-accent' : 'text-muted')}>
                        {shortUrl(p.url)}
                      </button>
                      {!p.hasSnapshot && <span className="ml-2 text-[11px] text-muted">no saved copy</span>}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-muted">{p.words}</td>
                    <td className="tnum px-3 py-2.5 text-right">
                      {g ? <span className={'font-medium ' + bandText(g.overall)}>{g.overall}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="max-w-[380px] px-3 py-2.5 text-muted">
                      {g ? <span className="line-clamp-1">{g.verdict}</span> : <span className="text-muted">not graded yet</span>}
                    </td>
                  </tr>
                  {isOpen && g && (
                    <tr className="border-b border-line bg-surface-2/40">
                      <td colSpan={5} className="px-5 py-5">
                        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                          <div className="flex flex-col gap-2.5">
                            <Bar label="Depth" value={g.depth} />
                            <Bar label="Relevance" value={g.relevance} />
                            <Bar label="Originality" value={g.originality} />
                            <Bar label="Expertise" value={g.trust} />
                            <Bar label="Readability" value={g.readability} />
                            <Bar label="Structure" value={g.structure} />
                          </div>
                          <div className="flex flex-col gap-4">
                            {g.intent && (
                              <p className="text-[13px] text-muted">
                                <span className="text-ink">Reads as:</span> {g.intent}
                              </p>
                            )}
                            {g.localFit.length > 0 && (
                              <div>
                                <h4 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                                  How well it serves each place
                                </h4>
                                <ul className="mt-2 flex flex-col gap-1.5">
                                  {g.localFit.map((f, i) => (
                                    <li key={i} className="flex flex-wrap items-baseline gap-2">
                                      <span className={'tnum text-[13px] font-medium ' + bandText(f.score)}>
                                        {f.score}
                                      </span>
                                      <span className="text-[13px] text-ink">{f.location}</span>
                                      <span className="text-[12px] text-muted">{f.note}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {g.strengths.length > 0 && (
                              <div>
                                <h4 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">What works</h4>
                                <ul className="mt-2 flex flex-col gap-1">
                                  {g.strengths.map((s, i) => (
                                    <li key={i} className="border-l-2 border-opportunity pl-2.5 text-[13px] text-ink">{s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {g.fixes.length > 0 && (
                              <div>
                                <h4 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">What to change</h4>
                                <ol className="mt-2 flex flex-col gap-2">
                                  {g.fixes.map((f, i) => (
                                    <li key={i} className="border-l-2 border-warning pl-2.5">
                                      <div className="text-[13px] text-ink">{f.fix}</div>
                                      <div className="text-[12px] text-muted">{f.why}</div>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-3">
                              <button onClick={() => grade([p.url], true)} disabled={busy}
                                className="border border-line px-3 py-1.5 text-[12px] text-muted hover:border-ink hover:text-ink disabled:opacity-40">
                                Re-grade this page
                              </button>
                              <span className="text-[11px] text-muted">
                                Graded {new Date(g.gradedAt).toLocaleString()} · {g.words} words read
                                {g.locations.length > 0 && ` · for ${g.locations.join(', ')}`}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
