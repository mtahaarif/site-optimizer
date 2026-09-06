'use client';

/**
 * Three cards: what the grading said, the places you serve, and the work.
 *
 * The two tools — grade and rewrite — share one card and switch by tab rather
 * than stacking. Stacked, the page-by-page table stands between you and the
 * rewriter, so on a site with a hundred pages reaching the second tool means
 * scrolling past the whole of the first. They also operate on the same pages
 * and the same list of places, so a tab is the honest shape: two views of one
 * job, not two jobs.
 *
 * The inactive tab stays mounted and hidden. Unmounting it would throw away
 * whatever is in flight there — a set of ticked pages, a batch of generated
 * prompts — which is a bad trade for a DOM that is already built.
 *
 * Shared state lives here because it genuinely spans the cards: the places list
 * feeds both tools, and the summary in card 01 reports on whatever is ticked in
 * the grader in card 03.
 */

import { useState } from 'react';
import { Section } from '../panel.tsx';
import { PlacesBoard, type LocationRow } from './places.tsx';
import { ContentGrader, type GradeRow, type PageRow } from './grader.tsx';
import { LocationOptimiser, type CellRow, type OptimiserPage } from './locations.tsx';
import { GradeSummary } from './summary.tsx';

type Tab = 'grade' | 'rewrite';

