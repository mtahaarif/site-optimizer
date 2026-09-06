'use client';

/**
 * Location content optimisation.
 *
 * The point of the matrix is triage. Pages down the side, places across the
 * top, and one number per cell saying how well that page already reads as
 * serving that place. That pass is free, so you can run it over everything and
 * then spend model calls only on the cells that came back weak.
 *
 * Two ways to act on a cell, deliberately equal: send it to the configured AI
 * key, or copy the exact same prompt and run it wherever you like.
 */

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { shortUrl } from '../ui.tsx';
import { LocationFilter, type LocationRow } from './places.tsx';

export type { LocationRow };

export interface CellRow {
  locationId: number;
  url: string;
  coverage: number;
  signals: {
    inTitle: boolean; inDescription: boolean; inH1: boolean; inHeadings: boolean;
    inBody: number; inUrl: boolean; hasLocalSchema: boolean; hasAddress: boolean;
  };
  verdict: string | null;
  recommendations: Array<{ change: string; why: string }>;
  draft: {
    title: string; description: string; h1: string; intro: string;
    sections: Array<{ heading: string; body: string }>;
    faqs: Array<{ question: string; answer: string }>;
    rationale: string;
  } | null;
  analysedAt: number | null;
  generatedAt: number | null;
}

export interface OptimiserPage {
  url: string;
  title: string | null;
  hasSnapshot: boolean;
}

interface Result {
  url: string; locationId: number; locationLabel: string;
  coverage: number; ok: boolean; error?: string; prompt?: string; verdict?: string;
}

const key = (url: string, locationId: number) => `${locationId}::${url}`;

/** Coverage is presence, not quality — the palette says "weak/partial/strong", nothing more. */
const bandText = (n: number) =>
  n >= 70 ? 'text-opportunity' : n >= 35 ? 'text-warning' : 'text-blocker';

