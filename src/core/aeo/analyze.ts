/**
 * Answer Engine Optimisation (AEO) — can AI answer engines actually read,
 * understand and quote this site?
 *
 * This is the half of "AI visibility" that is a technical fact rather than a
 * measurement: whether the AI crawlers are allowed in, whether the content
 * exists without JavaScript (most AI crawlers do not execute it), whether there
 * is an llms.txt, and whether pages are shaped so a model can lift an answer.
 *
 * The JavaScript check is the one no generic SEO tool produces: the crawler
 * already records the body text present in the *server* response separately from
 * the post-render word count, so a page that only assembles itself in the
 * browser is invisible to an answer engine and we can prove it per URL.
 */
import type { AuditReport, PageSummary } from '../../crawler/audit.ts';

// ---------------------------------------------------------------------------
// The crawlers that decide whether you can be cited
// ---------------------------------------------------------------------------

export interface AiAgent {
  /** token as it appears in robots.txt */
  token: string;
  label: string;
  /** what blocking it costs you, in plain language */
  powers: string;
  /** blocking these removes you from an answer engine outright */
  critical: boolean;
}

export const AI_AGENTS: AiAgent[] = [
  { token: 'OAI-SearchBot', label: 'ChatGPT Search', powers: 'Being shown and cited inside ChatGPT', critical: true },
  { token: 'GPTBot', label: 'OpenAI GPTBot', powers: 'OpenAI reading your pages at all', critical: true },
  { token: 'ChatGPT-User', label: 'ChatGPT browsing', powers: 'ChatGPT opening your page when a user asks', critical: true },
  { token: 'ClaudeBot', label: 'Claude', powers: 'Anthropic reading and citing your pages', critical: true },
  { token: 'PerplexityBot', label: 'Perplexity', powers: 'Appearing as a Perplexity source', critical: true },
  { token: 'Google-Extended', label: 'Google Gemini / AI Overviews', powers: 'Being used in Google’s AI answers', critical: true },
  { token: 'Applebot-Extended', label: 'Apple Intelligence', powers: 'Apple’s AI features using your content', critical: false },
  { token: 'meta-externalagent', label: 'Meta AI', powers: 'Meta’s assistant using your content', critical: false },
  { token: 'CCBot', label: 'Common Crawl', powers: 'The open dataset many models train on', critical: false },
  { token: 'Amazonbot', label: 'Amazon (Alexa)', powers: 'Amazon’s assistant reading your pages', critical: false },
];

// ---------------------------------------------------------------------------
// robots.txt, evaluated per user-agent
// ---------------------------------------------------------------------------

interface Rule { type: 'allow' | 'disallow'; pattern: string; regex: RegExp }
interface Group { agents: string[]; rules: Rule[] }

function patternToRegex(pattern: string): RegExp {
  let src = '';
  for (const ch of pattern) {
    if (ch === '*') src += '.*';
    else if (ch === '$') src += '$';
    else src += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + src);
}

/** Split robots.txt into user-agent groups. A blank line or a new agent block starts a group. */
export function parseGroups(content: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let expectingAgents = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !expectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) { current = { agents: ['*'], rules: [] }; groups.push(current); }
      expectingAgents = false;
      if (field === 'disallow' && value === '') continue; // "Disallow:" = allow everything
      current.rules.push({ type: field, pattern: value, regex: patternToRegex(value) });
    }
  }
  return groups;
}

export type AccessSource = 'explicit' | 'wildcard' | 'default';

export interface AgentAccess {
  agent: AiAgent;
  allowed: boolean;
  /** which robots.txt group decided it */
  source: AccessSource;
}

/**
 * Google's precedence: a group naming the agent wins outright over the `*`
 * group, and within a group the longest matching pattern wins (Allow breaking
 * ties). No robots.txt at all means everything is allowed.
 */
export function accessFor(groups: Group[], token: string, path = '/'): { allowed: boolean; source: AccessSource } {
  const lower = token.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(lower));
  const wildcard = groups.filter((g) => g.agents.includes('*'));
  const use = named.length ? named : wildcard;
  if (!use.length) return { allowed: true, source: 'default' };

  const rules = use.flatMap((g) => g.rules);
  if (!rules.length) return { allowed: true, source: named.length ? 'explicit' : 'wildcard' };

  let best: Rule | null = null;
  for (const r of rules) {
    if (!r.regex.test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length) best = r;
    else if (r.pattern.length === best.pattern.length && r.type === 'allow') best = r;
  }
  return { allowed: best?.type !== 'disallow', source: named.length ? 'explicit' : 'wildcard' };
}

export function crawlerAccess(robotsText: string | null): AgentAccess[] {
  const groups = robotsText ? parseGroups(robotsText) : [];
  return AI_AGENTS.map((agent) => {
    const { allowed, source } = accessFor(groups, agent.token);
    return { agent, allowed, source };
  });
}

// ---------------------------------------------------------------------------
// Content that only exists after JavaScript runs
// ---------------------------------------------------------------------------

