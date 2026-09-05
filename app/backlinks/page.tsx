import { connection } from 'next/server';
import { listSites } from '@/src/db/index.ts';
import { listBacklinks, backlinkSummary } from '@/src/backlinks/verify.ts';
import { gscConfigured } from '@/src/backlinks/gsc.ts';
import { Stat } from '../ui.tsx';
import { pageMeta } from '../meta.ts';

// Reads live data from Postgres, so there is no static shell to prerender.
export const instant = false;

export const metadata = pageMeta({
  title: 'Backlink monitoring & lost-link alerts',
  description: 'Track the links pointing to your site: which are still live, which are dofollow, and which have disappeared — with alerts on the ones worth chasing.',
  path: '/backlinks',
});

const STATUS_COLOR: Record<string, string> = {
  active: 'rgb(var(--accent))',
  lost: 'rgb(var(--blocker))',
  broken: 'rgb(var(--critical))',
  unverified: 'rgb(var(--muted))',
};

const REL_COLOR: Record<string, string> = {
  dofollow: 'rgb(var(--accent))',
  nofollow: 'rgb(var(--warning))',
  ugc: 'rgb(var(--warning))',
  sponsored: 'rgb(var(--warning))',
};

const host = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export default async function BacklinksPage() {
  await connection();

  const sites = await listSites();
  const gsc = gscConfigured();

  const bySite = await Promise.all(sites.map(async (site) => ({
    site,
    links: await listBacklinks(site.id),
    summary: await backlinkSummary(site.id),
  })));
  const anyLinks = bySite.some((s) => s.links.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">Backlinks</h1>
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
                          className="rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.08em]"
                          style={{ color: STATUS_COLOR[l.status], borderColor: STATUS_COLOR[l.status] }}
                        >
                          {l.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3" style={{ color: l.rel ? REL_COLOR[l.rel] : undefined }}>
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
    </div>
  );
}
