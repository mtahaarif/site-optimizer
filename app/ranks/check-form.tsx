'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Check your ranking" — enter a phrase and your website, and see where you
 * show up, either in the normal search results or on the Google map pack.
 * Copy here is intentionally plain: no jargon, examples stay generic.
 */

type Engine = 'google' | 'bing' | 'yahoo' | 'yandex';
type Scope = 'web' | 'local';

interface RankCheck {
  engine: Engine;
  provider: string;
  position: number | null;
  url: string | null;
  title: string | null;
  resultsChecked: number;
  features: string[];
  error: string | null;
  skipped: boolean;
}

const WEB_ENGINES: { key: Engine; label: string }[] = [
  { key: 'google', label: 'Google' },
  { key: 'bing', label: 'Bing' },
  { key: 'yahoo', label: 'Yahoo' },
  { key: 'yandex', label: 'Yandex' },
];

const ENGINE_LABEL: Record<Engine, string> = { google: 'Google', bing: 'Bing', yahoo: 'Yahoo', yandex: 'Yandex' };

function posColor(p: number | null): string {
  if (p === null) return 'rgb(var(--muted))';
  if (p <= 3) return 'rgb(var(--opportunity))';
  if (p <= 10) return 'rgb(var(--accent))';
  if (p <= 30) return 'rgb(var(--warning))';
  return 'rgb(var(--ink))';
}

