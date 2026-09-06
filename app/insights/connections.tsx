'use client';

/**
 * Connecting Search Console, Analytics and PageSpeed Insights.
 *
 * These were environment variables, which meant connecting an account was "edit
 * a file, restart the server" and pointing the tool at a different client's
 * property was the same thing again. Here it is a button.
 *
 * The Google flow is two steps on purpose. Step one takes the service-account
 * key and asks Google which properties that key can actually read; step two is
 * a list to pick from. Nothing about the property is ever typed, which removes
 * the two mistakes that made the old setup so unforgiving — a property address
 * that has to match Google's string exactly, and a GA4 measurement id used
 * where a property number was wanted. Both are impossible to get wrong when the
 * value comes from Google's own answer.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type Provider = 'gsc' | 'ga4' | 'pagespeed';

export interface IntegrationStatus {
  provider: Provider;
  name: string;
  connected: boolean;
  source: 'connected' | 'environment' | null;
  account: string | null;
  label: string | null;
  verifiedAt: number | null;
  lastError: string | null;
  removable: boolean;
  encrypted: boolean;
  storable: boolean;
}

interface GscProperty { siteUrl: string; permission: string }
interface Ga4Property { propertyId: string; displayName: string; account: string }

const BLURB: Record<Provider, string> = {
  gsc: 'How you appear in Google search results.',
  ga4: 'What visitors do once they arrive.',
  pagespeed: 'Core Web Vitals measured from real Chrome users.',
};

/** What the key is for, in the order someone would go and get it. */
const STEPS: Record<Provider, string[]> = {
  gsc: [
    'In Google Cloud, create a service account and download its JSON key.',
    'Enable the Search Console API for that project.',
    'In Search Console, open Settings → Users and permissions and add the service account’s email as a Full or Restricted user.',
    'Paste the key below — the property list is fetched for you.',
  ],
  ga4: [
    'Use the same service account as Search Console, or create one.',
    'Enable the Google Analytics Data API, and the Admin API if you want the property list fetched.',
    'In Analytics, open Admin → Property access management and add the service account’s email as a Viewer.',
    'Paste the key below, or reuse the one already connected.',
  ],
  pagespeed: [
    'In Google Cloud, open APIs & Services → Library and enable the PageSpeed Insights API.',
    'Go to Credentials → Create credentials → API key.',
    'Restrict the key by API rather than by HTTP referrer — a referrer-restricted key cannot be used from a server.',
    'Paste it below.',
  ],
};

const ago = (ms: number): string => {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
};

function Status({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: ok ? 'rgb(var(--opportunity))' : 'rgb(var(--muted))',
        borderColor: ok ? 'rgb(var(--opportunity))' : 'rgb(var(--line))',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: ok ? 'rgb(var(--opportunity))' : 'rgb(var(--muted))' }}
      />
      {ok ? 'Connected' : 'Not connected'}
    </span>
  );
}

const btn = 'border px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50';
const primary = btn + ' border-accent text-accent hover:bg-accent/10';
const secondary = btn + ' border-line text-ink hover:bg-surface-2';
const field = 'w-full border border-line bg-ground px-3 py-2 font-mono text-[12px] text-ink '
  + 'outline-none focus:border-accent';

export function Connections({
  integrations, reusableAccounts,
}: {
  integrations: IntegrationStatus[];
  /**
   * Per provider, the service-account email some *other* integration is already
   * using — offered as a one-click reuse, since Search Console and Analytics
   * are nearly always the same account.
   */
  reusableAccounts: Partial<Record<Provider, string | null>>;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {integrations.map((i) => (
        <Card key={i.provider} status={i} reusableAccount={reusableAccounts[i.provider] ?? null} />
      ))}
    </div>
  );
}

/** Which key a connect attempt should use. Mirrors the API's `accountSource`. */
type AccountSource = 'pasted' | 'reuse' | 'existing';

