/**
 * The "what this page is telling you" block that closes each dashboard screen.
 *
 * Every screen here is mostly numbers, and a number with no explanation is the
 * one thing a crawler — and a new user — cannot interpret. Stating what each
 * figure means and what to do about it is the readable half of the page, and it
 * is what lifts these routes above the thin-content threshold our own audit
 * applies to everyone else's.
 */
export function PageNotes({
  title, intro, items, footnote,
}: {
  title: string;
  intro: React.ReactNode;
  items: Array<{ term: string; body: React.ReactNode }>;
  footnote?: React.ReactNode;
}) {
  return (
    <section className="border border-line bg-surface px-6 py-5">
      <h2 className="text-[15px] font-medium text-ink">{title}</h2>
      <p className="mt-2 max-w-[86ch] text-[13px] leading-relaxed text-muted">{intro}</p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {items.map((i) => (
          <li key={i.term} className="max-w-[86ch] border-l-2 border-line pl-3 text-[13px] leading-relaxed text-muted">
            <strong className="font-medium text-ink">{i.term}</strong> — {i.body}
          </li>
        ))}
      </ul>
      {footnote && (
        <p className="mt-4 max-w-[86ch] text-[12.5px] leading-relaxed text-muted">{footnote}</p>
      )}
    </section>
  );
}
