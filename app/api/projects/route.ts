import { createProject } from '@/src/crawler/store.ts';

/** Create (or find) a project for a website. Body: { url }. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  const url = String(body['url'] ?? '').trim();
  if (!url) return Response.json({ error: 'A website address is required.' }, { status: 400 });
  try {
    const site = await createProject(url);
    return Response.json({ id: site.id, origin: site.origin });
  } catch {
    return Response.json({ error: 'That doesn’t look like a valid website address.' }, { status: 400 });
  }
}
