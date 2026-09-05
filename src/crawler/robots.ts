/**
 * robots.txt fetching and rule matching.
 *
 * Implements the Google matching semantics that matter in practice: the most
 * specific matching rule wins by pattern length, Allow beats Disallow on ties,
 * and both * and $ wildcards are supported.
 */
import type { RobotsInfo } from '../core/checks/types.ts';

interface Rule {
  type: 'allow' | 'disallow';
  pattern: string;
  regex: RegExp;
}

function patternToRegex(pattern: string): RegExp {
  let src = '';
  for (const ch of pattern) {
    if (ch === '*') src += '.*';
    else if (ch === '$') src += '$';
    else src += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + src);
}

export function parseRobots(content: string, found: boolean, status: number): RobotsInfo {
  const rules: Rule[] = [];
  const sitemaps: string[] = [];
  let inScope = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // A blank line separates groups; we track only the generic "*" group plus
      // any group naming a Google crawler, which is what SEO tooling cares about.
      inScope = value === '*' || /googlebot/i.test(value);
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    } else if (inScope && (field === 'allow' || field === 'disallow')) {
      if (field === 'disallow' && value === '') continue; // "Disallow:" means allow all
      rules.push({ type: field, pattern: value, regex: patternToRegex(value) });
    }
  }

  const isDisallowed = (url: string): boolean => {
    if (!found || rules.length === 0) return false;
    let pathAndQuery: string;
    try {
      const u = new URL(url);
      pathAndQuery = u.pathname + u.search;
    } catch { return false; }

    let best: Rule | null = null;
    for (const r of rules) {
      if (!r.regex.test(pathAndQuery)) continue;
      if (!best || r.pattern.length > best.pattern.length) best = r;
      // Allow wins ties against an equally specific Disallow.
      else if (r.pattern.length === best.pattern.length && r.type === 'allow') best = r;
    }
    return best?.type === 'disallow';
  };

  return {
    found,
    status,
    content,
    sitemaps,
    homepageAllowed: !isDisallowed('/'),
    isDisallowed,
  };
}

export async function fetchRobots(origin: string, fetchFn: typeof fetch = fetch): Promise<RobotsInfo> {
  try {
    const res = await fetchFn(new URL('/robots.txt', origin).toString(), {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!res.ok) return parseRobots('', false, res.status);
    return parseRobots(await res.text(), true, res.status);
  } catch {
    return parseRobots('', false, 0);
  }
}

export const USER_AGENT =
  'Mozilla/5.0 (compatible; SiteCheckerBot/0.1; +http://localhost:3000/bot)';
