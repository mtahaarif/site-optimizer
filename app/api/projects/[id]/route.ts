import { deleteProject } from '@/src/crawler/store.ts';

/** Delete a project and all of its crawls, snapshots and tracked data. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId) || siteId <= 0) {
    return Response.json({ error: 'Invalid project' }, { status: 400 });
  }
  try {
    await deleteProject(siteId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