export function ContentWorkbench({
  siteId, crawlId, host, pages, grades, cells, locations: initialLocations, aiConfigured,
}: {
  siteId: number;
  crawlId: string | null;
  host: string;
  pages: PageRow[];
  /** Every stored grade for this audit, worst first. */
  grades: GradeRow[];
  cells: CellRow[];
  locations: LocationRow[];
  aiConfigured: boolean;
}) {
  const [locations, setLocations] = useState<LocationRow[]>(initialLocations);
  const [tab, setTab] = useState<Tab>('grade');

  // Separate tick marks per tool, over one shared list.
  const [graderLocs, setGraderLocs] = useState<Set<number>>(new Set());
  const [optimiserLocs, setOptimiserLocs] = useState<Set<number>>(
    new Set(initialLocations.map((l) => l.id)),
  );
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());

  const byUrl: Record<string, GradeRow> = {};
  for (const g of grades) byUrl[g.url] = g;

  /** Removing a place must not leave it ticked in either tool. */
  function onLocationsChange(next: LocationRow[]) {
    const live = new Set(next.map((l) => l.id));
    setGraderLocs((prev) => new Set([...prev].filter((id) => live.has(id))));
    setOptimiserLocs((prev) => {
      const kept = [...prev].filter((id) => live.has(id));
      // A place just added is one the user means to work on, so it starts
      // ticked for the optimiser — which is location-shaped by nature.
      const added = next.filter((l) => !locations.some((o) => o.id === l.id)).map((l) => l.id);
      return new Set([...kept, ...added]);
    });
    setLocations(next);
  }

  const toggle = (set: (fn: (prev: Set<number>) => Set<number>) => void) => (id: number) =>
    set((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const allIds = () => new Set(locations.map((l) => l.id));

  const graded = grades.length;
  const gradeable = pages.filter((p) => p.hasSnapshot).length;

  return (
    <>
      <Section
        n={1}
        title="Summary"
        question="The sitewide picture, then a write-up of each page you tick in the grader below."
        status={graded ? `${graded} graded` : 'None graded yet'}
        tone={graded ? 'good' : 'neutral'}
      >
        <div className="px-6 py-5">
          <GradeSummary host={host} grades={grades} selected={selectedPages} />
        </div>
      </Section>

      <Section
        n={2}
        title="The places you serve"
        question="Optional, and shared by everything below. Add a town or city once and both tools can work against it — as can rank tracking."
        status={locations.length
          ? `${locations.length} ${locations.length === 1 ? 'location' : 'locations'}`
          : 'No locations yet'}
        tone={locations.length ? 'good' : 'neutral'}
      >
        <div className="px-6 py-5">
          <PlacesBoard siteId={siteId} locations={locations} onChange={onLocationsChange} />
        </div>
      </Section>

      <Section
        n={3}
        title="Grade and rewrite"
        question={tab === 'grade'
          ? 'Each page is read once and scored on six dimensions, with specific fixes. Results are saved, so re-opening never re-spends.'
          : 'See which pages already read as serving each place, then get advice or a full draft — from the AI directly, or as a prompt you run yourself.'}
        status={tab === 'grade'
          ? `${graded} of ${gradeable} graded`
          : `${locations.length} ${locations.length === 1 ? 'place' : 'places'}`}
        tone={tab === 'grade' ? (graded ? 'good' : 'neutral') : (locations.length ? 'good' : 'neutral')}
      >
        <div role="tablist" aria-label="Content tools" className="flex border-b border-line px-6">
          <TabButton id="grade" active={tab} onSelect={setTab}>Grade your pages</TabButton>
          <TabButton id="rewrite" active={tab} onSelect={setTab}>Rewrite for a place</TabButton>
        </div>

        <div
          role="tabpanel"
          id="panel-grade"
          aria-labelledby="tab-grade"
          hidden={tab !== 'grade'}
          className={tab === 'grade' ? 'px-6 py-5' : 'hidden'}
        >
          {!aiConfigured ? (
            <div className="border border-warning bg-ground p-5">
              <h3 className="text-[14px] font-medium text-ink">Connect an AI key to grade your writing</h3>
              <p className="mt-1.5 max-w-[76ch] text-[13px] leading-relaxed text-muted">
                Add one key to <span className="font-mono text-ink">.env.local</span> and restart. It
                stays on this machine and is only sent to the provider you choose.
              </p>
              <pre className="scroll-x mt-3 border border-line bg-surface p-3 font-mono text-[11.5px] text-ink">
{`GEMINI_API_KEY=…        # used for grading by default
GROQ_API_KEY=gsk_…      # fastest per page
ANTHROPIC_API_KEY=sk-…  # strongest judgement (paid)`}
              </pre>
            </div>
          ) : pages.length === 0 || !crawlId ? (
            <p className="text-[13.5px] text-muted">No pages to grade in the latest audit for this website.</p>
          ) : (
            <ContentGrader
              crawlId={crawlId}
              siteId={siteId}
              pages={pages}
              grades={byUrl}
              configured={aiConfigured}
              locations={locations}
              pickedLocations={graderLocs}
              onToggleLocation={toggle(setGraderLocs)}
              onAllLocations={() => setGraderLocs(allIds())}
              onNoLocations={() => setGraderLocs(new Set())}
              selected={selectedPages}
              onSelectedChange={setSelectedPages}
            />
          )}
        </div>

        <div
          role="tabpanel"
          id="panel-rewrite"
          aria-labelledby="tab-rewrite"
          hidden={tab !== 'rewrite'}
          className={tab === 'rewrite' ? 'px-6 py-5' : 'hidden'}
        >
          {locations.length === 0 ? (
            <p className="text-[13.5px] leading-relaxed text-muted">
              Add a place in card 02 to use this. It rewrites a page to genuinely serve somewhere
              specific, which needs somewhere specific to aim at.
            </p>
          ) : (
            <LocationOptimiser
              siteId={siteId}
              crawlId={crawlId}
              pages={pages.map((p) => ({ url: p.url, title: p.title, hasSnapshot: p.hasSnapshot } satisfies OptimiserPage))}
              locations={locations}
              cells={cells}
              aiConfigured={aiConfigured}
              pickedLocs={optimiserLocs}
              onToggleLocation={toggle(setOptimiserLocs)}
              onAllLocations={() => setOptimiserLocs(allIds())}
              onNoLocations={() => setOptimiserLocs(new Set())}
            />
          )}
        </div>
      </Section>
    </>
  );
}

function TabButton({
  id, active, onSelect, children,
}: {
  id: Tab;
  active: Tab;
  onSelect: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const on = active === id;
  return (
    <button
      role="tab"
      id={`tab-${id}`}
      aria-selected={on}
      aria-controls={`panel-${id}`}
      onClick={() => onSelect(id)}
      // The underline sits on the section's own bottom border, so the active
      // tab reads as continuous with the panel below it.
      className={'-mb-px border-b-2 px-4 py-3 text-[13px] font-medium transition-colors '
        + (on
          ? 'border-ink text-ink'
          : 'border-transparent text-muted hover:text-ink')}
    >
      {children}
    </button>
  );
}
