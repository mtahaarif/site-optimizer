/**
 * The model behind the content judge.
 *
 * Three providers are supported so the feature works with whichever key you
 * have, and so a free tier can be used without a card:
 *
 *   Gemini     GEMINI_API_KEY     best free-tier headroom for page-sized prompts
 *   Groq       GROQ_API_KEY       fastest per call; free tier is token-throttled
 *   Anthropic  ANTHROPIC_API_KEY  strongest judgement; paid only
 *
 * Gemini and Groq both speak the OpenAI chat-completions shape, so they share
 * one code path and differ only by base URL, key and model. Anthropic uses its
 * own SDK. All three return the same thing: a JSON object matching the caller's
 * schema, or a readable error. Nothing here throws — a grading failure is a
 * message on screen, not a 500.
 */

export type ProviderName = 'gemini' | 'groq' | 'anthropic';

export interface ProviderInfo {
  name: ProviderName;
  model: string;
  label: string;
}

// Aliases that always resolve to the current generation. Pinned ids get retired
// ("no longer available to new users"), which would break grading silently.
const GEMINI_DEFAULT_MODEL = 'gemini-flash-lite-latest';
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

const geminiKey = () => process.env['GEMINI_API_KEY']?.trim();
const groqKey = () => process.env['GROQ_API_KEY']?.trim();
const anthropicKey = () =>
  process.env['ANTHROPIC_API_KEY']?.trim() ?? process.env['ANTHROPIC_AUTH_TOKEN']?.trim();

function describe(name: ProviderName): ProviderInfo {
  if (name === 'gemini') return { name, model: process.env['GEMINI_MODEL']?.trim() || GEMINI_DEFAULT_MODEL, label: 'Gemini' };
  if (name === 'groq') return { name, model: process.env['GROQ_MODEL']?.trim() || GROQ_DEFAULT_MODEL, label: 'Groq' };
  return { name, model: process.env['ANTHROPIC_MODEL']?.trim() || ANTHROPIC_DEFAULT_MODEL, label: 'Claude' };
}

const hasKey: Record<ProviderName, () => boolean> = {
  gemini: () => !!geminiKey(),
  groq: () => !!groqKey(),
  anthropic: () => !!anthropicKey(),
};

/**
 * Which provider will be used, or null when no key is configured.
 *
 * Default order puts Gemini first: for page-sized prompts its free tier allows
 * roughly ten times the throughput of Groq's, whose free tier caps tokens per
 * minute rather than requests. Set LLM_PROVIDER to override.
 */
export function activeProvider(): ProviderInfo | null {
  const preferred = process.env['LLM_PROVIDER']?.trim().toLowerCase() as ProviderName | undefined;
  if (preferred && preferred in hasKey && hasKey[preferred]()) return describe(preferred);

  for (const name of ['gemini', 'groq', 'anthropic'] as ProviderName[]) {
    if (hasKey[name]()) return describe(name);
  }
  return null;
}

export function llmConfigured(): boolean {
  return activeProvider() !== null;
}

export type JsonOutcome =
  | { ok: true; data: unknown; model: string }
  | { ok: false; error: string };

export interface JsonRequest {
  system: string;
  user: string;
  /** JSON Schema describing the expected object. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
}

/** Ask the configured model for one JSON object matching `schema`. */
export async function completeJson(req: JsonRequest): Promise<JsonOutcome> {
  const provider = activeProvider();
  if (!provider) {
    return { ok: false, error: 'No AI key configured. Add GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY to .env.local.' };
  }
  if (provider.name === 'anthropic') return anthropicJson(provider, req);

  const base = provider.name === 'gemini' ? GEMINI_BASE : GROQ_BASE;
  const key = provider.name === 'gemini' ? geminiKey() : groqKey();
  return openAiCompatibleJson(provider, base, key ?? '', req);
}

// ---------------------------------------------------------------------------
// Gemini + Groq — OpenAI-compatible chat completions in JSON mode
// ---------------------------------------------------------------------------

async function openAiCompatibleJson(
  provider: ProviderInfo,
  baseUrl: string,
  key: string,
  req: JsonRequest,
): Promise<JsonOutcome> {
  if (!key) return { ok: false, error: `No API key set for ${provider.label}.` };

  // JSON mode guarantees syntactically valid JSON but not the right shape, so
  // the schema goes in the prompt and the caller validates what comes back.
  const system = `${req.system}\n\nReply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(req.schema)}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: req.maxTokens ?? 2000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: req.user },
        ],
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = (await res.text()).slice(0, 240);
      if (res.status === 401 || res.status === 403) return { ok: false, error: `That ${provider.label} key was rejected.` };
      if (res.status === 429) return { ok: false, error: `${provider.label} rate limit reached — wait a moment and try again.` };
      if (res.status === 404) return { ok: false, error: `Model "${provider.model}" is not available on this key. Set ${provider.name.toUpperCase()}_MODEL to one you can use.` };
      return { ok: false, error: `${provider.label} error (${res.status}): ${body}` };
    }

    const data = await res.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: 'The model returned an empty response.' };

    try {
      return { ok: true, data: JSON.parse(content) as unknown, model: data.model ?? provider.model };
    } catch {
      return { ok: false, error: 'The model did not return valid JSON.' };
    }
  } catch (err) {
    const e = err as Error;
    if (e.name === 'AbortError') return { ok: false, error: 'The model took too long to respond.' };
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Anthropic — official SDK, structured outputs
// ---------------------------------------------------------------------------

async function anthropicJson(provider: ProviderInfo, req: JsonRequest): Promise<JsonOutcome> {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const response = await client.messages.create({
      model: provider.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', name: req.schemaName, schema: req.schema },
      },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    } as Parameters<typeof client.messages.create>[0]) as unknown as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return { ok: false, error: 'The model returned an empty response.' };
    try {
      return { ok: true, data: JSON.parse(text) as unknown, model: provider.model };
    } catch {
      return { ok: false, error: 'The model did not return valid JSON.' };
    }
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.status === 401) return { ok: false, error: 'That Anthropic key was rejected.' };
    if (e.status === 429) return { ok: false, error: 'Rate limited by Anthropic — try again shortly.' };
    return { ok: false, error: e.message };
  }
}
