import { trackAll } from '@/src/ranks/track.ts';

/**
 * Re-check every saved keyword's position and record a new data point, so the
 * "tracked keywords" table stays current without touching a terminal.
 */
export async function POST() {
  try {
    const results = await trackAll();
    const checked = results.filter((r) => !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    return Response.json({ checked, skipped, total: results.length });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
