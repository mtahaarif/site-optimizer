import { connection } from 'next/server';
import Link from 'next/link';
import { keywordsWithRanks, allUsage } from '@/src/ranks/track.ts';
import { allLocationLabels } from '@/src/core/locations/store.ts';
import { configuredProviders } from '@/src/ranks/providers.ts';
import { Stat, Bar } from '../ui.tsx';
import { RankCheckForm } from './check-form.tsx';
import { RefreshTracked } from './refresh-tracked.tsx';
import { pageMeta } from '../meta.ts';
import { PageNotes } from '../page-notes.tsx';

// Reads live data from Postgres, so there is no static shell to prerender.
export const instant = false;

export const metadata = pageMeta({
  title: 'Track your search rankings',
  description: 'See where your website shows up in search for any phrase, in any city, on computer or phone — and watch how your position changes over time.',
  path: '/ranks',
});

const ENGINE_LABEL: Record<string, string> = {
  google: 'Google', bing: 'Bing', yahoo: 'Yahoo', yandex: 'Yandex',
};

function Movement({ pos, prev }: { pos: number | null; prev: number | null }) {
  if (pos === null) {
    return <span className="text-muted">{prev === null ? '—' : 'dropped out'}</span>;
  }
  if (prev === null) {
    return <span className="text-accent">new</span>;
  }
  if (pos === prev) return <span className="text-muted">—</span>;
  const better = pos < prev;
  return (
    <span className={better ? 'text-accent' : 'text-blocker'}>
      {better ? '▲' : '▼'} {Math.abs(prev - pos)}
    </span>
  );
}

