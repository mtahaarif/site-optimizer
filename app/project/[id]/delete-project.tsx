'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteProject({ siteId, origin }: { siteId: number; origin: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${siteId}`, { method: 'DELETE' });
      if (res.ok) { router.push('/projects'); router.refresh(); }
      else setBusy(false);
    } catch { setBusy(false); }
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)}
        className="border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-blocker hover:text-blocker">
        Delete project
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-muted">Delete all audits for {origin}?</span>
      <button onClick={del} disabled={busy}
        className="border border-blocker bg-blocker px-3 py-1.5 text-[12px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-40">
        {busy ? 'Deleting…' : 'Yes, delete'}
      </button>
      <button onClick={() => setConfirming(false)} disabled={busy}
        className="border border-line px-3 py-1.5 text-[12px] text-muted hover:border-ink hover:text-ink">
        Cancel
      </button>
    </div>
  );
}
