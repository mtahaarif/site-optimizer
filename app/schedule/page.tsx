import Link from 'next/link';
import { connection } from 'next/server';
import { dbStats } from '@/src/db/index.ts';
import { alertChannelsConfigured } from '@/src/alerts/send.ts';
import { configuredProviders } from '@/src/ranks/providers.ts';
import { gscConfigured } from '@/src/backlinks/gsc.ts';
import { pageMeta } from '../meta.ts';

// Reads live data from Postgres, so there is no static shell to prerender.
export const instant = false;

export const metadata = pageMeta({
  title: 'Scheduling, alerts & integrations',
  description: 'Set up automatic re-crawls and alerts, connect Search Console and Analytics, and see what is configured — run from a laptop or free on a schedule.',
  path: '/schedule',
});

const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

const Pre = ({ children }: { children: string }) => (
  <pre className="scroll-x rounded border border-line bg-surface p-4 font-mono text-[11.5px] leading-relaxed text-ink">
    {children}
  </pre>
);

export default async function SchedulePage() {
  await connection();

  const stats = await dbStats();
  const channels = alertChannelsConfigured();
  const providers = configuredProviders();
  const gscOn = await gscConfigured();

  const ready = [
    { label: 'Alert delivery', ok: channels.length > 0, detail: channels.join(', ') || 'console only' },
    { label: 'SERP provider', ok: providers.length > 0, detail: providers.map((p) => p.name).join(', ') || 'none' },
    { label: 'Search Console', ok: gscOn, detail: gscOn ? 'connected' : 'not connected' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">Scheduling</h1>
        <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-muted">
          Nothing runs on its own. The scripts are one-shot: a scheduler invokes them, they write
          to Postgres and exit. That is what keeps the whole tool free — there is no daemon to
          host, so there is nothing to pay a VPS for beyond the database itself.
        </p>
      </div>

      <Block title="Configuration status">
        <div className="grid gap-2 sm:grid-cols-3">
          {ready.map((r) => (
            <div key={r.label} className="rounded border border-line bg-surface px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: r.ok ? 'rgb(var(--accent))' : 'rgb(var(--muted))' }}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  {r.label}
                </span>
              </div>
              <div className="mt-1 font-mono text-[12px]" style={{ color: r.ok ? 'rgb(var(--accent))' : 'rgb(var(--muted))' }}>
                {r.detail}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[11.5px] text-muted">
          Database: {stats.path} · {fmtBytes(stats.bytes)} ·{' '}
          {Object.entries(stats.tables).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(' · ') || 'empty'}
        </p>
      </Block>

      <Block title="Option A — your machine (cron / Task Scheduler)">
        <p className="mb-3 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          No extra hosting, but it only runs while the machine is on and awake. Fine for rank and
          backlink checks, which are weekly and daily. Not adequate on its own for &ldquo;24/7&rdquo;
          uptime monitoring — a laptop that sleeps stops monitoring. Every script writes straight to
          the same Postgres database the dashboard reads, so results appear immediately either way.
        </p>

        <h3 className="mb-2 mt-4 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
          macOS / Linux — crontab -e
        </h3>
        <Pre>{`# every 15 minutes: uptime
*/15 * * * * cd /path/to/SiteChecker && POSTGRES_URL="..." /usr/local/bin/node scripts/monitor.ts >> monitor.log 2>&1

# daily 04:00: backlinks
0 4 * * * cd /path/to/SiteChecker && POSTGRES_URL="..." /usr/local/bin/node scripts/backlinks.ts >> backlinks.log 2>&1

# Mondays 06:00: rankings (weekly, to stay inside the free SERP tier)
0 6 * * 1 cd /path/to/SiteChecker && POSTGRES_URL="..." /usr/local/bin/node scripts/ranks.ts >> ranks.log 2>&1`}</Pre>
        <p className="mt-2 text-[12.5px] text-muted">
          cron runs with a minimal environment and will not read <code className="font-mono">.env.local</code>.
          Either export the variables in the crontab (as above) or source them in a wrapper script.
        </p>

        <h3 className="mb-2 mt-5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
          Windows — Task Scheduler
        </h3>
        <Pre>{`schtasks /create /tn "SiteChecker Monitor" /sc minute /mo 15 ^
  /tr "node D:\\Work\\SiteChecker\\scripts\\monitor.ts" /st 00:00

schtasks /create /tn "SiteChecker Backlinks" /sc daily /st 04:00 ^
  /tr "node D:\\Work\\SiteChecker\\scripts\\backlinks.ts"

schtasks /create /tn "SiteChecker Ranks" /sc weekly /d MON /st 06:00 ^
  /tr "node D:\\Work\\SiteChecker\\scripts\\ranks.ts"`}</Pre>
        <p className="mt-2 text-[12.5px] text-muted">
          Set the environment variables under the task&rsquo;s Action, or wrap the command in a
          <code className="mx-1 font-mono">.cmd</code> file that sets them first — Task Scheduler
          does not read <code className="font-mono">.env.local</code> either.
        </p>
      </Block>

      <Block title="Option B — GitHub Actions (genuinely 24/7, still free)">
        <p className="mb-3 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          This is the honest answer to round-the-clock monitoring without a VPS. The runner is
          stateless, but that no longer matters — every script writes straight to Postgres, so
          there is nothing to persist locally between runs. Public repos get unlimited minutes;
          private repos get 2,000/month and a monitoring run costs about 15 seconds.
        </p>
        <p className="mb-3 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          Two limits to know: scheduled workflows are <strong>throttled under load</strong>, so a
          <code className="mx-1 font-mono">*/15</code> schedule fires roughly every 15&ndash;25
          minutes rather than exactly on the quarter hour; and they are{' '}
          <strong>disabled after 60 days of repository inactivity</strong>, which any commit resets.
        </p>
        <Pre>{`.github/workflows/monitor.yml     every 15 min
.github/workflows/backlinks.yml   daily 04:00 UTC
.github/workflows/ranks.yml       Mondays 06:00 UTC`}</Pre>
        <p className="mt-3 text-[13px] text-muted">
          Add credentials under <strong>Settings → Secrets and variables → Actions</strong> — the
          same <code className="font-mono">POSTGRES_URL</code> your app uses, plus whatever else
          each script needs. Google accounts connected on{' '}
          <Link href="/insights" className="text-accent hover:underline">Insights</Link> live in
          that database, so a scheduled run picks them up from the connection string alone and
          needs no Google secrets of its own.
        </p>
        <Pre>{`POSTGRES_URL
SENDGRID_API_KEY              ALERT_EMAIL_TO
ALERT_EMAIL_FROM              ALERT_WEBHOOK_URL
SERPAPI_KEY                   VALUESERP_KEY
DATAFORSEO_LOGIN              DATAFORSEO_PASSWORD
INTEGRATIONS_SECRET           (only if you set one)`}</Pre>
      </Block>

      <Block title="Local environment">
        <p className="mb-3 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          Copy <code className="font-mono">.env.example</code> to{' '}
          <code className="font-mono">.env.local</code> and set <code className="font-mono">POSTGRES_URL</code>.
          Google accounts are connected in the app rather than set here; set{' '}
          <code className="font-mono">INTEGRATIONS_SECRET</code> to encrypt them at rest.
        </p>
        <Pre>{`cp .env.example .env.local

# then, one-time setup
node scripts/monitor.ts --add https://example.com
node scripts/ranks.ts --add https://example.com "your keyword" google mobile US
node scripts/backlinks.ts --import-csv https://example.com links.csv`}</Pre>
      </Block>
    </div>
  );
}