export default async function RanksPage() {
  await connection();

  const rows = await keywordsWithRanks();
  const providers = configuredProviders();
  const usage = await allUsage();
  const savedLocations = await allLocationLabels();

  const ranked = rows.filter((r) => r.position !== null);
  const top10 = ranked.filter((r) => (r.position ?? 999) <= 10).length;
  const avg = ranked.length
    ? Math.round(ranked.reduce((s, r) => s + (r.position ?? 0), 0) / ranked.length)
    : 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">Search rankings</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          See where your website shows up in search — on Google, Bing, Yahoo and Yandex, for any
          phrase, in any city, on computer or phone. Save the phrases that matter and watch how
          your position changes over time.
        </p>
        <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          {savedLocations.length > 0
            ? <>The {savedLocations.length} {savedLocations.length === 1 ? 'location you have' : 'locations you have'} saved
              are one click away below. When a city ranks badly, go and{' '}
              <Link href="/content" className="text-accent hover:underline">fix the pages for it</Link>.</>
            : <>Targeting several places? <Link href="/content" className="text-accent hover:underline">Add
              your locations</Link> once and they show up here as well as on the content page.</>}
        </p>
      </div>

      <RankCheckForm savedLocations={savedLocations} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Saved phrases" value={rows.length} />
        <Stat label="Found in search" value={ranked.length} />
        <Stat label="On page 1" value={top10} tone="rgb(var(--accent))" />
        <Stat label="Average spot" value={avg || '—'} />
      </div>

      <section>
        <h2 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Checks used this month
        </h2>
        {providers.length === 0 ? (
          <div className="rounded border border-warning bg-surface p-4">
            <p className="text-[13px] text-ink">Ranking checks aren&rsquo;t switched on yet.</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              To enable them, add one of these keys to <code className="font-mono">.env.local</code>.
              Each has a free allowance of around 100 checks per month.
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-ground p-3 font-mono text-[11.5px] text-ink">
SERPAPI_KEY=...            # serpapi.com — supports all four engines
VALUESERP_KEY=...          # valueserp.com — Google, Bing, Yahoo
DATAFORSEO_LOGIN=...       # dataforseo.com — Google, Bing, Yahoo
DATAFORSEO_PASSWORD=...</pre>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {usage.map((u) => (
              <div key={u.provider} className="rounded border border-line bg-surface px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12.5px] text-ink">Ranking checks</span>
                  <span className="tnum font-mono text-[11.5px] text-muted">
                    {u.used} of {u.limit} used this month
                  </span>
                </div>
                <div className="mt-2">
                  <Bar
                    value={u.used}
                    max={u.limit}
                    color={u.remaining === 0 ? 'rgb(var(--blocker))'
                      : u.remaining < u.limit * 0.2 ? 'rgb(var(--warning))' : 'rgb(var(--accent))'}
                  />
                </div>
                {u.remaining === 0 && (
                  <p className="mt-2 text-[11.5px] text-blocker">
                    You&rsquo;ve used all your checks for this month. They&rsquo;ll reset at the start of next month.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-line pb-2">
          <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
            Phrases you&rsquo;re watching
          </h2>
          {rows.length > 0 && <RefreshTracked />}
        </div>

        {rows.length === 0 ? (
          <div className="rounded border border-line bg-surface p-5">
            <p className="text-[13.5px] text-muted">
              You aren&rsquo;t watching any phrases yet. Run a check above and tick
              <span className="text-ink"> &ldquo;Keep watching this over time&rdquo;</span> — the phrase will
              show up here, and you can update its position any time.
            </p>
          </div>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[860px] border-collapse font-mono text-[12px]">
              <caption className="sr-only">Tracked keywords with current position, movement and ranking URL</caption>
              <thead>
                <tr className="border-b border-line text-left text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                  <th className="pb-2 pr-3 text-right">Pos</th>
                  <th className="pb-2 pr-3">Change</th>
                  <th className="pb-2 pr-3">Keyword</th>
                  <th className="pb-2 pr-3">Engine</th>
                  <th className="pb-2 pr-3">Device</th>
                  <th className="pb-2 pr-3">Location</th>
                  <th className="pb-2 pr-3">Ranking URL</th>
                  <th className="pb-2 text-right">Checked</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/50 hover:bg-surface">
                    <td className={'py-1.5 pr-3 text-right font-bold '
                      + (r.position === null ? 'text-muted'
                        : r.position <= 10 ? 'text-accent'
                          : r.position <= 30 ? 'text-warning' : 'text-ink')}>
                      {r.position ?? '—'}
                    </td>
                    <td className="py-1.5 pr-3"><Movement pos={r.position} prev={r.previous_position} /></td>
                    <td className="py-1.5 pr-3 text-ink">{r.phrase}</td>
                    <td className="py-1.5 pr-3 text-muted">{ENGINE_LABEL[r.engine] ?? r.engine}</td>
                    <td className="py-1.5 pr-3 text-muted">{r.device}</td>
                    <td className="max-w-[180px] truncate py-1.5 pr-3 text-muted">
                      {r.city ?? r.country ?? '—'}
                    </td>
                    <td className="max-w-[200px] truncate py-1.5 pr-3 text-muted">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                          {r.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="py-1.5 text-right text-muted">
                      {r.checked_at ? new Date(r.checked_at).toLocaleDateString() : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PageNotes
        title="How rank tracking works"
        intro={<>A position is not one number. The same phrase returns different results depending on which
          engine answers it, which city it is asked from and whether the asker is on a phone &mdash; so every check
          here records all three alongside the position, and a saved phrase is re-checked on the same settings
          each time.</>}
        items={[
          { term: 'Engines', body: <>Google, Bing, Yahoo and Yandex. They disagree more than most people expect,
            and a phrase you have given up on in one is often reachable in another. Yandex needs a provider that
            supports it; the others work with any of the three.</> },
          { term: 'Cities', body: <>Local intent changes the result set completely. The places you save here are
            the same list the content pages check your pages against, so a phrase you track in a city and a page
            that never names that city are visibly the same problem.</> },
          { term: 'Device', body: <>Mobile and desktop results diverge, and mobile is the one that is indexed.
            Tracking only desktop is the most common way to be pleasantly surprised by a position you do not
            actually hold.</> },
          { term: 'Movement', body: <>The arrow compares this check with the previous one for the same phrase,
            engine, city and device. A phrase that drops out entirely is shown as such rather than as a missing
            row, because disappearing is the result.</> },
          { term: 'Your search budget', body: <>Every provider bills per search, and free tiers are small. Checks
            are counted against a monthly ceiling per provider and stop rather than overrun it, so a scheduled
            run cannot quietly exhaust the allowance you were saving.</> },
          { term: 'Which URL ranked', body: <>Recorded alongside the position, because the interesting failure
            is not being ranked low &mdash; it is the wrong page of yours ranking for a phrase. That is a signal
            two pages are competing, and the fix is consolidation rather than more optimisation.</> },
          { term: 'What a position does not tell you', body: <>Rank is one input to traffic and rarely the
            binding one. Ads, an answer box, a map pack and image results all sit above the first organic
            result, so position three on a crowded page can sit below the fold entirely.</> },
          { term: 'Choosing phrases', body: <>Track what a customer would type, not what you would. Phrases that
            describe your product category are usually contested by everyone in it, while the specific question
            your product answers is both easier to win and far more likely to convert.</> },
          { term: 'How often to check', body: <>Weekly is enough for almost every phrase. Results fluctuate
            day to day for reasons that have nothing to do with your site &mdash; personalisation, testing,
            ordinary index churn &mdash; so daily checks mostly buy noise, at full price. Check daily only around a
            migration or a large content change, when you genuinely need to see the shape of a recovery rather
            than its endpoint.</> },
        ]}
        footnote={<>Saved phrases are re-checked on a schedule; a one-off check does not add to the list. Track
          the phrases you would actually change the site for &mdash; each one costs a search every time it runs.</>}
      />
    </div>
  );
}
