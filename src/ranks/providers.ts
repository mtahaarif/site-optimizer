/**
 * Module 2 — SERP provider adapters.
 *
 * Search engines actively block automated scraping, so rankings come from a
 * specialised SERP API. Three providers are supported behind one interface;
 * whichever is configured is used.
 *
 *   SerpApi     SERPAPI_KEY        100 searches/month free
 *   ValueSERP   VALUESERP_KEY      100 searches/month free trial
 *   DataForSEO  DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD   free tier on signup
 *
 * Free tiers are small enough that spending them by accident is the main
 * failure mode, so every call is metered against a ledger in SQLite before it
 * is made. See quota.ts.
 */

export type Engine = 'google' | 'bing' | 'yahoo' | 'yandex';
export type Device = 'desktop' | 'mobile';

export interface SerpQuery {
  phrase: string;
  engine: Engine;
  device: Device;
  /** ISO-3166 alpha-2, e.g. "US" */
  country?: string | null;
  /** City-level targeting, e.g. "Austin,Texas,United States" */
  city?: string | null;
  /** ISO-639-1, e.g. "en" */
  language?: string | null;
  /** how many organic results to scan for our domain */
  depth?: number;
  /**
   * 'web' scans the normal organic results; 'local' scans the Google map pack
   * (the local 3-pack) — the surface that decides visibility for a local
   * business. Local is Google-only.
   */
  scope?: 'web' | 'local';
}

export interface SerpResult {
  position: number;
  url: string;
  title: string;
}

export interface SerpResponse {
  provider: string;
  results: SerpResult[];
  /** SERP features present, e.g. featured_snippet, local_pack */
  features: string[];
  resultsChecked: number;
  error: string | null;
}

export interface SerpProvider {
  name: string;
  configured(): boolean;
  /** engines this provider can actually query */
  supports(engine: Engine): boolean;
  search(q: SerpQuery): Promise<SerpResponse>;
}

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

const fail = (provider: string, error: string): SerpResponse =>
  ({ provider, results: [], features: [], resultsChecked: 0, error });

// ---------------------------------------------------------------------------
// SerpApi — broadest engine coverage of the three
// ---------------------------------------------------------------------------

