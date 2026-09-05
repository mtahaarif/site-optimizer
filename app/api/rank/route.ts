import { checkRank, saveTrackedCheck } from '@/src/ranks/track.ts';
import type { Engine, Device } from '@/src/ranks/providers.ts';

const ENGINES: Engine[] = ['google', 'bing', 'yahoo', 'yandex'];
const DEVICES: Device[] = ['desktop', 'mobile'];

/**
 * On-demand rank check. Body: { keyword, domain, engines?, device?, country?, city? }.
 * Returns one result per engine — the position of `domain` in that SERP right now.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const keyword = String(body['keyword'] ?? '').trim();
  const domain = String(body['domain'] ?? '').trim();
  if (!keyword) return Response.json({ error: 'A keyword is required.' }, { status: 400 });
  if (!domain) return Response.json({ error: 'A domain is required.' }, { status: 400 });

  const requested = Array.isArray(body['engines']) ? (body['engines'] as unknown[]).map(String) : [];
  const engines = requested.filter((e): e is Engine => (ENGINES as string[]).includes(e));
  if (engines.length === 0) engines.push('google');

  const device = DEVICES.includes(body['device'] as Device) ? (body['device'] as Device) : 'desktop';
  const country = body['country'] ? String(body['country']).trim().toUpperCase().slice(0, 2) : null;
  const city = body['city'] ? String(body['city']).trim() : null;
  const scope = body['scope'] === 'local' ? 'local' : 'web';
  const track = body['track'] === true && scope === 'web'; // only website positions are tracked

  try {
    const input = { keyword, domain, engines, device, country, city, scope } as const;
    const results = await checkRank(input);
    let tracked = 0;
    if (track) tracked = saveTrackedCheck(input, results);
    return Response.json({ keyword, domain, device, scope, results, tracked });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
