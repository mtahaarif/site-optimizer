import { NextResponse } from 'next/server';
import {
  accountEmailOf, reusableServiceAccount, readIntegration,
} from '@/src/core/integrations/store.ts';
import { listGa4Properties, listGscProperties } from '@/src/core/integrations/verify.ts';

/**
 * "Which properties can this key see?" — asked before anything is saved.
 *
 * This exists to delete a whole class of setup failure. The property string has
 * to match Google's exactly: `sc-domain:example.com` and `https://example.com/`
 * are different properties, and a GA4 measurement id (G-XXXXXXX) is not a
 * property number at all. Typed by hand, those are a coin flip that only
 * resolves when a query fails hours later. Picked from a list Google itself
 * returned, they cannot be wrong.
 *
 * Returns the account email and the property list — no part of the key comes
 * back out.
 */
export async function POST(req: Request) {
  let body: { provider?: unknown; serviceAccountJson?: unknown; accountSource?: unknown };
  try { body = await req.json() as typeof body; }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const provider = body.provider;
  // PageSpeed has no properties to discover — its key is the whole connection.
  if (provider !== 'gsc' && provider !== 'ga4') {
    return NextResponse.json({ error: 'Unknown integration.' }, { status: 400 });
  }

  // Either a freshly pasted key, the one already connected for the other
  // product, or this integration's own — enough that re-picking a property
  // never means finding the JSON file again.
  const pasted = typeof body.serviceAccountJson === 'string' ? body.serviceAccountJson.trim() : '';
  let json = pasted;
  if (!json && body.accountSource === 'reuse') {
    json = (await reusableServiceAccount(provider))?.json ?? '';
  }
  if (!json) {
    json = (await readIntegration(provider))?.config['serviceAccountJson'] ?? '';
  }
  if (!json) {
    return NextResponse.json({ error: 'Paste the service-account JSON key file.' }, { status: 400 });
  }

  try {
    const result = provider === 'gsc'
      ? await listGscProperties(json)
      : await listGa4Properties(json);

    if (!result.ok) {
      // The account email is still worth returning on failure: "no properties
      // for x@y.iam.gserviceaccount.com" is the message that tells someone
      // which email to go and grant access to.
      return NextResponse.json(
        { error: result.error, account: accountEmailOf(json) },
        { status: 400 },
      );
    }
    return NextResponse.json(result.value);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