export function LocationOptimiser({
  siteId, crawlId, pages, locations, cells: stored, aiConfigured,
  pickedLocs, onToggleLocation, onAllLocations, onNoLocations,
}: {
  siteId: number;
  crawlId: string | null;
  pages: OptimiserPage[];
  locations: LocationRow[];
  cells: CellRow[];
  aiConfigured: boolean;
  /** Owned by the page, so the list of places is added once and shared. */
  pickedLocs: Set<number>;
  onToggleLocation: (id: number) => void;
  onAllLocations: () => void;
  onNoLocations: () => void;
}) {
  const router = useRouter();

  const [pickedPages, setPickedPages] = useState<Set<string>>(new Set());
  const [wantDraft, setWantDraft] = useState(false);
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<Result[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Freshly computed coverage is merged over what the server sent, so the
  // matrix updates the moment a run finishes instead of waiting on a refresh.
  const [fresh, setFresh] = useState<Record<string, number>>({});

  const cells = new Map(stored.map((c) => [key(c.url, c.locationId), c]));
  const coverageOf = (url: string, locId: number): number | null => {
    const k = key(url, locId);
    if (k in fresh) return fresh[k]!;
    return cells.get(k)?.coverage ?? null;
  };

  const shown = locations.filter((l) => pickedLocs.has(l.id));
  const selectedCells = pickedPages.size * pickedLocs.size;

  async function run(mode: 'coverage' | 'prompt' | 'generate') {
    if (!crawlId) { setError('Run an audit first — the page text comes from it.'); return; }
    // The free pass defaults to every page: there is no reason to make someone
    // tick 40 boxes for something that costs nothing.
    const urls = mode === 'coverage' && pickedPages.size === 0
      ? pages.filter((p) => p.hasSnapshot).map((p) => p.url)
      : [...pickedPages];
    if (urls.length === 0) { setError('Pick at least one page.'); return; }
    if (pickedLocs.size === 0) { setError('Pick at least one location.'); return; }

    setBusy(mode); setError(null); setNotes([]); setPrompts(null);
    try {
      const res = await fetch('/api/locations/optimise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteId, crawlId, urls, locationIds: [...pickedLocs], mode, wantDraft,
          businessContext: context.trim() || undefined,
        }),
      });
      const data = await res.json() as { results?: Result[]; error?: string };
      if (!res.ok) { setError(data.error ?? 'That did not work.'); setBusy(null); return; }

      const results = data.results ?? [];
      setFresh((prev) => {
        const next = { ...prev };
        for (const r of results) next[key(r.url, r.locationId)] = r.coverage;
        return next;
      });
      setNotes(results.filter((r) => !r.ok)
        .map((r) => `${shortUrl(r.url, 40)} · ${r.locationLabel} — ${r.error}`));
      if (mode === 'prompt') setPrompts(results.filter((r) => r.prompt));
      if (mode === 'generate') router.refresh();
    } catch { setError('Could not reach the optimiser.'); }
    setBusy(null);
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch { setError('Your browser blocked the copy. Select the text and copy it manually.'); }
  }

  return (
    <div className="flex flex-col gap-5">

      <LocationFilter
        locations={locations}
        picked={pickedLocs}
        onToggle={onToggleLocation}
        onAll={onAllLocations}
        onNone={onNoLocations}
        label="Rewrite for these places"
        hint="One model call per ticked page per ticked place, so this is the dial that decides
          what a run costs. Add or remove places in card 02."
      />

      {locations.length > 0 && (
        <>
          {/* ---- controls ---- */}
          <div className="flex flex-col gap-3 border border-line bg-surface p-5">
            {/* What comes back, chosen before how it is produced — the two
                buttons below differ only in who runs the prompt. */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[12.5px] font-medium text-ink">I want</span>
              <div className="flex flex-wrap gap-2">
                {([
                  { on: false, label: 'Advice on what to change' },
                  { on: true, label: 'A full page written for me' },
                ] as const).map((opt) => (
                  <button
                    key={String(opt.on)}
                    onClick={() => setWantDraft(opt.on)}
                    aria-pressed={wantDraft === opt.on}
                    disabled={busy !== null}
                    className={'border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-40 '
                      + (wantDraft === opt.on
                        ? 'border-ink bg-ink text-ground'
                        : 'border-line text-muted hover:border-ink hover:text-ink')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => void run('generate')}
                disabled={busy !== null || pickedPages.size === 0 || !aiConfigured}
                className="border border-ink bg-ink px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-40">
                {busy === 'generate'
                  ? 'Writing…'
                  : `Generate with AI${selectedCells ? ` (${selectedCells} call${selectedCells === 1 ? '' : 's'})` : ''}`}
              </button>
              <button onClick={() => void run('prompt')} disabled={busy !== null || pickedPages.size === 0}
                className="border border-line px-4 py-2 text-[13px] text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40">
                {busy === 'prompt' ? 'Building…' : 'Give me the prompt instead'}
              </button>
              <button onClick={() => void run('coverage')} disabled={busy !== null}
                className="border border-line px-4 py-2 text-[13px] text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40">
                {busy === 'coverage' ? 'Checking…' : 'Check coverage (free)'}
              </button>
            </div>

            <input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Optional: what the business does, in your words — steers the writing away from guesswork"
              aria-label="About the business"
              className="border border-line bg-ground px-3 py-2 text-[12.5px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
            />

            <p className="text-[11.5px] leading-relaxed text-muted">
              Checking is free and uses no AI — it looks at where each place is actually named on the
              page. Only generating costs a call, one per page per location, so tick the weak cells
              rather than everything.
              {!aiConfigured && ' No AI key is configured, so generating is off — copying the prompts does the same job in your own assistant.'}
            </p>
          </div>

          {error && (
            <div className="border border-blocker bg-surface p-4 text-[12.5px] text-blocker">{error}</div>
          )}
          {notes.length > 0 && (
            <div className="border border-warning bg-surface p-4">
              {notes.map((n, i) => <p key={i} className="text-[12.5px] leading-relaxed text-warning">{n}</p>)}
            </div>
          )}

          {/* ---- the prompts ---- */}
          {prompts && prompts.length > 0 && (
            <div className="border border-line bg-surface">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-3">
                <div>
                  <h3 className="text-[13.5px] font-medium text-ink">
                    {prompts.length} prompt{prompts.length === 1 ? '' : 's'}, ready to paste
                  </h3>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    This is word for word what the AI button would send. Nothing is held back.
                  </p>
                </div>
                <button
                  onClick={() => void copy(prompts.map((p) => p.prompt).join('\n\n────────────────────\n\n'), 'all')}
                  className="border border-line px-3 py-1.5 text-[12px] text-muted hover:border-ink hover:text-ink">
                  {copied === 'all' ? 'Copied' : 'Copy all'}
                </button>
              </div>
              <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto p-5">
                {prompts.map((p) => {
                  const id = key(p.url, p.locationId);
                  return (
                    <div key={id} className="border border-line">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2">
                        <span className="text-[12px] text-ink">
                          {shortUrl(p.url, 44)} <span className="text-muted">·</span> {p.locationLabel}
                        </span>
                        <button onClick={() => void copy(p.prompt ?? '', id)}
                          className="border border-line px-2.5 py-1 text-[11.5px] text-muted hover:border-ink hover:text-ink">
                          {copied === id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-relaxed text-muted">{p.prompt}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---- the matrix ---- */}
          <div className="scroll-x border border-line bg-surface">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <caption className="sr-only">
                How well each page already reads as serving each location, out of 100
              </caption>
              <thead className="border-b border-line bg-surface-2">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted">Page</th>
                  {shown.map((l) => (
                    <th key={l.id} className="px-3 py-2 text-right text-[11px] font-medium text-muted">{l.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const isOpen = open === p.url;
                  return (
                    <Fragment key={p.url}>
                      <tr className="border-b border-line/60 hover:bg-surface-2">
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={pickedPages.has(p.url)}
                            disabled={!p.hasSnapshot || busy !== null}
                            onChange={() => setPickedPages((prev) => {
                              const n = new Set(prev);
                              if (n.has(p.url)) n.delete(p.url); else n.add(p.url);
                              return n;
                            })}
                            aria-label={`Select ${p.url}`} />
                        </td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => setOpen(isOpen ? null : p.url)}
                            className="text-left text-ink hover:text-accent">
                            {shortUrl(p.url, 46)}
                          </button>
                          {!p.hasSnapshot && <span className="ml-2 text-[11px] text-muted">no saved copy</span>}
                        </td>
                        {shown.map((l) => {
                          const c = coverageOf(p.url, l.id);
                          return (
                            <td key={l.id} className="tnum px-3 py-2.5 text-right">
                              {c === null
                                ? <span className="text-muted">—</span>
                                : <span className={'font-medium ' + bandText(c)}>{c}</span>}
                            </td>
                          );
                        })}
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line bg-surface-2/40">
                          <td colSpan={2 + shown.length} className="px-5 py-5">
                            <PageDetail url={p.url} locations={shown} cells={cells} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="max-w-[86ch] text-[12px] leading-relaxed text-muted">
            A high number means the place is <em>named</em> in the right spots — not that the page is
            good. A page scoring 90 for six different cities is a doorway page, which search engines
            treat as spam. Judging that is what the AI pass is for.
          </p>
        </>
      )}
    </div>
  );
}

/** Everything recorded for one page, across the shown locations. */
function PageDetail({
  url, locations, cells,
}: {
  url: string;
  locations: LocationRow[];
  cells: Map<string, CellRow>;
}) {
  const rows = locations
    .map((l) => ({ loc: l, cell: cells.get(key(url, l.id)) }))
    .filter((r): r is { loc: LocationRow; cell: CellRow } => r.cell !== undefined);

  if (rows.length === 0) {
    return <p className="text-[13px] text-muted">Nothing checked for this page yet — run a check above.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {rows.map(({ loc, cell }) => (
        <div key={loc.id} className="border-l-2 border-line pl-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h4 className="text-[13.5px] font-medium text-ink">{loc.label}</h4>
            <span className={'tnum font-mono text-[12px] ' + bandText(cell.coverage)}>
              {cell.coverage}/100
            </span>
          </div>

          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            <Signal on={cell.signals.inTitle} label="title" />
            <Signal on={cell.signals.inH1} label="H1" />
            <Signal on={cell.signals.inDescription} label="description" />
            <Signal on={cell.signals.inHeadings} label="a subheading" />
            <Signal on={cell.signals.inBody > 0} label={`body (${cell.signals.inBody}×)`} />
            <Signal on={cell.signals.inUrl} label="URL" />
            <Signal on={cell.signals.hasLocalSchema} label="local schema" />
            <Signal on={cell.signals.hasAddress} label="address" />
          </ul>

          {cell.verdict && (
            <p className="mt-3 max-w-[86ch] text-[13px] leading-relaxed text-ink">{cell.verdict}</p>
          )}
          {cell.recommendations.length > 0 && (
            <ol className="mt-2 flex flex-col gap-2">
              {cell.recommendations.map((r, i) => (
                <li key={i} className="border-l-2 border-warning pl-2.5">
                  <div className="text-[13px] text-ink">{r.change}</div>
                  <div className="text-[12px] text-muted">{r.why}</div>
                </li>
              ))}
            </ol>
          )}
          {cell.draft && <Draft draft={cell.draft} />}
        </div>
      ))}
    </div>
  );
}

function Signal({ on, label }: { on: boolean; label: string }) {
  return (
    <li className={on ? 'text-opportunity' : 'text-muted'}>
      {on ? '✓' : '·'} {label}
    </li>
  );
}

function Draft({ draft }: { draft: NonNullable<CellRow['draft']> }) {
  const [show, setShow] = useState(false);
  const text = [
    `Title: ${draft.title}`,
    `Description: ${draft.description}`,
    `H1: ${draft.h1}`,
    '',
    draft.intro,
    '',
    ...draft.sections.flatMap((s) => [`## ${s.heading}`, s.body, '']),
    ...(draft.faqs.length
      ? ['## FAQ', ...draft.faqs.flatMap((f) => [`**${f.question}**`, f.answer, ''])]
      : []),
  ].join('\n');

  return (
    <div className="mt-3">
      <button onClick={() => setShow(!show)}
        className="border border-line px-3 py-1.5 text-[12px] text-muted hover:border-ink hover:text-ink">
        {show ? 'Hide the draft' : 'Show the draft'}
      </button>
      {show && (
        <>
          <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words border border-line bg-ground p-4 font-mono text-[11.5px] leading-relaxed text-ink">{text}</pre>
          <p className="mt-2 max-w-[86ch] text-[12px] leading-relaxed text-muted">
            <span className="text-ink">Why it wrote this:</span> {draft.rationale}
          </p>
          <p className="mt-1 max-w-[86ch] text-[12px] leading-relaxed text-muted">
            Anything marked <span className="font-mono">[VERIFY: …]</span> is a fact the model did not
            know and would not invent. Fill those in before publishing.
          </p>
        </>
      )}
    </div>
  );
}
