'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Re-checks every saved phrase's position and records a fresh data point. */
export function RefreshTracked() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/rank/track', { method: 'POST' });
      const data = await res.json() as { checked?: number; skipped?: number; error?: string };
      if (!res.ok) { setNote(data.error ?? 'Could not refresh.'); }
      else {
        setNote(`Updated ${data.checked ?? 0} phrase${data.checked === 1 ? '' : 's'}` + (data.skipped ? `, ${data.skipped} skipped` : ''));
        router.refresh();
      }
    } catch {
      setNote('Could not refresh.');
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-3">
      {note && <span className="text-[11px] text-muted">{note}</span>}
      <button onClick={refresh} disabled={busy}
        className="border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40">
        {busy ? 'Updating…' : 'Update positions'}
      </button>
    </div>
  );
}
