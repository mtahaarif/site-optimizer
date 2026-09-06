import { connection } from 'next/server';
import { listSites } from '@/src/db/index.ts';
import { listBacklinks, backlinkSummaries, emptyBacklinkSummary } from '@/src/backlinks/verify.ts';
import { gscConfigured } from '@/src/backlinks/gsc.ts';
import { Stat } from '../ui.tsx';
import { pageMeta } from '../meta.ts';
import { PageNotes } from '../page-notes.tsx';

// Reads live data from Postgres, so there is no static shell to prerender.
export const instant = false;

export const metadata = pageMeta({
  title: 'Backlink monitoring & lost-link alerts',
  description: 'Track the links pointing to your site: which are still live, which are dofollow, and which have disappeared — with alerts on the ones worth chasing.',
  path: '/backlinks',
});

// Utility classes rather than inline colours: one shared rule beats a style
// attribute repeated on every row of a table that can run to hundreds of links.
const STATUS_CLASS: Record<string, string> = {
  active: 'text-accent border-accent',
  lost: 'text-blocker border-blocker',
  broken: 'text-critical border-critical',
  unverified: 'text-muted border-muted',
};

const REL_CLASS: Record<string, string> = {
  dofollow: 'text-accent',
  nofollow: 'text-warning',
  ugc: 'text-warning',
  sponsored: 'text-warning',
};