export function RankCheckForm({ savedLocations = [] }: { savedLocations?: string[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('web');
  const [keyword, setKeyword] = useState('');
  const [domain, setDomain] = useState('');
  const [engines, setEngines] = useState<Set<Engine>>(new Set(['google', 'bing', 'yahoo', 'yandex']));
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [country, setCountry] = useState('US');
  const [city, setCity] = useState('');
  const [track, setTrack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RankCheck[] | null>(null);
  const [checked, setChecked] = useState<{ keyword: string; domain: string; scope: Scope } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  function toggleEngine(e: Engine) {
    setEngines((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e); else next.add(e);
      return next;
    });
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setResults(null);
    setSavedNote(null);
    const willTrack = track && scope === 'web';
    try {
      const res = await fetch('/api/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyword, domain, scope,
          engines: scope === 'local' ? ['google'] : [...engines],
          device, country: country || null, city: city || null,
          track: willTrack,
        }),
      });
      const data = await res.json() as { results?: RankCheck[]; error?: string; tracked?: number };
      if (!res.ok || !data.results) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setBusy(false);
        return;
      }
      setResults(data.results);
      setChecked({ keyword, domain, scope });
      if (willTrack && data.tracked) {
        setSavedNote(`Now watching this phrase — you'll see it in the list below.`);
        router.refresh();
      }
    } catch {
      setError('Could not reach the checker. Please try again.');
    }
    setBusy(false);
  }

  const field = 'w-full border border-line bg-ground px-2.5 py-1.5 text-[14px] text-ink outline-none focus:border-ink';
  const label = 'block text-[12px] font-medium text-muted';

  return (
    <section className="border border-line bg-surface p-5">
      <h2 className="text-[16px] font-medium text-ink">Check your ranking</h2>
      <p className="mt-1.5 max-w-[70ch] text-[13.5px] leading-relaxed text-muted">
        Type a phrase your customers search for and your website address to see where you show up.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
        {/* where to check */}
        <div>
          <span className={label}>Where to check</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" onClick={() => setScope('web')} disabled={busy}
              className={'border px-3.5 py-1.5 text-[13px] transition-colors ' +
                (scope === 'web' ? 'border-ink bg-ink text-ground' : 'border-line text-muted hover:border-ink hover:text-ink')}>
              Search results
            </button>
            <button type="button" onClick={() => setScope('local')} disabled={busy}
              className={'border px-3.5 py-1.5 text-[13px] transition-colors ' +
                (scope === 'local' ? 'border-ink bg-ink text-ground' : 'border-line text-muted hover:border-ink hover:text-ink')}>
              Google Business (map)
            </button>
          </div>
          {scope === 'local' && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              The map results are the block of businesses shown with a map for local searches. Checked on Google.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="kw">Search phrase</label>
            <input id="kw" className={field + ' mt-1.5'} placeholder="e.g. best coffee shop near me"
              value={keyword} onChange={(e) => setKeyword(e.target.value)} required disabled={busy} />
          </div>
          <div>
            <label className={label} htmlFor="dom">Your website</label>
            <input id="dom" className={field + ' mt-1.5'} placeholder="e.g. yourbusiness.com"
              value={domain} onChange={(e) => setDomain(e.target.value)} required disabled={busy} />
          </div>
        </div>

        {scope === 'web' && (
          <div>
            <span className={label}>Search engines</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {WEB_ENGINES.map((e) => (
                <button key={e.key} type="button" onClick={() => toggleEngine(e.key)} disabled={busy}
                  className={'border px-3 py-1.5 text-[13px] transition-colors ' +
                    (engines.has(e.key) ? 'border-ink bg-ink text-ground' : 'border-line text-muted hover:border-ink hover:text-ink')}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="dev">Device</label>
            <select id="dev" value={device} onChange={(e) => setDevice(e.target.value as 'desktop' | 'mobile')}
              className={field + ' mt-1.5'} disabled={busy}>
              <option value="desktop">Computer</option>
              <option value="mobile">Phone</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="cc">Country</label>
            <input id="cc" className={field + ' mt-1.5'} placeholder="e.g. US" maxLength={2}
              value={country} onChange={(e) => setCountry(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className={label} htmlFor="city">City or region <span className="text-muted">(optional)</span></label>
            <input id="city" className={field + ' mt-1.5'} placeholder="e.g. Austin, Texas"
              value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
          </div>
        </div>

        {savedLocations.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted">Your locations:</span>
            {savedLocations.map((l) => (
              <button key={l} type="button" onClick={() => setCity(l)} disabled={busy}
                className={'border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-40 '
                  + (city === l ? 'border-ink bg-ink text-ground' : 'border-line text-muted hover:border-ink hover:text-ink')}>
                {l}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={busy || !keyword.trim() || !domain.trim() || (scope === 'web' && engines.size === 0)}
            className="border border-ink bg-ink px-6 py-2 text-[14px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-40">
            {busy ? 'Checking…' : 'Check ranking'}
          </button>
          {scope === 'web' && (
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} disabled={busy} />
              Keep watching this over time
            </label>
          )}
        </div>
      </form>

      {error && (
        <p className="mt-4 border border-blocker px-3 py-2 text-[13px] text-blocker">{error}</p>
      )}
      {savedNote && (
        <p className="mt-4 border border-opportunity px-3 py-2 text-[13px] text-opportunity">{savedNote}</p>
      )}

      {results && (
        <div className="mt-6">
          <p className="mb-3 text-[13px] text-muted">
            <span className="text-ink">{checked?.domain}</span> for “<span className="text-ink">{checked?.keyword}</span>”
            {checked?.scope === 'local' ? ' on the map' : ''}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {results.map((r) => (
              <div key={r.engine} className="border border-line bg-ground p-4">
                <div className="text-[12px] font-medium text-muted">
                  {checked?.scope === 'local' ? 'Google Maps' : ENGINE_LABEL[r.engine]}
                </div>
                {r.skipped || r.error ? (
                  <>
                    <div className="mt-2 text-[15px] text-muted">—</div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-warning">{r.error}</p>
                  </>
                ) : r.position === null ? (
                  <>
                    <div className="mt-2 text-[18px] font-medium text-ink">Not in the top {r.resultsChecked || 100}</div>
                    <p className="mt-1.5 text-[12px] text-muted">Checked the first {r.resultsChecked} results.</p>
                  </>
                ) : (
                  <>
                    <div className="mt-2 tnum text-[40px] font-normal leading-none tracking-tight" style={{ color: posColor(r.position) }}>
                      #{r.position}
                    </div>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[12px] text-muted hover:text-accent">
                        {r.url.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
