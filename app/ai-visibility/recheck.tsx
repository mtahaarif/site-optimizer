'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-runs the live checks. The page reads robots.txt and llms.txt on every
 * render, so refreshing the route genuinely re-fetches them rather than
 * replaying a cached answer.
 */
export function Recheck({ checkedAt }: { checkedAt: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [justDone, setJustDone] = useState(false);

  const ago = () => {
    const s = Math.round((Date.now() - checkedAt) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-muted">Checked {justDone ? 'just now' : ago()}</span>
      <button
        onClick={() => {
          startTransition(() => { router.refresh(); });
          setJustDone(true);
        }}
        disabled={pending}
        className="flex items-center gap-2 border border-line px-3.5 py-1.5 text-[12.5px] text-ink transition-colors hover:border-ink disabled:opacity-50"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={pending ? 'animate-spin' : ''}>
          <path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" />
        </svg>
        {pending ? 'Checking…' : 'Re-check'}
      </button>
    </div>
  );
}