export interface JsRiskPage {
  url: string;
  title: string | null;
  serverTextLength: number;
  wordCount: number;
  /** rough share of the page's words present before JavaScript runs */
  serverShare: number;
  pageRank: number;
}

/** Roughly how many words the server response carried (avg ~5.5 chars/word). */
const serverWords = (p: PageSummary) => Math.round((p.serverTextLength ?? 0) / 5.5);

export function jsDependentPages(pages: PageSummary[]): JsRiskPage[] {
  return pages
    .filter((p) => p.isHtml && p.wordCount > 50)
    .map((p) => {
      const sw = serverWords(p);
      return {
        url: p.url, title: p.title,
        serverTextLength: p.serverTextLength ?? 0,
        wordCount: p.wordCount,
        serverShare: p.wordCount > 0 ? Math.min(1, sw / p.wordCount) : 1,
        pageRank: p.pageRank,
      };
    })
    // Under ~60% of the words present server-side means an answer engine that
    // doesn't run JavaScript sees a materially different (or empty) page.
    .filter((p) => p.serverShare < 0.6)
    .sort((a, b) => a.serverShare - b.serverShare || b.pageRank - a.pageRank);
}

// ---------------------------------------------------------------------------
// Answerability — is a page shaped so a model can lift an answer from it?
// ---------------------------------------------------------------------------

export interface AnswerabilityIssue { url: string; reasons: string[]; pageRank: number }

export function answerability(pages: PageSummary[]): { ready: number; total: number; issues: AnswerabilityIssue[] } {
  const html = pages.filter((p) => p.isHtml && p.status === 200);
  const issues: AnswerabilityIssue[] = [];
  let ready = 0;

  for (const p of html) {
    const reasons: string[] = [];
    if (!p.title) reasons.push('no title');
    if (!p.description) reasons.push('no summary (meta description)');
    if (!p.h1) reasons.push('no main heading');
    if (p.wordCount < 300) reasons.push(`thin content (${p.wordCount} words)`);
    if (reasons.length === 0) ready++;
    else issues.push({ url: p.url, reasons, pageRank: p.pageRank });
  }
  issues.sort((a, b) => b.pageRank - a.pageRank);
  return { ready, total: html.length, issues };
}

// ---------------------------------------------------------------------------
// Overall readiness
// ---------------------------------------------------------------------------

/** One pillar of AEO readiness, scored out of `max`. */
export interface Pillar {
  key: 'reach' | 'read' | 'understand' | 'quote';
  label: string;
  question: string;
  got: number;
  max: number;
  /** null when the pillar has not been measured yet (e.g. no content graded) */
  measured: boolean;
  detail: string;
}

/** A concrete thing to do next, hardest-hitting first. */
export interface Action {
  severity: 'critical' | 'warning' | 'opportunity';
  title: string;
  detail: string;
  pillar: Pillar['key'];
}

export interface AeoReport {
  score: number;
  pillars: Pillar[];
  actions: Action[];
  crawlers: AgentAccess[];
  blockedCritical: AgentAccess[];
  llmsTxt: { found: boolean; bytes: number };
  jsRisk: JsRiskPage[];
  htmlPages: number;
  answer: { ready: number; total: number; issues: AnswerabilityIssue[] };
  content: { graded: number; average: number | null; weakest: { url: string; overall: number } | null };
}

export interface AeoInput {
  report: AuditReport;
  robotsText: string | null;
  llmsTxt: string | null;
  /** Content-quality grades for this crawl, when any pages have been graded. */
  grades?: Array<{ url: string; overall: number }>;
}

