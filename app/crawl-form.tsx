'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CrawlForm({ initialUrl = '', lockUrl = false }: { initialUrl?: string; lockUrl?: boolean } = {}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [maxPages, setMaxPages] = useState(100);
  const [maxDepth, setMaxDepth] = useState(10);
  const [concurrency, setConcurrency] = useState(6);
  const [checkAssets, setCheckAssets] = useState(true);
  const [respectRobots, setRespectRobots] = useState(true);
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [maxPagespeedPages, setMaxPagespeedPages] = useState(3);
  const [renderJs, setRenderJs] = useState(false);
  const [jsWaitUntil, setJsWaitUntil] = useState<'load' | 'domcontentloaded' | 'networkidle'>('networkidle');
  const [jsTimeoutMs, setJsTimeoutMs] = useState(15000);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url, maxPages, maxDepth, concurrency,
          checkAssets, respectRobots, includeSubdomains, maxPagespeedPages,
          renderJs, jsWaitUntil, jsTimeoutMs,
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? 'Could not start the crawl');
        setBusy(false);
        return;
      }
      router.push(`/crawl/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const field = 'w-full rounded border border-line bg-ground px-2 py-1.5 font-mono text-[13px] text-ink outline-none focus:border-accent focus-visible:ring-1 focus-visible:ring-accent';
  const label = 'block font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted';

  return (
    <form onSubmit={start} className="rounded border border-line bg-surface p-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label className={label} htmlFor="url">Website address</label>
          <input
            id="url"
            className={field + ' mt-1.5 text-[15px]' + (lockUrl ? ' opacity-70' : '')}
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="url"
            required
            disabled={busy || lockUrl}
            readOnly={lockUrl}
          />
        </div>
        <div className="sm:self-end">
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="w-full rounded bg-accent px-6 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ground transition-opacity hover:opacity-90 disabled:opacity-40 sm:w-auto"
          >
            {busy ? 'Starting…' : 'Run audit'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded border border-blocker px-3 py-2 font-mono text-[12px] text-blocker">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink"
      >
        {advanced ? '− Hide' : '+ Show'} crawl settings
      </button>

      {advanced && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="maxPages">Max pages</label>
            <input id="maxPages" type="number" min={1} max={5000} value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))} className={field + ' mt-1.5'} />
          </div>
          <div>
            <label className={label} htmlFor="maxDepth">Max depth</label>
            <input id="maxDepth" type="number" min={1} max={20} value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))} className={field + ' mt-1.5'} />
          </div>
          <div>
            <label className={label} htmlFor="concurrency">Pages at a time</label>
            <input id="concurrency" type="number" min={1} max={16} value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))} className={field + ' mt-1.5'} />
          </div>
          <div>
            <label className={label} htmlFor="psi">PageSpeed pages</label>
            <input id="psi" type="number" min={0} max={10} value={maxPagespeedPages}
              onChange={(e) => setMaxPagespeedPages(Number(e.target.value))} className={field + ' mt-1.5'} />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={checkAssets} onChange={(e) => setCheckAssets(e.target.checked)} />
            Fetch page resources
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={respectRobots} onChange={(e) => setRespectRobots(e.target.checked)} />
            Respect robots.txt
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={includeSubdomains} onChange={(e) => setIncludeSubdomains(e.target.checked)} />
            Include subdomains
          </label>

          <div className="col-span-full rounded border border-line bg-ground p-3">
            <label className="flex items-start gap-2.5 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={renderJs}
                onChange={(e) => setRenderJs(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Enable JavaScript rendering (Playwright)</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                  Required for client-side SPAs (Vite, CRA, Vue, Angular). Each page is loaded in
                  headless Chromium before extraction, so titles, headings, links and body content
                  that only exist after hydration become visible. Considerably slower than raw
                  HTML fetching — leave off for SSR/SSG sites, where it changes nothing.
                </span>
              </span>
            </label>

            {renderJs && (
              <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="jsWaitUntil">Wait until</label>
                  <select
                    id="jsWaitUntil"
                    value={jsWaitUntil}
                    onChange={(e) => setJsWaitUntil(e.target.value as typeof jsWaitUntil)}
                    className={field + ' mt-1.5'}
                  >
                    <option value="networkidle">networkidle — safest for SPAs</option>
                    <option value="load">load — all resources fetched</option>
                    <option value="domcontentloaded">domcontentloaded — fastest</option>
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="jsTimeoutMs">Render timeout (ms)</label>
                  <input
                    id="jsTimeoutMs" type="number" min={3000} max={60000} step={1000}
                    value={jsTimeoutMs}
                    onChange={(e) => setJsTimeoutMs(Number(e.target.value))}
                    className={field + ' mt-1.5'}
                  />
                </div>
                <p className="col-span-full text-[12px] leading-relaxed text-muted">
                  Needs a Chromium binary. Playwright&rsquo;s own build is used when present
                  (<code className="font-mono">npx playwright install chromium</code>), otherwise
                  system Chrome or Edge. A page that fails to render falls back to its raw HTML
                  rather than being dropped.
                </p>
              </div>
            )}
          </div>

          <p className="col-span-full text-[12px] leading-relaxed text-muted">
            Fetching resources sizes every stylesheet, script and image so the page-speed and
            broken-resource checks can run. Turning it off makes the crawl faster but skips
            those checks.
          </p>
          <p className="col-span-full text-[12px] leading-relaxed text-muted">
            PageSpeed pages controls how many URLs are measured for Core Web Vitals — the
            homepage (mobile and desktop) plus the highest-PageRank pages. Each measurement is a
            rate-limited API call taking several seconds, so set 0 to skip it. Without a
            <code className="mx-1 font-mono">PAGESPEED_API_KEY</code> these requests share
            Google&rsquo;s anonymous quota and frequently fail.
          </p>
        </div>
      )}
    </form>
  );
}
