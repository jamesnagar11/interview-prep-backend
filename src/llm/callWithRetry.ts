import { z } from 'zod';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls an LLM function with exponential backoff retry logic.
 * Retries on rate limits (429), server errors (5xx), and Zod validation errors.
 * Non-transient errors (e.g. 400 bad request) break immediately.
 */
export async function callLLMWithRetry<T>(
  fn: () => Promise<unknown>,
  schema: z.ZodSchema<T>,
  { maxAttempts = 3 }: { maxAttempts?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await fn();
      return schema.parse(raw); // throws ZodError on shape mismatch — caught below, retried
    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.status === 429;
      const isTransient = isRateLimit || (err?.status >= 500) || err instanceof z.ZodError;
      if (!isTransient || attempt === maxAttempts) break;
      const retryAfterMs = isRateLimit && err?.headers?.['retry-after']
        ? Number(err.headers['retry-after']) * 1000
        : Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 300; // exponential backoff + jitter
      await sleep(retryAfterMs);
    }
  }
  throw lastError;
}

/**
 * Strips markdown fences from an LLM response string and parses as JSON.
 */
export function parseJsonFromLLM(text: string): unknown {
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.slice(7);
  if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();
  return JSON.parse(clean);
}

/**
 * Calls openrouter chat and returns the raw string content.
 */
export async function callOpenRouter(
  openrouter: any,
  messages: any[],
  temperature = 0.3
): Promise<string> {
  const response = await openrouter.chat.send({
    chatRequest: {
      model: 'openrouter/free',
      messages,
      temperature,
    },
  });

  if ('choices' in response && Array.isArray(response.choices)) {
    const choice = response.choices[0];
    const content = choice?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c === 'string' ? c : (c as any).text || '')).join('');
    }
  }
  return '';
}
