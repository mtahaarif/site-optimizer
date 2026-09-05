'use client';

import { useState } from 'react';

/**
 * Plain-English setup steps, collapsed by default so a connected account never
 * sees them. No jargon beyond the two values the user actually has to paste.
 */
export function ConnectGuide({ kind }: { kind: 'gsc' | 'ga4' }) {
  const [open, setOpen] = useState(false);

  const steps = kind === 'gsc'
    ? [
      'In Google Cloud, create a service account and download its JSON key.',
      'Enable the Search Console API for that project.',
      'In Search Console, open Settings → Users and permissions and add the service account’s email as a Full or Restricted user.',
      'Save the key and your property address in .env.local, then restart.',
    ]
    : [
      'Use the same service account you created for Search Console (or make one).',
      'Enable the Google Analytics Data API for that project.',
      'In Analytics, open Admin → Property access management and add the service account’s email as a Viewer.',
      'Save your property number in .env.local, then restart.',
    ];

  const env = kind === 'gsc'
    ? 'GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"…","private_key":"…"}\nGSC_SITE_URL=https://yourbusiness.com/'
    : 'GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"…","private_key":"…"}\nGA4_PROPERTY_ID=123456789';

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button onClick={() => setOpen(!open)}
        className="text-[12.5px] font-medium text-ink underline-offset-2 hover:underline">
        {open ? 'Hide setup steps' : 'How do I connect this?'}
      </button>
      {open && (
        <div className="mt-3">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-muted">
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <pre className="scroll-x mt-3 border border-line bg-ground p-3 font-mono text-[11.5px] leading-relaxed text-ink">
{env}
          </pre>
          <p className="mt-2 text-[12px] text-muted">
            Your credentials stay on this machine — they are read from your local settings file and
            never sent anywhere except Google.
          </p>
        </div>
      )}
    </div>
  );
}
