'use client';

/**
 * What the grading actually said — sitewide first, then page by page.
 *
 * The per-page half reports on whatever is ticked in the grader below: that
 * selection is already the user's statement of "these are the pages I care
 * about", so asking them to pick a second time in a second place would be
 * asking the same question twice.
 */

import { ScoreDial } from '../ui.tsx';
import { MeterBar } from '../panel.tsx';
import type { GradeRow } from './grader.tsx';

const band = (n: number) =>
  n >= 75 ? 'rgb(var(--opportunity))' : n >= 50 ? 'rgb(var(--warning))' : 'rgb(var(--blocker))';

const shortUrl = (u: string, max = 60) => {
  try { const x = new URL(u); const s = x.pathname + x.search; return (s === '/' ? x.hostname : s).slice(0, max); }
  catch { return u.slice(0, max); }
};

export function GradeSummary({
  host, grades, selected,
}: {
  host: string;
  /** Every grade stored for this audit, worst first. */
  grades: GradeRow[];
  /** URLs ticked in the grader in card 03. */
  selected: Set<string>;
}) {
  if (grades.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        Nothing graded yet. Grade a page or two below and the sitewide picture appears here, with a
        breakdown for whichever pages you have ticked.
      </p>
    );
  }

  const avg = Math.round(grades.reduce((s, g) => s + g.overall, 0) / grades.length);
  const dim = (pick: (g: GradeRow) => number) =>
    Math.round(grades.reduce((s, g) => s + pick(g), 0) / grades.length);
  const weakest = grades[0]!; // stored worst-first

  // Only pages that are both ticked and graded — a ticked page nobody has spent
  // a call on has nothing to report.
  const picked = grades.filter((g) => selected.has(g.url));

  return (
    <div className="flex flex-col gap-5">
      {/* ---- sitewide ---- */}
      <div className="flex flex-col gap-8 border border-line bg-ground p-6 lg:flex-row lg:items-center">
        <div className="flex items-center gap-5">
          <ScoreDial score={avg} />
          <div className="lg:hidden">
            <div className="text-[15px] font-medium text-ink">{host}</div>
            <div className="text-[12.5px] text-muted">Average quality</div>
          </div>
        </div>
        <div className="flex-1">
          <div className="hidden lg:block">
            <h3 className="text-[15px] font-medium text-ink">Average quality · {host}</h3>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Across {grades.length} graded {grades.length === 1 ? 'page' : 'pages'}.
            </p>
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <MeterBar label="Depth" got={dim((g) => g.depth)} max={100} />
            <MeterBar label="Originality" got={dim((g) => g.originality)} max={100} />
            <MeterBar label="Expertise" got={dim((g) => g.trust)} max={100} />
            <MeterBar label="Relevance" got={dim((g) => g.relevance)} max={100} />
            <MeterBar label="Readability" got={dim((g) => g.readability)} max={100} />
            <MeterBar label="Structure" got={dim((g) => g.structure)} max={100} />
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
            <span className="text-ink">Weakest page ({weakest.overall}/100):</span>{' '}
            {shortUrl(weakest.url)} — {weakest.verdict}
          </p>
        </div>
      </div>

      {/* ---- per page ---- */}
      <div>
        <h3 className="text-[13.5px] font-medium text-ink">
          {picked.length > 0
            ? `The ${picked.length} page${picked.length === 1 ? '' : 's'} you selected`
            : 'Page by page'}
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          {picked.length > 0
            ? 'Tick different pages in the grader below to change what is reported here.'
            : 'Tick pages in the grader below to see each one written up here.'}
        </p>

        {picked.length > 0 && (
          <div className="mt-3 flex flex-col gap-3">
            {picked.map((g) => <PageSummary key={g.url} grade={g} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PageSummary({ grade: g }: { grade: GradeRow }) {
  return (
    <article className="border border-line bg-ground p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h4 className="text-[13.5px] font-medium text-ink">{shortUrl(g.url)}</h4>
        <span className="tnum text-[18px] font-medium" style={{ color: band(g.overall) }}>
          {g.overall}
          <span className="text-[12px] text-muted">/100</span>
        </span>
      </header>

      <p className="mt-1.5 max-w-[86ch] text-[13px] leading-relaxed text-muted">{g.verdict}</p>

      <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
        <MeterBar label="Depth" got={g.depth} max={100} />
        <MeterBar label="Originality" got={g.originality} max={100} />
        <MeterBar label="Expertise" got={g.trust} max={100} />
        <MeterBar label="Relevance" got={g.relevance} max={100} />
        <MeterBar label="Readability" got={g.readability} max={100} />
        <MeterBar label="Structure" got={g.structure} max={100} />
      </div>

      {g.localFit.length > 0 && (
        <div className="mt-4">
          <h5 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">By place</h5>
          <ul className="mt-2 flex flex-col gap-1.5">
            {g.localFit.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="tnum text-[13px] font-medium" style={{ color: band(f.score) }}>{f.score}</span>
                <span className="text-[13px] text-ink">{f.location}</span>
                <span className="text-[12px] text-muted">{f.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {g.fixes.length > 0 && (
        <div className="mt-4">
          <h5 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">What to change</h5>
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

      <p className="mt-4 text-[11px] text-muted">
        Graded {new Date(g.gradedAt).toLocaleString()} · {g.words} words read
        {g.locations.length > 0 && ` · for ${g.locations.join(', ')}`}
      </p>
    </article>
  );
}
