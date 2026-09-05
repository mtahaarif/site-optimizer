/**
 * Shown when the app is running without a database.
 *
 * Every screen in this product reads from Postgres, so an unconfigured
 * deployment can do exactly nothing — and the failure it produces on its own
 * is a redacted 500 with a digest, which tells the person who just deployed it
 * nothing at all. This page is what they should see instead: what is missing,
 * and the three steps that fix it.
 */
export function SetupRequired() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Setup</p>
        <h1 className="mt-2 max-w-[24ch] text-[32px] font-bold leading-[1.08] tracking-tight">
          Connect a database to get started
        </h1>
        <p className="mt-2 max-w-[74ch] text-[14px] leading-relaxed text-muted">
          The app is deployed and running, but <code className="font-mono text-ink">POSTGRES_URL</code>{' '}
          is not set, so there is nowhere to read audits, rankings or uptime history from.
          Everything else is already configured — this is the last step.
        </p>
      </header>

      <ol className="flex flex-col gap-4 border border-line bg-surface p-6">
        <li className="flex gap-4">
          <span className="font-mono text-[12px] font-bold text-accent">01</span>
          <div>
            <h2 className="text-[14px] font-medium text-ink">Create the database</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
              In your Vercel project: <strong>Storage → Create Database → Postgres</strong>. Connect
              it to this project and Vercel adds <code className="font-mono">POSTGRES_URL</code> to
              every environment for you.
            </p>
          </div>
        </li>
        <li className="flex gap-4">
          <span className="font-mono text-[12px] font-bold text-accent">02</span>
          <div>
            <h2 className="text-[14px] font-medium text-ink">Redeploy</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
              Environment variables are picked up at deploy time, so the running deployment will not
              see the new one until it is rebuilt. <strong>Deployments → ⋯ → Redeploy</strong>, or
              push any commit.
            </p>
          </div>
        </li>
        <li className="flex gap-4">
          <span className="font-mono text-[12px] font-bold text-accent">03</span>
          <div>
            <h2 className="text-[14px] font-medium text-ink">Nothing else</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
              The schema creates itself on the first query — no migration command to run. Reload
              this page once the redeploy finishes and the dashboard takes over.
            </p>
          </div>
        </li>
      </ol>

      <div className="border border-line bg-surface p-6">
        <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Running locally instead
        </h2>
        <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          Point at any Postgres — the hosted one is fine — by adding it to{' '}
          <code className="font-mono text-ink">.env.local</code>:
        </p>
        <pre className="scroll-x mt-3 border border-line bg-ground p-3 font-mono text-[11.5px] text-ink">
POSTGRES_URL=postgres://user:password@host:5432/database
        </pre>
      </div>

      <p className="text-[12.5px] text-muted">
        Check what the server can see at{' '}
        <a href="/api/health" className="text-accent hover:underline">/api/health</a>.
      </p>
    </div>
  );
}
