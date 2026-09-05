'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Add a website as a project, then jump to its page to run the first audit. */
export function AddProject() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as { id?: number; error?: string };
      if (!res.ok || !data.id) { setError(data.error ?? 'Could not add that website.'); setBusy(false); return; }
      router.push(`/project/${data.id}`);
    } catch {
      setError('Could not add that website.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-line bg-surface p-5">
      <label className="block text-[12px] font-medium text-muted" htmlFor="new-site">Add a website</label>
      <div className="mt-1.5 flex flex-col gap-3 sm:flex-row">
        <input
          id="new-site"
          className="flex-1 border border-line bg-ground px-2.5 py-2 text-[15px] text-ink outline-none focus:border-ink"
          placeholder="e.g. yourbusiness.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="url"
          required
          disabled={busy}
        />
        <button type="submit" disabled={busy || !url.trim()}
          className="border border-ink bg-ink px-6 py-2 text-[14px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-40">
          {busy ? 'Adding…' : 'Add project'}
        </button>
      </div>
      {error && <p className="mt-3 border border-blocker px-3 py-2 text-[13px] text-blocker">{error}</p>}
    </form>
  );
}
