'use client';

/**
 * The places this site wants to be found in.
 *
 * Lifted out of the optimiser so it can sit in its own card, ahead of both
 * tools that use it. The grader asks "does this page serve these places well
 * enough to rank there"; the optimiser rewrites the ones that don't. Those are
 * two halves of the same question, and the list they work from should be typed
 * once, up front, not owned by whichever feature happened to need it first.
 *
 * Each tool keeps its *own* tick marks over this shared list, because grading
 * every page against six cities and rewriting one page for one city are
 * different-sized jobs.
 */

import { useState } from 'react';

export interface LocationRow {
  id: number;
  label: string;
}

export function PlacesBoard({
  siteId, locations, onChange,
}: {
  siteId: number;
  locations: LocationRow[];
  onChange: (next: LocationRow[]) => void;
}) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const value = label.trim();
    if (!value) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, label: value }),
      });
      const data = await res.json() as { location?: LocationRow; error?: string };
      if (!res.ok || !data.location) {
        setError(data.error ?? 'That location could not be saved.');
      } else {
        const loc = data.location;
        onChange(locations.some((l) => l.id === loc.id)
          ? locations
          : [...locations, loc].sort((a, b) => a.label.localeCompare(b.label)));
        setLabel('');
      }
    } catch { setError('Could not save that location.'); }
    setBusy(false);
  }

  async function remove(id: number) {
    setBusy(true); setError(null);
    try {
      await fetch(`/api/locations?siteId=${siteId}&id=${id}`, { method: 'DELETE' });
      onChange(locations.filter((l) => l.id !== id));
    } catch { setError('Could not remove that location.'); }
    setBusy(false);
  }

  return (
    <div>
      <h3 className="text-[13.5px] font-medium text-ink">Where do you want to be found?</h3>
      <p className="mt-1 max-w-[80ch] text-[12.5px] leading-relaxed text-muted">
        Add each town, city or region you serve. Both tools in card 03 work from this list, and so
        does rank tracking — a place added here only has to be typed once. Leave it empty to grade
        without any location angle at all.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
          placeholder="Austin, Texas"
          aria-label="Add a location"
          className="min-w-[220px] flex-1 border border-line bg-ground px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
        />
        <button
          onClick={() => void add()}
          disabled={busy || !label.trim()}
          className="border border-ink bg-ink px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Add location
        </button>
      </div>

      {error && <p className="mt-2 text-[12.5px] text-blocker">{error}</p>}

      {locations.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {locations.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-2 border border-line px-2.5 py-1 text-[12.5px] text-ink"
            >
              {l.label}
              <button
                onClick={() => void remove(l.id)}
                aria-label={`Remove ${l.label}`}
                disabled={busy}
                className="text-muted hover:text-blocker disabled:opacity-40"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tick marks over the shared list, for one tool.
 *
 * Deliberately a separate component from the board above: removing a place is a
 * destructive, site-wide act, and choosing whether this run considers it is not.
 * Putting both on the same chip is how someone deletes Austin while meaning to
 * untick it.
 */
export function LocationFilter({
  locations, picked, onToggle, onAll, onNone, label, hint,
}: {
  locations: LocationRow[];
  picked: Set<number>;
  onToggle: (id: number) => void;
  onAll: () => void;
  onNone: () => void;
  label: string;
  hint: string;
}) {
  if (locations.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border border-line bg-ground p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <span className="flex gap-2">
          <button onClick={onAll} className="text-[11.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Select all
          </button>
          <button onClick={onNone} className="text-[11.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Clear
          </button>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {locations.map((l) => {
          const on = picked.has(l.id);
          return (
            <button
              key={l.id}
              onClick={() => onToggle(l.id)}
              aria-pressed={on}
              className={'border px-2.5 py-1 text-[12.5px] transition-colors '
                + (on ? 'border-ink bg-ink text-ground' : 'border-line text-muted hover:border-ink hover:text-ink')}
            >
              {l.label}
            </button>
          );
        })}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted">{hint}</p>
    </div>
  );
}