function Card({
  status, reusableAccount,
}: {
  status: IntegrationStatus;
  reusableAccount: string | null;
}) {
  const router = useRouter();
  const { provider } = status;

  // 'idle' shows the current state; the rest are the connect flow.
  const [mode, setMode] = useState<'idle' | 'key' | 'pick'>('idle');
  const [json, setJson] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<null | 'discover' | 'connect' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const [account, setAccount] = useState<string | null>(null);
  const [gscProps, setGscProps] = useState<GscProperty[] | null>(null);
  const [ga4Props, setGa4Props] = useState<Ga4Property[] | null>(null);
  const [picked, setPicked] = useState('');
  const [manual, setManual] = useState('');
  // Carried from the discover step into the connect step, so "change property"
  // keeps this integration's own account rather than adopting the other one's.
  const [accountSource, setAccountSource] = useState<AccountSource>('pasted');

  const isGoogleAccount = provider === 'gsc' || provider === 'ga4';
  const canReuse = isGoogleAccount && !!reusableAccount;

  function reset() {
    setMode('idle'); setJson(''); setApiKey(''); setError(null);
    setGscProps(null); setGa4Props(null); setPicked(''); setManual(''); setAccount(null);
    setAccountSource('pasted');
  }

  /** Step one: hand the key to Google and ask what it can see. */
  async function discover(source: AccountSource) {
    setBusy('discover'); setError(null); setNote(null);
    setAccountSource(source);
    try {
      const res = await fetch('/api/integrations/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          serviceAccountJson: source === 'pasted' ? json : '',
          accountSource: source,
        }),
      });
      const data = await res.json() as {
        account?: string; properties?: GscProperty[] | Ga4Property[]; error?: string;
      };

      if (data.account) setAccount(data.account);

      if (!res.ok || !data.properties) {
        setError(data.error ?? 'Google would not return the property list.');
        // A key that authenticated but whose property list is unavailable is
        // still usable — the Admin API being off is the usual cause, and
        // typing the property number is a reasonable way past it.
        if (provider === 'ga4' && data.account) { setGa4Props([]); setMode('pick'); }
        return;
      }

      if (provider === 'gsc') setGscProps(data.properties as GscProperty[]);
      else setGa4Props(data.properties as Ga4Property[]);
      setPicked(
        provider === 'gsc'
          ? (data.properties as GscProperty[])[0]?.siteUrl ?? ''
          : (data.properties as Ga4Property[])[0]?.propertyId ?? '',
      );
      setMode('pick');
    } catch {
      setError('Could not reach Google. Check this machine’s connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  /** Step two: save, once Google has confirmed access to the chosen property. */
  async function connect(source: AccountSource) {
    setBusy('connect'); setError(null);

    const chosen = (manual.trim() || picked).trim();
    const label = provider === 'ga4'
      ? ga4Props?.find((p) => p.propertyId === chosen)?.displayName
      : undefined;

    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          serviceAccountJson: source === 'pasted' ? json : '',
          accountSource: source,
          ...(provider === 'gsc' ? { siteUrl: chosen } : {}),
          ...(provider === 'ga4' ? { propertyId: chosen, propertyLabel: label } : {}),
          ...(provider === 'pagespeed' ? { apiKey } : {}),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'That could not be connected.'); return; }
      reset();
      router.refresh();
    } catch {
      setError('Could not save that connection.');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect'); setError(null); setNote(null);
    try {
      const res = await fetch(`/api/integrations?provider=${provider}`, { method: 'DELETE' });
      const data = await res.json() as { error?: string; note?: string | null };
      if (!res.ok) { setError(data.error ?? 'That could not be disconnected.'); return; }
      if (data.note) setNote(data.note);
      reset();
      router.refresh();
    } catch {
      setError('Could not disconnect that account.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink">{status.name}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{BLURB[provider]}</p>
        </div>
        <Status ok={status.connected} />
      </div>

      {/* ---- what is connected right now ---- */}
      {status.connected && mode === 'idle' && (
        <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
          {status.account && (
            <p className="break-all font-mono text-[11.5px] text-muted">{status.account}</p>
          )}
          {status.label && <p className="break-all text-[12.5px] text-ink">{status.label}</p>}
          <p className="text-[11.5px] text-muted">
            {status.source === 'environment'
              ? 'Set by an environment variable on this deployment'
              : status.verifiedAt
                ? `Verified with Google ${ago(status.verifiedAt)}`
                : 'Verified with Google'}
          </p>
        </div>
      )}

      {status.lastError && mode === 'idle' && (
        <p className="mt-3 border border-warning px-3 py-2 text-[12px] leading-relaxed text-warning">
          {status.lastError}
        </p>
      )}

      {note && (
        <p className="mt-3 border border-line px-3 py-2 text-[12px] leading-relaxed text-muted">
          {note}
        </p>
      )}

      {/* ---- step one: the key ---- */}
      {mode === 'key' && (
        <div className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
          {isGoogleAccount ? (
            <>
              <label className="text-[12px] font-medium text-ink" htmlFor={`${provider}-json`}>
                Service-account JSON key
              </label>
              <textarea
                id={`${provider}-json`}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }'
                className={field + ' resize-y leading-relaxed'}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primary}
                  disabled={!json.trim() || busy !== null}
                  onClick={() => void discover('pasted')}
                >
                  {busy === 'discover' ? 'Checking with Google…' : 'Continue'}
                </button>
                {canReuse && (
                  <button
                    type="button"
                    className={secondary}
                    disabled={busy !== null}
                    onClick={() => void discover('reuse')}
                  >
                    Use {reusableAccount}
                  </button>
                )}
                <button type="button" className={secondary} disabled={busy !== null} onClick={reset}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="text-[12px] font-medium text-ink" htmlFor={`${provider}-key`}>
                PageSpeed Insights API key
              </label>
              <input
                id={`${provider}-key`}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="AIza…"
                className={field}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primary}
                  disabled={!apiKey.trim() || busy !== null}
                  onClick={() => void connect('pasted')}
                >
                  {busy === 'connect' ? 'Checking the key…' : 'Connect'}
                </button>
                <button type="button" className={secondary} disabled={busy !== null} onClick={reset}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- step two: which property ---- */}
      {mode === 'pick' && (
        <div className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
          {account && (
            <p className="break-all font-mono text-[11px] text-muted">{account}</p>
          )}

          {provider === 'gsc' && gscProps && gscProps.length > 0 && (
            <fieldset className="flex max-h-52 flex-col gap-1 overflow-y-auto">
              <legend className="mb-1 text-[12px] font-medium text-ink">
                Which property?
              </legend>
              {gscProps.map((p) => (
                <label key={p.siteUrl} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-[12.5px] hover:bg-surface-2">
                  <input
                    type="radio"
                    name={`${provider}-property`}
                    value={p.siteUrl}
                    checked={picked === p.siteUrl}
                    onChange={() => setPicked(p.siteUrl)}
                  />
                  <span className="break-all text-ink">{p.siteUrl}</span>
                </label>
              ))}
            </fieldset>
          )}

          {provider === 'ga4' && ga4Props && ga4Props.length > 0 && (
            <fieldset className="flex max-h-52 flex-col gap-1 overflow-y-auto">
              <legend className="mb-1 text-[12px] font-medium text-ink">
                Which property?
              </legend>
              {ga4Props.map((p) => (
                <label key={p.propertyId} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-[12.5px] hover:bg-surface-2">
                  <input
                    type="radio"
                    name={`${provider}-property`}
                    value={p.propertyId}
                    checked={picked === p.propertyId}
                    onChange={() => setPicked(p.propertyId)}
                  />
                  <span className="text-ink">{p.displayName}</span>
                  <span className="font-mono text-[11px] text-muted">{p.propertyId}</span>
                </label>
              ))}
            </fieldset>
          )}

          {/* The Admin API being switched off should not be a dead end. */}
          {provider === 'ga4' && ga4Props?.length === 0 && (
            <>
              <label className="text-[12px] font-medium text-ink" htmlFor={`${provider}-manual`}>
                Property number
              </label>
              <input
                id={`${provider}-manual`}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="123456789"
                className={field}
              />
              <p className="text-[11.5px] leading-relaxed text-muted">
                Analytics → Admin → Property details. It is a number, not the G-XXXXXXX
                measurement id.
              </p>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy !== null || !(manual.trim() || picked)}
              onClick={() => void connect(accountSource)}
            >
              {busy === 'connect' ? 'Confirming access…' : 'Connect'}
            </button>
            <button type="button" className={secondary} disabled={busy !== null} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 border border-warning px-3 py-2 text-[12px] leading-relaxed text-warning">
          {error}
        </p>
      )}

      {/* ---- actions ---- */}
      {mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          {!status.storable ? (
            <p className="text-[12px] leading-relaxed text-muted">
              Connect a database to save accounts from here.
            </p>
          ) : (
            <>
              <button
                type="button"
                className={status.connected ? secondary : primary}
                disabled={busy !== null}
                onClick={() => { setNote(null); setError(null); setMode('key'); }}
              >
                {status.connected ? 'Use a different account' : 'Connect'}
              </button>
              {status.connected && isGoogleAccount && status.removable && (
                <button
                  type="button"
                  className={secondary}
                  disabled={busy !== null}
                  onClick={() => void discover('existing')}
                >
                  {busy === 'discover' ? 'Loading…' : 'Change property'}
                </button>
              )}
              {status.removable && (
                <button
                  type="button"
                  className={secondary}
                  disabled={busy !== null}
                  onClick={() => void disconnect()}
                >
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ---- help, collapsed: a connected account never has to see it ---- */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setHelp(!help)}
          className="text-[12.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {help ? 'Hide setup steps' : 'Where do I get this?'}
        </button>
        {help && (
          <div className="mt-2">
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[12.5px] leading-relaxed text-muted">
              {STEPS[provider].map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              {status.encrypted ? (
                'Stored encrypted in your own database, and sent nowhere except Google.'
              ) : (
                <>
                  Stored in your own database, and sent nowhere except Google. Set{' '}
                  <code className="font-mono">INTEGRATIONS_SECRET</code> to encrypt it at rest.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
