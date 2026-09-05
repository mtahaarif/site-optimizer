/** Shared presentational pieces used across the dashboard. */
import type { Severity } from '@/src/core/scoring/model.ts';

export const SEVERITY_ORDER: Severity[] = ['blocker', 'critical', 'warning', 'opportunity', 'notice'];

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  critical: 'Critical',
  warning: 'Warning',
  opportunity: 'Opportunity',
  notice: 'Notice',
};

const SEVERITY_CLASS: Record<Severity, string> = {
  blocker: 'text-blocker border-blocker',
  critical: 'text-critical border-critical',
  warning: 'text-warning border-warning',
  opportunity: 'text-opportunity border-opportunity',
  notice: 'text-notice border-notice',
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={
        'inline-block shrink-0 rounded border px-1.5 py-px font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] ' +
        SEVERITY_CLASS[severity]
      }
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StatusChip({ status }: { status: 'failed' | 'passed' | 'skipped' }) {
  const cls =
    status === 'failed' ? 'text-blocker border-blocker'
      : status === 'passed' ? 'text-accent border-accent'
        : 'text-muted border-line';
  return (
    <span className={'inline-block rounded border px-1.5 py-px font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] ' + cls}>
      {status}
    </span>
  );
}

/** 0-100 score with a colour band. Bands are deliberately strict. */
export function scoreBand(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Excellent', color: 'rgb(var(--accent))' };
  if (score >= 75) return { label: 'Good', color: 'rgb(var(--accent))' };
  if (score >= 50) return { label: 'Needs work', color: 'rgb(var(--warning))' };
  if (score >= 25) return { label: 'Poor', color: 'rgb(var(--critical))' };
  return { label: 'Critical', color: 'rgb(var(--blocker))' };
}

export function ScoreDial({ score, size = 148 }: { score: number; size?: number }) {
  const band = scoreBand(score);
  const r = size / 2 - 10;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" style={{ stroke: 'rgb(var(--line))' }} strokeWidth="8"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" style={{ stroke: band.color }} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-[34px] font-bold leading-none tracking-tight" style={{ color: band.color }}>
          {score.toFixed(0)}
        </span>
        <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
          {band.label}
        </span>
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded border border-line bg-surface px-4 py-3">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="tnum mt-1 text-[22px] font-bold leading-none" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

export function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full"
        style={{ width: pct + '%', background: color ?? 'rgb(var(--accent))' }}
      />
    </div>
  );
}

export const fmtBytes = (n: number): string =>
  n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB'
    : n >= 1024 ? Math.round(n / 1024) + ' KB'
      : n + ' B';

export const fmtDuration = (ms: number): string =>
  ms >= 60_000 ? Math.floor(ms / 60_000) + 'm ' + Math.round((ms % 60_000) / 1000) + 's'
    : (ms / 1000).toFixed(1) + 's';

export const shortUrl = (url: string, max = 70): string => {
  try {
    const u = new URL(url);
    const s = u.pathname + u.search;
    const out = s === '/' ? u.hostname : s;
    return out.length > max ? out.slice(0, max - 1) + '…' : out;
  } catch {
    return url.length > max ? url.slice(0, max - 1) + '…' : url;
  }
};
