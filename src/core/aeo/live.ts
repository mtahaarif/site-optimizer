/**
 * The two files an answer-engine analysis has to read from the live site.
 *
 * `robots.txt` decides whether GPTBot, ClaudeBot and the rest are allowed in at
 * all, and `llms.txt` is the summary some of them look for. Neither is captured
 * by a crawl — a crawl records pages — and both can change after one, so they
 * are fetched at the moment the analysis runs.
 *
 * Every failure resolves to `null` rather than throwing. A site that is down, a
 * file that 404s and a request that times out all mean the same thing to the
 * caller: there is nothing to analyse. That also makes the promise safe to
 * start early and await later, which is what both callers do.
 */
const TIMEOUT_MS = 8000;
const USER_AGENT = 'SiteCheckerBot/1.0';

export async function fetchText(url: string, limit = 40_000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'user-agent': USER_AGENT },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.text()).slice(0, limit);
  } catch {
    return null;
  }
}

/** robots.txt and llms.txt for one origin, fetched together. */
export function fetchAeoFiles(origin: string): Promise<[string | null, string | null]> {
  const base = origin.replace(/\/$/, '');
  return Promise.all([
    fetchText(base + '/robots.txt'),
    fetchText(base + '/llms.txt'),
  ]);
}
