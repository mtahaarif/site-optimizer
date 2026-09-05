/**
 * Alert delivery.
 *
 * Three channels, tried in order of what is configured. All are free tiers or
 * free outright, and all are plain HTTPS calls — no SDK, no dependency.
 *
 *   SendGrid  100 emails/day free forever   SENDGRID_API_KEY
 *   Resend    100 emails/day, 3k/month free RESEND_API_KEY
 *   Webhook   Slack / Discord / anything    ALERT_WEBHOOK_URL
 *   Console   always on, the fallback
 *
 * Every attempt is written to the alerts table whether it succeeded or not, so
 * a silent delivery failure is visible in the dashboard rather than invisible.
 */
import { run } from '../db/index.ts';

export type AlertKind = 'down' | 'recovered' | 'ssl_expiring' | 'rank_drop' | 'backlink_lost';

export interface Alert {
  kind: AlertKind;
  subject: string;
  /** plain text body; the HTML email wraps this */
  body: string;
  siteId?: number;
  incidentId?: number;
}

export interface DeliveryResult {
  channel: string;
  ok: boolean;
  error: string | null;
}

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

export function alertChannelsConfigured(): string[] {
  const out: string[] = [];
  if (env('SENDGRID_API_KEY') && env('ALERT_EMAIL_TO')) out.push('sendgrid');
  if (env('RESEND_API_KEY') && env('ALERT_EMAIL_TO')) out.push('resend');
  if (env('ALERT_WEBHOOK_URL')) out.push('webhook');
  return out;
}

// ---------------------------------------------------------------------------

async function sendViaSendGrid(alert: Alert): Promise<DeliveryResult> {
  const key = env('SENDGRID_API_KEY')!;
  const to = env('ALERT_EMAIL_TO')!;
  const from = env('ALERT_EMAIL_FROM') ?? to;

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: 'SiteChecker' },
        subject: alert.subject,
        content: [
          { type: 'text/plain', value: alert.body },
          { type: 'text/html', value: htmlBody(alert) },
        ],
      }),
    });
    // SendGrid returns 202 with an empty body on success.
    if (res.status === 202) return { channel: 'sendgrid', ok: true, error: null };
    const detail = await res.text();
    return { channel: 'sendgrid', ok: false, error: `HTTP ${res.status}: ${detail.slice(0, 300)}` };
  } catch (err) {
    return { channel: 'sendgrid', ok: false, error: (err as Error).message };
  }
}

async function sendViaResend(alert: Alert): Promise<DeliveryResult> {
  const key = env('RESEND_API_KEY')!;
  const to = env('ALERT_EMAIL_TO')!;
  const from = env('ALERT_EMAIL_FROM') ?? 'onboarding@resend.dev';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: alert.subject, text: alert.body, html: htmlBody(alert) }),
    });
    if (res.ok) return { channel: 'resend', ok: true, error: null };
    return { channel: 'resend', ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
  } catch (err) {
    return { channel: 'resend', ok: false, error: (err as Error).message };
  }
}

/**
 * Slack and Discord both accept a JSON POST with a `text`/`content` field, so
 * one payload carrying both keys works for either without configuration.
 */
async function sendViaWebhook(alert: Alert): Promise<DeliveryResult> {
  const url = env('ALERT_WEBHOOK_URL')!;
  const text = `*${alert.subject}*\n${alert.body}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text, username: 'SiteChecker' }),
    });
    if (res.ok) return { channel: 'webhook', ok: true, error: null };
    return { channel: 'webhook', ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { channel: 'webhook', ok: false, error: (err as Error).message };
  }
}

function htmlBody(alert: Alert): string {
  const colour = alert.kind === 'recovered' ? '#12655a' : '#a8201a';
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  return `<div style="font-family:system-ui,sans-serif;max-width:560px">
<div style="border-left:4px solid ${colour};padding:12px 16px;background:#f6f8f9">
<h2 style="margin:0 0 8px;font-size:17px;color:${colour}">${esc(alert.subject)}</h2>
<pre style="margin:0;font-family:ui-monospace,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;color:#0f1a21">${esc(alert.body)}</pre>
</div>
<p style="margin-top:14px;font-size:11px;color:#6b808f">Sent by SiteChecker</p>
</div>`;
}

// ---------------------------------------------------------------------------

/**
 * Deliver to every configured channel. Sending to all of them rather than the
 * first that works is deliberate: if email is the only channel and the provider
 * is having an outage, a down alert would vanish silently.
 */
export async function sendAlert(alert: Alert): Promise<DeliveryResult[]> {
  const configured = alertChannelsConfigured();
  const results: DeliveryResult[] = [];

  if (configured.includes('sendgrid')) results.push(await sendViaSendGrid(alert));
  if (configured.includes('resend')) results.push(await sendViaResend(alert));
  if (configured.includes('webhook')) results.push(await sendViaWebhook(alert));

  if (results.length === 0) {
    // Nothing configured: still record it and print, so the alert is not lost.
    console.log(`\n[ALERT] ${alert.subject}\n${alert.body}\n`);
    results.push({ channel: 'console', ok: true, error: null });
  }

  const now = Date.now();
  for (const r of results) {
    run(
      `INSERT INTO alerts (site_id, incident_id, kind, channel, sent_at, ok, subject, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      alert.siteId ?? null, alert.incidentId ?? null, alert.kind, r.channel,
      now, r.ok ? 1 : 0, alert.subject, r.error ?? alert.body.slice(0, 500),
    );
  }
  return results;
}
