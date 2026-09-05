/**
 * Shared page chrome for the AI-visibility and content pages: a numbered
 * section with a plain-English question and a status chip on the right, so both
 * pages scan the same way even though they stay separate.
 */

export function Section({
  n, title, question, status, tone = 'neutral', children,
}: {
  n?: number;
  title: string;
  question: string;
  status?: string;
  tone?: 'good' | 'bad' | 'neutral';
  children: React.ReactNode;
}) {
  const color = tone === 'good' ? 'rgb(var(--opportunity))'
    : tone === 'bad' ? 'rgb(var(--blocker))' : 'rgb(var(--muted))';
  return (
    <section className="border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4">
        <div className="flex items-baseline gap-3">
          {n !== undefined && (
            <span className="font-mono text-[11px] text-muted">{String(n).padStart(2, '0')}</span>
          )}
          <div>
            <h2 className="text-[17px] font-medium text-ink">{title}</h2>
            <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-relaxed text-muted">{question}</p>
          </div>
        </div>
        {status && <span className="text-[13px] font-medium" style={{ color }}>{status}</span>}
      </div>
      {children}
    </section>
  );
}

/** A 0–max bar with a caption, used for both AEO pillars and content dimensions. */
export function MeterBar({
  label, got, max, measured = true, detail,
}: {
  label: string; got: number; max: number; measured?: boolean; detail?: string;
}) {
  const pct = max > 0 ? (got / max) * 100 : 0;
  const color = !measured ? 'rgb(var(--line-strong))'
    : pct >= 75 ? 'rgb(var(--opportunity))'
      : pct >= 45 ? 'rgb(var(--warning))' : 'rgb(var(--blocker))';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-ink">{label}</span>
        <span className="tnum font-mono text-[11.5px]" style={{ color }}>
          {measured ? `${Math.round(got)}/${max}` : 'not measured'}
        </span>
      </div>
      <div className="mt-1.5 h-[6px] bg-surface-2">
        <div className="h-full" style={{ width: `${measured ? pct : 0}%`, background: color }} />
      </div>
      {detail && <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{detail}</p>}
    </div>
  );
}

export const ACTION_TONE = {
  critical: { color: 'rgb(var(--blocker))', label: 'Fix first' },
  warning: { color: 'rgb(var(--warning))', label: 'Worth doing' },
  opportunity: { color: 'rgb(var(--muted))', label: 'Nice to have' },
} as const;

export function ActionRow({
  i, severity, title, detail,
}: {
  i: number;
  severity: keyof typeof ACTION_TONE;
  title: string;
  detail: string;
}) {
  const s = ACTION_TONE[severity];
  return (
    <li className="flex gap-4 px-6 py-4">
      <span className="tnum mt-0.5 font-mono text-[12px] text-muted">{i + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[14.5px] font-medium text-ink">{title}</h3>
          <span className="border px-1.5 py-px text-[10px] uppercase tracking-[0.08em]"
            style={{ color: s.color, borderColor: s.color }}>{s.label}</span>
        </div>
        <p className="mt-1 max-w-[86ch] break-words text-[13px] leading-relaxed text-muted">{detail}</p>
      </div>
    </li>
  );
}

/** Website switcher shared by both pages. */
export function SitePicker({
  projects, selectedId, base,
}: {
  projects: Array<{ siteId: number; origin: string }>;
  selectedId: number;
  base: string;
}) {
  if (projects.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-muted">Website:</span>
      {projects.map((p) => (
        <a key={p.siteId} href={`${base}?site=${p.siteId}`}
          className={'border px-3 py-1.5 text-[12.5px] no-underline transition-colors ' +
            (p.siteId === selectedId ? 'border-ink bg-ink text-ground' : 'border-line text-muted hover:border-ink hover:text-ink')}>
          {p.origin.replace(/^https?:\/\//, '')}
        </a>
      ))}
    </div>
  );
}
