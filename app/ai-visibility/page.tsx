import { connection } from 'next/server';
import Link from 'next/link';
import { listProjects, projectCrawls, loadReport } from '@/src/crawler/store.ts';
import { analyzeAeo, generateLlmsTxt } from '@/src/core/aeo/analyze.ts';
import { gradesForCrawl } from '@/src/core/content/grade.ts';
import { ScoreDial, shortUrl } from '../ui.tsx';
import { Section, MeterBar, ActionRow, SitePicker } from '../panel.tsx';
import { LlmsFile } from './llms-file.tsx';
import { Recheck } from './recheck.tsx';
import { pageMeta } from '../meta.ts';

export const instant = false;
export const metadata = pageMeta({
  title: 'AI visibility in answer engines',
  description: 'Whether ChatGPT, Claude, Perplexity and Google’s AI answers can reach, read and understand your website — with the fixes, in order.',
  path: '/ai-visibility',
});

async function fetchText(url: string, limit = 40_000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { 'user-agent': 'SiteCheckerBot/1.0' } });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, limit);
  } catch { return null; }
}

export default async function AiVisibilityPage({
  searchParams,
}: { searchParams: Promise<{ site?: string }> }) {
  await connection();
  const { site } = await searchParams;

  const projects = (await listProjects()).filter((p) => p.crawlCount > 0);
  if (projects.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[32px] font-bold tracking-tight">AI visibility</h1>
        <p className="border border-line bg-surface p-8 text-center text-[14px] text-muted">
          Audit a website first — this page works from the pages it saved.{' '}
          <Link href="/projects" className="text-accent hover:underline">Go to projects →</Link>
        </p>
      </div>
    );
  }

  const selected = projects.find((p) => String(p.siteId) === site)
    ?? projects.slice().sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0))[0]!;

  const crawls = await projectCrawls(selected.siteId);
  const crawlId = crawls.length ? crawls[crawls.length - 1]!.id : null;
  const report = crawlId ? await loadReport(crawlId) : null;
  if (!report || !crawlId) {
    return <p className="py-16 text-center text-[14px] text-muted">Could not load the latest audit for this website.</p>;
  }

  const origin = report.origin.replace(/\/$/, '');
  const host = origin.replace(/^https?:\/\//, '');
  const [robotsText, llmsTxt] = await Promise.all([
    fetchText(origin + '/robots.txt'),
    fetchText(origin + '/llms.txt'),
  ]);

  // Content grades live on their own page, but they still feed the readiness
  // score — being reachable is worthless if nothing is worth quoting.
  const stored = await gradesForCrawl(crawlId);
  const aeo = analyzeAeo({
    report, robotsText, llmsTxt,
    grades: stored.map((g) => ({ url: g.url, overall: g.overall })),
  });
  const suggested = generateLlmsTxt(report);
  const allowed = aeo.crawlers.filter((c) => c.allowed).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Answer engine optimisation</p>
          <h1 className="mt-2 max-w-[22ch] text-[32px] font-bold leading-[1.08] tracking-tight">
            Can AI answers find you?
          </h1>
          <p className="mt-2 max-w-[74ch] text-[14px] leading-relaxed text-muted">
            ChatGPT, Claude, Perplexity and Google&rsquo;s AI answers only quote what they can reach and read.
            Most of them never run JavaScript — so a page that builds itself in the browser is invisible to
            them, however good it looks to you.
          </p>
        </div>
        <Recheck checkedAt={Date.now()} />
      </header>

      <SitePicker projects={projects} selectedId={selected.siteId} base="/ai-visibility" />

      {/* ---- readiness ---- */}
      <div className="flex flex-col gap-8 border border-line bg-surface p-6 lg:flex-row lg:items-center">
        <div className="flex items-center gap-5">
          <ScoreDial score={aeo.score} />
          <div className="lg:hidden">
            <div className="text-[15px] font-medium text-ink">{host}</div>
            <div className="text-[12.5px] text-muted">AI readiness</div>
          </div>
        </div>
        <div className="flex-1">
          <div className="hidden lg:block">
            <h2 className="text-[15px] font-medium text-ink">AI readiness · {host}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              From the audit of {new Date(report.createdAt).toLocaleDateString()}, plus live checks just now.
            </p>
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {aeo.pillars.map((p) => (
              <MeterBar key={p.key} label={p.label} got={p.got} max={p.max} measured={p.measured} detail={p.detail} />
            ))}
          </div>
          {!aeo.pillars.find((p) => p.key === 'quote')?.measured && (
            <p className="mt-4 text-[12.5px] text-muted">
              Writing quality is scored on the{' '}
              <Link href="/content" className="text-accent hover:underline">Content page</Link>{' '}
              — until pages are graded it is left out of this score rather than counted as zero.
            </p>
          )}
        </div>
      </div>

      {/* ---- what to fix first ---- */}
      {aeo.actions.length > 0 && (
        <section className="border border-line bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-[17px] font-medium text-ink">What to fix first</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">Ordered by how much each one blocks you from being cited.</p>
          </div>
          <ol className="divide-y divide-line">
            {aeo.actions.map((a, i) => (
              <ActionRow key={a.title} i={i} severity={a.severity} title={a.title} detail={a.detail} />
            ))}
          </ol>
        </section>
      )}

      {/* ---- 01 reach ---- */}
      <Section n={1} title="Can AI engines reach you?" question="Whether your robots file lets each answer engine in."
        status={aeo.blockedCritical.length ? `${aeo.blockedCritical.length} blocked` : `${allowed} of ${aeo.crawlers.length} allowed`}
        tone={aeo.blockedCritical.length ? 'bad' : 'good'}>
        <div className="scroll-x">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <caption className="sr-only">Answer engines and whether robots.txt allows each one</caption>
            <thead className="border-b border-line bg-surface-2">
              <tr>
                <th className="px-6 py-2 text-left text-[11px] font-medium text-muted">Answer engine</th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-muted">What it controls</th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-muted">Where the rule comes from</th>
                <th className="px-6 py-2 text-right text-[11px] font-medium text-muted">Access</th>
              </tr>
            </thead>
            <tbody>
              {aeo.crawlers.map((c) => (
                <tr key={c.agent.token} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                  <td className="px-6 py-2.5">
                    <span className="text-ink">{c.agent.label}</span>
                    {c.agent.critical && <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-muted">major</span>}
                    <div className="font-mono text-[10.5px] text-muted">{c.agent.token}</div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.agent.powers}</td>
                  <td className="px-4 py-2.5 text-[12px] text-muted">
                    {c.source === 'explicit' ? 'a rule naming this engine'
                      : c.source === 'wildcard' ? 'your “all crawlers” rule'
                        : 'no robots file — open by default'}
                  </td>
                  <td className="px-6 py-2.5 text-right font-medium"
                    style={{ color: c.allowed ? 'rgb(var(--opportunity))' : 'rgb(var(--blocker))' }}>
                    {c.allowed ? 'Allowed' : 'Blocked'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ---- 02 read ---- */}
      <Section n={2} title="Can they read your pages?" question="Most answer engines never run JavaScript — this is what they actually receive."
        status={aeo.jsRisk.length ? `${aeo.jsRisk.length} of ${aeo.htmlPages} at risk` : 'All pages readable'}
        tone={aeo.jsRisk.length ? 'bad' : 'good'}>
        {aeo.jsRisk.length === 0 ? (
          <p className="px-6 py-6 text-[13.5px] text-opportunity">
            Every page delivers its words in the first response. Answer engines see what your visitors see.
          </p>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <caption className="sr-only">Pages compared by words an AI sees versus words a visitor sees</caption>
              <thead className="border-b border-line bg-surface-2">
                <tr>
                  <th className="px-6 py-2 text-left text-[11px] font-medium text-muted">Page</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-muted">Words an AI sees</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-muted">Words a visitor sees</th>
                  <th className="px-6 py-2 text-right text-[11px] font-medium text-muted">Visible</th>
                </tr>
              </thead>
              <tbody>
                {aeo.jsRisk.slice(0, 25).map((p) => (
                  <tr key={p.url} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                    <td className="px-6 py-2.5">
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">{shortUrl(p.url, 46)}</a>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">{Math.round(p.serverTextLength / 5.5)}</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">{p.wordCount}</td>
                    <td className="tnum px-6 py-2.5 text-right font-medium"
                      style={{ color: p.serverShare < 0.25 ? 'rgb(var(--blocker))' : 'rgb(var(--warning))' }}>
                      {Math.round(p.serverShare * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---- 03 understand ---- */}
      <Section n={3} title="Do they understand your site?" question="A short file at your root telling answer engines what you do and which pages matter."
        status={aeo.llmsTxt.found ? 'llms.txt found' : 'No llms.txt'}
        tone={aeo.llmsTxt.found ? 'good' : 'neutral'}>
        <div className="px-6 py-5">
          {aeo.llmsTxt.found && (
            <p className="mb-3 text-[13px] text-opportunity">
              Your site already publishes one ({aeo.llmsTxt.bytes.toLocaleString()} characters). The version below is
              rebuilt from your most important pages if you want to refresh it.
            </p>
          )}
          <LlmsFile content={suggested} />

          {aeo.answer.issues.length > 0 && (
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-[13px] font-medium text-ink">
                {aeo.answer.issues.length} {aeo.answer.issues.length === 1 ? 'page is' : 'pages are'} missing the basics
              </h3>
              <p className="mt-1 text-[12.5px] text-muted">
                A model needs a clear title, a summary, a main heading and enough substance before it can lift an answer.
              </p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {aeo.answer.issues.slice(0, 12).map((i) => (
                  <li key={i.url} className="flex flex-wrap items-baseline justify-between gap-2 border-l-2 border-line pl-3">
                    <a href={i.url} target="_blank" rel="noreferrer" className="text-[12.5px] text-ink hover:text-accent">{shortUrl(i.url, 44)}</a>
                    <span className="text-[12px] text-muted">{i.reasons.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* ---- pointer to content ---- */}
      <Section title="Is your content worth quoting?" question="Reaching an answer engine is only half of it — the writing still has to earn the citation."
        status={aeo.content.average !== null ? `Average ${aeo.content.average}/100` : 'Not graded yet'}
        tone={aeo.content.average === null ? 'neutral' : aeo.content.average >= 70 ? 'good' : 'bad'}>
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted">
            {aeo.content.average !== null
              ? <>You have graded {aeo.content.graded} {aeo.content.graded === 1 ? 'page' : 'pages'}, averaging {aeo.content.average}/100. This feeds the readiness score above.</>
              : <>Nothing graded yet for this website. Content quality is the biggest factor in whether an answer engine quotes you.</>}
          </p>
          <Link href="/content"
            className="shrink-0 border border-ink bg-ink px-5 py-2 text-[13px] font-medium text-ground no-underline transition-opacity hover:opacity-90">
            Open content quality →
          </Link>
        </div>
      </Section>

      <p className="text-[12.5px] leading-relaxed text-muted">
        Access and llms.txt are checked live each time you open or re-check this page. Page readability comes from
        the latest audit.
      </p>
    </div>
  );
}
