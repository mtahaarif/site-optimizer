import { connection } from 'next/server';
import { keywordsWithRanks, allUsage } from '@/src/ranks/track.ts';
import { configuredProviders } from '@/src/ranks/providers.ts';
import { Stat, Bar } from '../ui.tsx';
import { RankCheckForm } from './check-form.tsx';
import { RefreshTracked } from './refresh-tracked.tsx';

// Reads live data from SQLite, so there is no static shell to prerender.
export const instant = false;

export const metadata = {
  title: 'Track your search rankings',
  description: 'See where your website shows up in search for any phrase, in any city, on computer or phone — and watch how your position changes over time.',
  alternates: { canonical: '/ranks' },
};

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
    <span style={{ color: better ? 'rgb(var(--accent))' : 'rgb(var(--blocker))' }}>
      {better ? '▲' : '▼'} {Math.abs(prev - pos)}
    </span>
  );
}

export default async function RanksPage() {
  await connection();

  const rows = keywordsWithRanks();
  const providers = configuredProviders();
  const usage = allUsage();

  const ranked = rows.filter((r) => r.position !== null);
  const top10 = ranked.filter((r) => (r.position ?? 999) <= 10).length;
  const avg = ranked.length
    ? Math.round(ranked.reduce((s, r) => s + (r.position ?? 0), 0) / ranked.length)
    : 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">Rankings</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          See where your website shows up in search — on Google, Bing, Yahoo and Yandex, for any
          phrase, in any city, on computer or phone. Save the phrases that matter and watch how
          your position changes over time.
        </p>
      </div>

      <RankCheckForm />

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
                    <td className="py-1.5 pr-3 text-right font-bold"
                      style={{ color: r.position === null ? 'rgb(var(--muted))'
                        : r.position <= 10 ? 'rgb(var(--accent))'
                          : r.position <= 30 ? 'rgb(var(--warning))' : 'rgb(var(--ink))' }}>
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
    </div>
  );
}
