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

function targetCount(_req: Requirement, _daysAvailable: number): number {
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

/**
 * Unified 1-Call Question Generator:
 * Generates questions across all categories (technical, system-design, behavioural, company-fit)
 * in a SINGLE LLM request instead of 4 separate category calls.
 */
export async function generateQuestionsUnified(
  requirements: Requirement[],
  seniority: string,
  daysAvailable: number,
  hiringProcessText: string | null
): Promise<Omit<GeneratedQuestion, 'id'>[]> {
  if (requirements.length === 0) {
    return [];
  }

  const requirementsText = requirements
    .map((r) => `- id: "${r.id}", kind: "${r.kind}", priority: "${r.priority}", text: "${r.text}"`)
    .join('\n');

  const hiringContext = hiringProcessText
    ? `\n\nHiring process context:\n"""\n${hiringProcessText.slice(0, 2000)}\n"""\nIf the hiring process mentions specific round formats (take-home, system-design, pair programming, behavioral interviews), align question styles with those formats.`
    : '';

  const prompt = `You are an expert technical interviewer preparing a complete, categorized interview question bank for a candidate.

Target Role Seniority: ${seniority || 'Not specified'}
Timeframe available: ${daysAvailable} days

Requirements to cover:
${requirementsText}${hiringContext}

Rules:
1. Return ONLY a valid JSON array — no markdown fences, no conversational text.
2. Categorize every question using one of these EXACT categories:
   - "system-design": Architecture, distributed systems, scalability, data pipelines, high availability, microservices, or high-level design.
   - "technical": Hands-on coding, algorithms, frameworks, tools, database queries, operating systems, and core technical skills.
   - "behavioural": Soft skills, teamwork, communication, leadership, conflict resolution, project management, and past experience.
   - "company-fit": Domain knowledge, business understanding, industry standards, and role/company alignment.
3. DYNAMIC SCALING RULE: Scale question output naturally based on the number, depth, and richness of requirements provided.
   - For a large, comprehensive set of requirements (e.g. 12 to 20+ requirements), generate a thorough question bank covering all technical and soft skill areas.
   - For a smaller set of requirements, generate a proportional, focused question bank.
   - Ensure EVERY requirement (especially "must" priority requirements) is covered by at least one question.
4. Each question object must have:
   - requirement_ids: array of requirement IDs covered (e.g. ["r1"] or ["r1", "r3"] if a question tests multiple skills together)
   - category: "technical" | "system-design" | "behavioural" | "company-fit"
   - prompt: clear, realistic interview question
   - answer_outline: detailed 3 to 5 sentence suggested answer outline covering key points an interviewer looks for
   - difficulty: 1 (easy), 2 (medium), or 3 (hard)

Return format (JSON array):
[
  {
    "requirement_ids": ["r1"],
    "category": "technical",
    "prompt": "Question text...",
    "answer_outline": "Key response points...",
    "difficulty": 2
  }
]`;

  const messages = [{ role: 'user', content: prompt }];

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const raw = await callOpenRouter(openrouter, messages, 0.3);
      if (!raw || raw.trim() === '') {
        throw new Error('Empty response from LLM provider');
      }
      const json = parseJsonFromLLM(raw);
      const validated = QuestionArraySchema.parse(json);
      return validated;
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.message?.includes('Empty response');
      const isTransient = isRateLimit || (err?.status >= 500) || (err instanceof z.ZodError) || (err instanceof SyntaxError) || (err?.message?.includes('JSON'));
      if (!isTransient || attempt === 4) throw err;
      const waitMs = isRateLimit && err?.headers?.['retry-after']
        ? Number(err.headers['retry-after']) * 1000
        : Math.min(1500 * 2 ** attempt, 10000) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error('Failed to generate unified question bank after retries');
}

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
    .map((r) => `- id: "${r.id}", priority: "${r.priority}", text: "${r.text}"`)
    .join('\n');

  const hiringContext = hiringProcessText
    ? `\n\nHiring process context:\n"""\n${hiringProcessText.slice(0, 1500)}\n"""\nIf the hiring process mentions specific formats, align question style with that format.`
    : '';

  const prompt = `You are an expert technical interviewer preparing a ${category} interview question bank.

Requirements to cover:
${requirementsText}${hiringContext}

Generate interview questions covering these requirements. Rules:
1. Return ONLY a valid JSON array — no markdown fences, no explanations.
2. Each question must have: requirement_ids (array of requirement ids covered), category ("${category}"), prompt (the interview question), answer_outline (suggested answer 3-5 sentences), difficulty (1=easy, 2=medium, 3=hard).
3. Ensure all requirements are covered with realistic interview questions.

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

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const raw = await callOpenRouter(openrouter, messages, 0.3);
      if (!raw || raw.trim() === '') {
        throw new Error('Empty response from LLM provider');
      }
      const json = parseJsonFromLLM(raw);
      const validated = QuestionArraySchema.parse(json);
      return validated;
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.message?.includes('Empty response');
      const isTransient = isRateLimit || (err?.status >= 500) || (err instanceof z.ZodError) || (err instanceof SyntaxError) || (err?.message?.includes('JSON'));
      if (!isTransient || attempt === 4) throw err;
      const waitMs = isRateLimit && err?.headers?.['retry-after']
        ? Number(err.headers['retry-after']) * 1000
        : Math.min(1500 * 2 ** attempt, 10000) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error(`Failed to generate questions for category: ${category}`);
}