const host = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export default async function BacklinksPage() {
  await connection();

  // Three round trips for the whole page rather than 3N + 2. Fetching each
  // site's links and summary inside the map put two sequential queries per site
  // behind a single pooled connection, so the page got linearly slower with
  // every project added.
  const [sites, gsc, allLinks, summaries] = await Promise.all([
    listSites(),
    gscConfigured(),
    listBacklinks(),
    backlinkSummaries(),
  ]);

  const linksBySite = new Map<number, typeof allLinks>();
  for (const link of allLinks) {
    const list = linksBySite.get(link.site_id) ?? [];
    list.push(link);
    linksBySite.set(link.site_id, list);
  }

  const bySite = sites.map((site) => ({
    site,
    links: linksBySite.get(site.id) ?? [],
    summary: summaries.get(site.id) ?? emptyBacklinkSummary(),
  }));
  const anyLinks = allLinks.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">Backlink monitoring</h1>
        <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-muted">
          Links from other websites to yours help your rankings. We re-check each one to confirm
          it&rsquo;s still there and still counts, and flag it if it disappears — that&rsquo;s the one worth
          following up on.
        </p>
        <p className="mt-3 font-mono text-[11.5px]">
          Search Console:{' '}
          {gsc
            ? <span className="text-accent">configured</span>
            : <span className="text-muted">not configured — seed links manually or from a CSV export</span>}
        </p>
      </div>

      {!gsc && (
        <div className="rounded border border-line bg-surface p-5">
          <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
            Seeding the list
          </h2>
          <p className="mt-2 max-w-[72ch] text-[13px] leading-relaxed text-muted">
            Google Search Console only shows your links inside its own dashboard, not for
            automatic download. So the reliable way to load a full list is to export it from there
            as a file and import it here.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-ground p-3 font-mono text-[11.5px] text-ink">
{`# Search Console > Links > Top linking pages > Export
node scripts/backlinks.ts --import-csv https://example.com links.csv

# or via the API (service account)
node scripts/backlinks.ts --import-gsc https://example.com

# or one at a time
node scripts/backlinks.ts --add https://example.com https://referring-site.com/post

# then verify
node scripts/backlinks.ts https://example.com`}</pre>
        </div>
      )}

      {bySite.map(({ site, links, summary: s }) => {
        if (links.length === 0) return null;

        return (
          <section key={site.id}>
            <h2 className="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
              <span className="text-[17px] font-bold tracking-tight">
                {site.origin.replace(/^https?:\/\//, '')}
              </span>
              <span className="font-mono text-[11px] text-muted">
                {s.total} link{s.total === 1 ? '' : 's'} from {s.referringDomains} domain
                {s.referringDomains === 1 ? '' : 's'}
              </span>
            </h2>

            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Active" value={s.active} tone="rgb(var(--accent))" />
              <Stat label="Lost" value={s.lost} tone={s.lost > 0 ? 'rgb(var(--blocker))' : undefined} />
              <Stat label="Broken" value={s.broken} tone={s.broken > 0 ? 'rgb(var(--critical))' : undefined} />
              <Stat label="Unverified" value={s.unverified} />
              <Stat label="Dofollow" value={s.dofollow} tone="rgb(var(--accent))" />
              <Stat label="Nofollow" value={s.nofollow} tone={s.nofollow > 0 ? 'rgb(var(--warning))' : undefined} />
            </div>

            <div className="scroll-x">
              <table className="w-full min-w-[820px] border-collapse font-mono text-[12px]">
                <caption className="sr-only">Tracked backlinks with status, rel attribute, referring page and anchor</caption>
                <thead>
                  <tr className="border-b border-line text-left text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Rel</th>
                    <th className="pb-2 pr-3">Referring page</th>
                    <th className="pb-2 pr-3">Anchor</th>
                    <th className="pb-2 text-right">Last checked</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {links.map((l) => (
                    <tr key={l.id} className="border-b border-line/50 hover:bg-surface">
                      <td className="py-1.5 pr-3">
                        <span
                          className={'rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.08em] '
                            + (STATUS_CLASS[l.status] ?? 'text-muted border-line')}
                        >
                          {l.status}
                        </span>
                      </td>
                      <td className={'py-1.5 pr-3 ' + (l.rel ? REL_CLASS[l.rel] ?? '' : '')}>
                        {l.rel ?? '—'}
                      </td>
                      <td className="max-w-[300px] truncate py-1.5 pr-3">
                        <a href={l.source_url} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">
                          {host(l.source_url)}
                          <span className="text-muted">
                            {(() => { try { return new URL(l.source_url).pathname; } catch { return ''; } })()}
                          </span>
                        </a>
                      </td>
                      <td className="max-w-[200px] truncate py-1.5 pr-3 text-muted">{l.anchor ?? '—'}</td>
                      <td className="py-1.5 text-right text-muted">
                        {l.last_checked ? new Date(l.last_checked).toLocaleDateString() : 'never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {!anyLinks && gsc && (
        <p className="py-8 text-center text-[14px] text-muted">
          No backlinks tracked yet. Run{' '}
          <code className="font-mono text-ink">node scripts/backlinks.ts --import-gsc &lt;url&gt;</code>
        </p>
      )}

      <PageNotes
        title="How backlink monitoring works"
        intro={<>Getting a link is the hard part; keeping it is the part nobody watches. Every link in this list
          is fetched again on a schedule and judged on what the linking page actually returns now, not on what it
          returned when the link was first recorded.</>}
        items={[
          { term: 'Active', body: <>The linking page still loads and the link to you is still in its markup. This is
            verified against the live page rather than a cached index, so it reflects an editor quietly removing
            the link on the day they do it.</> },
          { term: 'Lost', body: <>The page still exists but no longer links to you. This is the row worth acting on:
            the relationship already exists, the page already ranks, and a short note to whoever maintains it
            recovers the link far more often than chasing a new one would.</> },
          { term: 'Broken', body: <>The linking page itself no longer resolves. Nothing to recover directly, but a
            cluster of these from one domain usually means a site migration, and the same content often exists at
            a new address that could link to you again.</> },
          { term: 'Dofollow and nofollow', body: <>Whether the link passes ranking signal, read from its rel
            attribute. Nofollow, sponsored and ugc links still send visitors and still count as evidence that
            people reference you &mdash; they just do not carry authority.</> },
          { term: 'Referring domains', body: <>Distinct sites linking to you, which matters far more than the raw
            link count. Fifty links from one forum are worth less than five from five unrelated publications.</> },
          { term: 'Anchor text', body: <>The words someone chose to link you with. A natural profile is mostly
            your brand and bare URLs, with topical phrases scattered through it; a profile where most links use
            the same commercial phrase is the pattern manual actions are built to catch.</> },
          { term: 'Where the link sits', body: <>A link inside the body of a relevant article carries more than
            the same link in a footer or a sidebar that appears on every page of a site. Position is not scored
            here, but it is worth checking before deciding a lost link is worth chasing.</> },
        ]}
        footnote={<>Seed the list from Search Console when it is connected, or import a CSV from any backlink tool
          you already pay for &mdash; monitoring works the same either way, because the verification is done here
          against the live pages.</>}
      />
    </div>
  );
}
