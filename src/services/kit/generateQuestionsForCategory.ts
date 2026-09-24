import { z } from 'zod';
import type { GeneratedQuestion, QuestionCategory, Requirement } from '../../types/kit';
import { openrouter } from '../../llm/openrouterClient';
import { callOpenRouter, parseJsonFromLLM } from '../../llm/callWithRetry';

const SYSTEM_DESIGN_KEYWORDS = [
  'scale', 'distributed', 'architecture', 'system design', 'high availability',
  'throughput', 'microservice', 'kafka', 'event-driven', 'load balanc',
];

const SENIOR_SENIORITY_KEYWORDS = ['senior', 'staff', 'lead', 'principal', 'architect'];

export function isSystemDesignRequirement(req: Requirement, seniority: string): boolean {
  const text = req.text.toLowerCase();
  const hasKeyword = SYSTEM_DESIGN_KEYWORDS.some((kw) => text.includes(kw));
  const isSenior = SENIOR_SENIORITY_KEYWORDS.some((kw) => seniority.toLowerCase().includes(kw));
  return hasKeyword || (req.priority === 'must' && isSenior);
}

function targetCount(req: Requirement, daysAvailable: number): number {
  if (req.priority === 'must') return daysAvailable >= 14 ? 3 : 2;
  return 1;
}

const QuestionArraySchema = z.array(
  z.object({
    requirement_ids: z.array(z.string()),
    category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
    prompt: z.string(),
    answer_outline: z.string(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
);

export async function generateQuestionsForCategory(
  requirements: Requirement[],
  category: QuestionCategory,
  daysAvailable: number,
  hiringProcessText: string | null
): Promise<Omit<GeneratedQuestion, 'id'>[]> {
  if (requirements.length === 0) {
    return [];
  }

  const requirementsText = requirements
    .map((r) => `- id: "${r.id}", priority: "${r.priority}", text: "${r.text}" (aim for ~${targetCount(r, daysAvailable)} questions)`)
    .join('\n');

  const hiringContext = hiringProcessText
    ? `\n\nHiring process context (use this to bias your question style):\n"""\n${hiringProcessText.slice(0, 2000)}\n"""\nIf the hiring process mentions a take-home assignment, system-design round, pair programming, or similar, bias question style toward that format.`
    : '';

  const prompt = `You are an expert technical interviewer preparing a ${category} interview question bank.

Requirements to cover:
${requirementsText}${hiringContext}

Generate interview questions covering these requirements. Rules:
1. Return ONLY a valid JSON array — no markdown fences, no explanations.
2. Each question must have: requirement_ids (array of requirement ids covered), category ("${category}"), prompt (the interview question), answer_outline (a detailed suggested answer), difficulty (1=easy, 2=medium, 3=hard).
3. If a single question naturally tests two or more requirements together, return multiple ids in requirement_ids. Don't force one-question-per-requirement if artificial.
4. Aim for the count guidance per requirement, but quality over quantity.
5. answer_outline should be 3-6 sentences, covering key points an interviewer would look for.

Return format (JSON array):
[
  {
    "requirement_ids": ["r1"],
    "category": "${category}",
    "prompt": "Question text?",
    "answer_outline": "Key points the answer should cover...",
    "difficulty": 2
  }
]`;

  const messages = [{ role: 'user', content: prompt }];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callOpenRouter(openrouter, messages, 0.3);
      const json = parseJsonFromLLM(raw);
      const validated = QuestionArraySchema.parse(json);
      return validated;
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
  throw new Error(`Failed to generate questions for category: ${category}`);
}