export function analyzeAeo(input: AeoInput): AeoReport {
  const { report, robotsText, llmsTxt, grades = [] } = input;
  const pages = report.pages ?? [];
  const html = pages.filter((p) => p.isHtml && p.status === 200);

  const crawlers = crawlerAccess(robotsText);
  const critical = crawlers.filter((c) => c.agent.critical);
  const blockedCritical = critical.filter((c) => !c.allowed);
  const jsRisk = jsDependentPages(html);
  const answer = answerability(pages);

  const avgContent = grades.length
    ? Math.round(grades.reduce((s, g) => s + g.overall, 0) / grades.length)
    : null;
  const weakest = grades.length
    ? [...grades].sort((a, b) => a.overall - b.overall)[0]!
    : null;

  // Four pillars, weighted by how decisively each one blocks a citation.
  const allowedCritical = critical.filter((c) => c.allowed).length;
  const readable = html.length - jsRisk.length;

  const pillars: Pillar[] = [
    {
      key: 'reach', label: 'Reachable', question: 'Can AI engines fetch your pages?',
      got: critical.length ? (allowedCritical / critical.length) * 30 : 30, max: 30, measured: true,
      detail: `${allowedCritical} of ${critical.length} major answer engines allowed`,
    },
    {
      key: 'read', label: 'Readable', question: 'Do your pages work without JavaScript?',
      got: html.length ? (readable / html.length) * 25 : 25, max: 25, measured: html.length > 0,
      detail: `${readable} of ${html.length} pages readable without JavaScript`,
    },
    {
      key: 'understand', label: 'Understandable', question: 'Is your site easy to interpret?',
      got: (llmsTxt?.trim() ? 7 : 0) + (answer.total ? (answer.ready / answer.total) * 8 : 8), max: 15, measured: true,
      detail: llmsTxt?.trim()
        ? `llms.txt present · ${answer.ready} of ${answer.total} pages well-formed`
        : `No llms.txt · ${answer.ready} of ${answer.total} pages well-formed`,
    },
    {
      key: 'quote', label: 'Worth quoting', question: 'Is the writing good enough to cite?',
      got: avgContent !== null ? (avgContent / 100) * 30 : 0, max: 30, measured: avgContent !== null,
      detail: avgContent !== null
        ? `Average content quality ${avgContent}/100 across ${grades.length} graded ${grades.length === 1 ? 'page' : 'pages'}`
        : 'No pages graded yet',
    },
  ];

  // Score over what has actually been measured, so an ungraded site is not
  // punished for a pillar we simply have not run.
  const measured = pillars.filter((p) => p.measured);
  const totalMax = measured.reduce((s, p) => s + p.max, 0);
  const totalGot = measured.reduce((s, p) => s + p.got, 0);
  const score = totalMax > 0 ? Math.round((totalGot / totalMax) * 100) : 0;

  // ---- what to do next -----------------------------------------------------
  const actions: Action[] = [];

  for (const c of blockedCritical) {
    actions.push({
      severity: 'critical', pillar: 'reach',
      title: `Unblock ${c.agent.label}`,
      detail: `Your robots file tells ${c.agent.token} to stay out, so you cannot appear there at all. Remove that rule.`,
    });
  }

  if (jsRisk.length > 0) {
    const worst = jsRisk[0]!;
    actions.push({
      severity: jsRisk.length > html.length / 4 ? 'critical' : 'warning', pillar: 'read',
      title: `Serve content without JavaScript on ${jsRisk.length} ${jsRisk.length === 1 ? 'page' : 'pages'}`,
      detail: `Worst is ${worst.url} — only ${Math.round(worst.serverShare * 100)}% of its words are in the page an AI receives. Render this content on the server.`,
    });
  }

  if (avgContent !== null && weakest && weakest.overall < 60) {
    actions.push({
      severity: 'warning', pillar: 'quote',
      title: 'Improve your weakest pages',
      detail: `${weakest.url} scores ${weakest.overall}/100. Thin or generic pages rarely get quoted — open the content section below for page-specific fixes.`,
    });
  }

  if (avgContent === null) {
    actions.push({
      severity: 'opportunity', pillar: 'quote',
      title: 'Grade your content',
      detail: 'Content quality is the biggest factor in whether an answer engine quotes you, and it has not been measured for this site yet.',
    });
  }

  if (!llmsTxt?.trim()) {
    actions.push({
      severity: 'opportunity', pillar: 'understand',
      title: 'Publish an llms.txt',
      detail: 'A short file telling answer engines what you do and which pages matter. One is generated for you below.',
    });
  }

  if (answer.issues.length > 0) {
    actions.push({
      severity: 'opportunity', pillar: 'understand',
      title: `Complete the basics on ${answer.issues.length} ${answer.issues.length === 1 ? 'page' : 'pages'}`,
      detail: 'Some pages are missing a title, a summary, a main heading or enough substance for a model to lift an answer from.',
    });
  }

  const rank = { critical: 0, warning: 1, opportunity: 2 };
  actions.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    score,
    pillars,
    actions,
    crawlers,
    blockedCritical,
    llmsTxt: { found: !!(llmsTxt && llmsTxt.trim()), bytes: llmsTxt?.length ?? 0 },
    jsRisk,
    htmlPages: html.length,
    answer,
    content: { graded: grades.length, average: avgContent, weakest },
  };
}

// ---------------------------------------------------------------------------
// Generate an llms.txt from what the crawl already knows
// ---------------------------------------------------------------------------

/**
 * llms.txt is a plain-text map that tells an answer engine what a site is and
 * which pages matter. We already rank every page by internal importance, so the
 * file writes itself.
 */
export function generateLlmsTxt(report: AuditReport, limit = 25): string {
  const host = report.origin.replace(/^https?:\/\//, '');
  const home = report.pages.find((p) => {
    try { return new URL(p.url).pathname === '/'; } catch { return false; }
  });
  const name = home?.title?.split(/[|·—-]/)[0]?.trim() || host;
  const summary = home?.description?.trim() || `Pages published on ${host}.`;

  const top = [...report.pages]
    .filter((p) => p.isHtml && p.status === 200 && p.indexable)
    .sort((a, b) => b.pageRank - a.pageRank)
    .slice(0, limit);

  const lines = [
    `# ${name}`,
    '',
    `> ${summary}`,
    '',
    '## Pages',
    '',
    ...top.map((p) => {
      const label = p.title?.trim() || p.url;
      const note = p.description?.trim();
      return `- [${label}](${p.url})${note ? `: ${note}` : ''}`;
    }),
    '',
  ];
  return lines.join('\n');
}
