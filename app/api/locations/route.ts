import { NextResponse } from 'next/server';
import { addLocation, listLocations, removeLocation } from '@/src/core/locations/store.ts';

/** GET /api/locations?siteId=1 — the places this site is targeting. */
export async function GET(req: Request) {
  const siteId = Number(new URL(req.url).searchParams.get('siteId'));
  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: 'A siteId is required.' }, { status: 400 });
  }
  return NextResponse.json({ locations: await listLocations(siteId) });
}

/** POST { siteId, label } — add one, or reactivate it if it was removed before. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const siteId = Number(body['siteId']);
  const label = String(body['label'] ?? '').trim();
  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: 'A siteId is required.' }, { status: 400 });
  }
  if (!label) return NextResponse.json({ error: 'Enter a place, e.g. "Austin, Texas".' }, { status: 400 });
  if (label.length > 120) return NextResponse.json({ error: 'That location name is too long.' }, { status: 400 });

  const location = await addLocation(siteId, label);
  if (!location) return NextResponse.json({ error: 'That location could not be saved.' }, { status: 400 });
  return NextResponse.json({ location });
}

/** DELETE ?siteId=1&id=2 */
export async function DELETE(req: Request) {
  const q = new URL(req.url).searchParams;
  const siteId = Number(q.get('siteId'));
  const id = Number(q.get('id'));
  if (!Number.isFinite(siteId) || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'siteId and id are required.' }, { status: 400 });
  }
  await removeLocation(siteId, id);
  return NextResponse.json({ ok: true });
}
