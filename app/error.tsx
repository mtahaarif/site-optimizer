'use client';

/**
 * Route-level error boundary.
 *
 * Next redacts server error messages in production — the client gets a digest
 * and nothing else — so this cannot report the specific cause. What it can do
 * is replace an unexplained "a server error occurred" with the two things that
 * are actually useful: the digest (which matches the runtime log entry) and
 * the check that resolves the most common cause by itself.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 py-16">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-blocker">Error</p>
        <h1 className="mt-2 max-w-[24ch] text-[28px] font-bold leading-[1.1] tracking-tight">
          This page didn&rsquo;t load
        </h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          Something failed on the server while rendering it. The most common cause is the database
          being unreachable or not configured —{' '}
          <a href="/api/health" className="text-accent hover:underline">/api/health</a> says which,
          in one line.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={reset}
          className="border border-ink px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Try again
        </button>
        <a
          href="/api/health"
          className="border border-line px-4 py-2 text-[13px] text-muted no-underline transition-colors hover:text-ink"
        >
          Check health
        </a>
      </div>

      {error.digest && (
        <p className="font-mono text-[11px] text-muted">
          Digest {error.digest} — search this in your host&rsquo;s runtime logs for the real stack trace.
        </p>
      )}
    </div>
  );
}
