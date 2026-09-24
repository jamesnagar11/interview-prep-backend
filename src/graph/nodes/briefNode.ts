import { z } from 'zod';
import type { CompanyBrief, ResearchBundle } from '../../types/kit';
import { openrouter } from '../../llm/openrouterClient';
import { callOpenRouter, parseJsonFromLLM } from '../../llm/callWithRetry';

const BriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
});

const EMPTY_BRIEF_SUMMARY = 'No public information about this company could be found.';

function fallbackBrief(sources: string[] = []): CompanyBrief {
  return {
    summary: EMPTY_BRIEF_SUMMARY,
    what_they_do: '',
    sources,
  };
}

export async function briefNode(state: {
  research: ResearchBundle | null;
  role: { title: string } | null;
  companyUrl: string;
}): Promise<{ companyBrief: CompanyBrief; warnings: string[] }> {
  const research = state.research;
  const aboutSources = research?.pagesUsed ?? [];

  // If no about text, return fallback without calling LLM
  if (!research?.aboutText) {
    return {
      companyBrief: fallbackBrief(aboutSources),
      warnings: ['No company information found — brief is empty'],
    };
  }

  const aboutText = research.aboutText;

  try {
    const prompt = `You are a professional business analyst. Summarize what this company does based ONLY on the following page content. Do not invent any details not present in the text. Return ONLY a JSON object with no markdown fences.

Page content:
"""
${aboutText.slice(0, 6000)}
"""

Return this exact JSON structure:
{
  "summary": "2-3 sentence summary of the company",
  "what_they_do": "1-2 sentence description of their core product or service"
}`;

    const messages = [{ role: 'user', content: prompt }];
    let parsed: { summary: string; what_they_do: string } | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const raw = await callOpenRouter(openrouter, messages, 0.1);
        const json = parseJsonFromLLM(raw);
        parsed = BriefSchema.parse(json);
        break;
      } catch (err: any) {
        const isRateLimit = err?.status === 429;
        const isTransient = isRateLimit || (err?.status >= 500) || (err instanceof z.ZodError) || (err instanceof SyntaxError);
        if (!isTransient || attempt === 3) throw err;
        const waitMs = isRateLimit && err?.headers?.['retry-after']
          ? Number(err.headers['retry-after']) * 1000
          : Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 300;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    if (!parsed) {
      return {
        companyBrief: fallbackBrief(aboutSources),
        warnings: ['Company brief generation failed after retries — showing empty brief'],
      };
    }

    return {
      companyBrief: {
        summary: parsed.summary,
        what_they_do: parsed.what_they_do,
        sources: aboutSources,
      },
      warnings: [],
    };
  } catch {
    return {
      companyBrief: fallbackBrief(aboutSources),
      warnings: ['Company brief generation failed after retries — showing empty brief'],
    };
  }
}