const serpApi: SerpProvider = {
  name: 'serpapi',
  configured: () => !!env('SERPAPI_KEY'),
  supports: () => true, // google, bing, yahoo and yandex all have engines
  async search(q) {
    const key = env('SERPAPI_KEY');
    if (!key) return fail('serpapi', 'SERPAPI_KEY not set');

    // ---- Local map pack (Google only) ----
    if (q.scope === 'local') {
      if (q.engine !== 'google') return fail('serpapi', 'Local map results are available for Google only.');
      const lp = new URLSearchParams({ api_key: key, q: q.phrase, engine: 'google_local' });
      if (q.city) lp.set('location', q.city);
      if (q.country) lp.set('gl', q.country.toLowerCase());
      if (q.language) lp.set('hl', q.language);
      try {
        const res = await fetch('https://serpapi.com/search.json?' + lp.toString());
        if (!res.ok) return fail('serpapi', `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json() as Record<string, unknown>;
        if (data['error']) return fail('serpapi', String(data['error']));
        const places = (data['local_results'] ?? []) as Array<Record<string, unknown>>;
        const results: SerpResult[] = places.map((p, i) => {
          const links = (p['links'] ?? {}) as Record<string, unknown>;
          return {
            position: Number(p['position'] ?? i + 1),
            url: String(p['website'] ?? links['website'] ?? ''),
            title: String(p['title'] ?? ''),
          };
        });
        return { provider: 'serpapi', results, features: ['local_pack'], resultsChecked: results.length, error: null };
      } catch (err) {
        return fail('serpapi', (err as Error).message);
      }
    }

    const params = new URLSearchParams({ api_key: key, q: q.phrase, engine: q.engine });

    // Each engine names its parameters differently; normalising here keeps the
    // rest of the module engine-agnostic.
    if (q.engine === 'google') {
      params.set('num', String(q.depth ?? 100));
      params.set('device', q.device);
      if (q.city) params.set('location', q.city);
      if (q.country) params.set('gl', q.country.toLowerCase());
      if (q.language) params.set('hl', q.language);
    } else if (q.engine === 'bing') {
      params.set('count', String(q.depth ?? 50));
      params.set('device', q.device);
      if (q.city) params.set('location', q.city);
      if (q.country) params.set('cc', q.country.toLowerCase());
    } else if (q.engine === 'yandex') {
      params.set('text', q.phrase);
      params.delete('q');
      if (q.country) params.set('lr', q.country);
      if (q.language) params.set('lang', q.language);
    } else if (q.engine === 'yahoo') {
      params.set('p', q.phrase);
      params.delete('q');
    }

    try {
      const res = await fetch('https://serpapi.com/search.json?' + params.toString());
      if (!res.ok) return fail('serpapi', `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json() as Record<string, unknown>;
      if (data['error']) return fail('serpapi', String(data['error']));

      const organic = (data['organic_results'] ?? []) as Array<Record<string, unknown>>;
      const results: SerpResult[] = organic.map((r, i) => ({
        position: Number(r['position'] ?? i + 1),
        url: String(r['link'] ?? ''),
        title: String(r['title'] ?? ''),
      })).filter((r) => r.url);

      const features = Object.keys(data).filter((k) =>
        ['answer_box', 'knowledge_graph', 'local_results', 'related_questions',
          'top_stories', 'inline_videos', 'shopping_results', 'ads'].includes(k));

      return { provider: 'serpapi', results, features, resultsChecked: results.length, error: null };
    } catch (err) {
      return fail('serpapi', (err as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------
// ValueSERP — Google and Bing/Yahoo/Yandex via search_type
// ---------------------------------------------------------------------------

const valueSerp: SerpProvider = {
  name: 'valueserp',
  configured: () => !!env('VALUESERP_KEY'),
  supports: (e) => e === 'google' || e === 'bing' || e === 'yahoo',
  async search(q) {
    const key = env('VALUESERP_KEY');
    if (!key) return fail('valueserp', 'VALUESERP_KEY not set');
    if (q.engine === 'yandex') return fail('valueserp', 'ValueSERP does not support Yandex');

    const params = new URLSearchParams({
      api_key: key,
      q: q.phrase,
      search_type: 'web',
      device: q.device,
      num: String(q.depth ?? 100),
      engine: q.engine,
    });
    if (q.city) params.set('location', q.city);
    if (q.country) params.set('gl', q.country.toLowerCase());
    if (q.language) params.set('hl', q.language);

    try {
      const res = await fetch('https://api.valueserp.com/search?' + params.toString());
      if (!res.ok) return fail('valueserp', `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json() as Record<string, unknown>;

      const organic = (data['organic_results'] ?? []) as Array<Record<string, unknown>>;
      const results: SerpResult[] = organic.map((r, i) => ({
        position: Number(r['position'] ?? i + 1),
        url: String(r['link'] ?? ''),
        title: String(r['title'] ?? ''),
      })).filter((r) => r.url);

      const features = Object.keys(data).filter((k) =>
        ['answer_box', 'knowledge_graph', 'local_results', 'related_questions',
          'top_stories', 'inline_images'].includes(k));

      return { provider: 'valueserp', results, features, resultsChecked: results.length, error: null };
    } catch (err) {
      return fail('valueserp', (err as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------
// DataForSEO — live SERP endpoints, HTTP Basic auth
// ---------------------------------------------------------------------------

const dataForSeo: SerpProvider = {
  name: 'dataforseo',
  configured: () => !!(env('DATAFORSEO_LOGIN') && env('DATAFORSEO_PASSWORD')),
  supports: (e) => e === 'google' || e === 'bing' || e === 'yahoo',
  async search(q) {
    const login = env('DATAFORSEO_LOGIN');
    const password = env('DATAFORSEO_PASSWORD');
    if (!login || !password) return fail('dataforseo', 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set');
    if (q.engine === 'yandex') return fail('dataforseo', 'DataForSEO does not expose a Yandex SERP endpoint');

    const auth = Buffer.from(`${login}:${password}`).toString('base64');
    const endpoint = `https://api.dataforseo.com/v3/serp/${q.engine}/organic/live/regular`;

    const task: Record<string, unknown> = {
      keyword: q.phrase,
      device: q.device,
      depth: q.depth ?? 100,
      language_code: q.language ?? 'en',
    };
    // DataForSEO resolves a free-text location string to its own location id.
    if (q.city) task['location_name'] = q.city;
    else if (q.country) task['location_code'] = countryToLocationCode(q.country);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: 'Basic ' + auth, 'content-type': 'application/json' },
        body: JSON.stringify([task]),
      });
      if (!res.ok) return fail('dataforseo', `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

      const data = await res.json() as Record<string, unknown>;
      const tasks = (data['tasks'] ?? []) as Array<Record<string, unknown>>;
      const first = tasks[0];
      if (!first) return fail('dataforseo', 'empty task list');
      if (Number(first['status_code']) !== 20000) {
        return fail('dataforseo', String(first['status_message'] ?? 'task failed'));
      }

      const items = ((first['result'] as Array<Record<string, unknown>>)?.[0]?.['items']
        ?? []) as Array<Record<string, unknown>>;

      const results: SerpResult[] = items
        .filter((it) => it['type'] === 'organic')
        .map((it, i) => ({
          position: Number(it['rank_absolute'] ?? i + 1),
          url: String(it['url'] ?? ''),
          title: String(it['title'] ?? ''),
        }))
        .filter((r) => r.url);

      const features = [...new Set(items.map((it) => String(it['type'])).filter((t) => t !== 'organic'))];

      return { provider: 'dataforseo', results, features, resultsChecked: results.length, error: null };
    } catch (err) {
      return fail('dataforseo', (err as Error).message);
    }
  },
};

/** DataForSEO location codes for the most common markets. */
function countryToLocationCode(country: string): number {
  const map: Record<string, number> = {
    US: 2840, GB: 2826, CA: 2124, AU: 2036, DE: 2276, FR: 2250,
    ES: 2724, IT: 2380, NL: 2528, IN: 2356, PK: 2586, BR: 2076,
    JP: 2392, RU: 2643, AE: 2784, SG: 2702,
  };
  return map[country.toUpperCase()] ?? 2840;
}

// ---------------------------------------------------------------------------

export const PROVIDERS: SerpProvider[] = [serpApi, valueSerp, dataForSeo];

export function configuredProviders(): SerpProvider[] {
  return PROVIDERS.filter((p) => p.configured());
}

/**
 * Pick a provider for one query: the preferred one if it is configured and
 * supports the engine, otherwise the first that does.
 */
export function pickProvider(engine: Engine): SerpProvider | null {
  const available = configuredProviders().filter((p) => p.supports(engine));
  if (available.length === 0) return null;

  const preferred = env('SERP_PROVIDER');
  if (preferred) {
    const match = available.find((p) => p.name === preferred);
    if (match) return match;
  }
  return available[0]!;
}
