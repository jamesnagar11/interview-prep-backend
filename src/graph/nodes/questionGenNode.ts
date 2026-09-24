import { z } from 'zod';
import type { GeneratedQuestion, QuestionCategory, Requirement } from '../../types/kit';
import { openrouter } from '../../llm/openrouterClient';
import { callOpenRouter, parseJsonFromLLM } from '../../llm/callWithRetry';

// Matches keywords that escalate a technical requirement to system-design
const SYSTEM_DESIGN_KEYWORDS = [
  'scale', 'distributed', 'architecture', 'system design', 'high availability',
  'throughput', 'microservice', 'kafka', 'event-driven', 'load balanc',
];

const SENIOR_SENIORITY_KEYWORDS = ['senior', 'staff', 'lead', 'principal', 'architect'];

function isSystemDesignRequirement(req: Requirement, seniority: string): boolean {
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

async function callForCategory(
  requirements: Requirement[],
  category: QuestionCategory,
  daysAvailable: number,
  hiringProcessText: string | null
): Promise<Omit<GeneratedQuestion, 'id'>[]> {
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

export async function questionGenNode(state: {
  role: { title: string; seniority: string; requirements: Requirement[] } | null;
  days: number;
  research: { hiringProcessText: string | null } | null;
}): Promise<{ questions: GeneratedQuestion[]; warnings: string[] }> {
  if (!state.role) {
    throw new Error('questionGenNode: role is null — cannot generate questions');
  }

  const requirements = state.role.requirements;
  const seniority = state.role.seniority;
  const daysAvailable = state.days;
  const hiringProcessText = state.research?.hiringProcessText ?? null;

  // Categorize requirements
  const techReqs = requirements.filter((r) => r.kind === 'technical' && !isSystemDesignRequirement(r, seniority));
  const sysDesignReqs = requirements.filter((r) => r.kind === 'technical' && isSystemDesignRequirement(r, seniority));
  const behavReqs = requirements.filter((r) => r.kind === 'behavioural');
  const domainReqs = requirements.filter((r) => r.kind === 'domain');

  const groups: { category: QuestionCategory; reqs: Requirement[] }[] = [];
  if (techReqs.length > 0) groups.push({ category: 'technical', reqs: techReqs });
  if (sysDesignReqs.length > 0) groups.push({ category: 'system-design', reqs: sysDesignReqs });
  if (behavReqs.length > 0) groups.push({ category: 'behavioural', reqs: behavReqs });
  if (domainReqs.length > 0) groups.push({ category: 'company-fit', reqs: domainReqs });

  const allRaw: Omit<GeneratedQuestion, 'id'>[] = [];
  const warnings: string[] = [];
  let successCount = 0;

  for (const { category, reqs } of groups) {
    try {
      const needsHiringContext = category === 'technical' || category === 'system-design';
      const results = await callForCategory(
        reqs,
        category,
        daysAvailable,
        needsHiringContext ? hiringProcessText : null
      );
      allRaw.push(...results);
      successCount++;
    } catch {
      warnings.push(`Question generation failed for category: ${category}`);
    }
  }

  if (successCount === 0) {
    throw new Error('All question generation calls failed — cannot produce a kit without questions');
  }

  // Assign stable ids across all questions
  const questions: GeneratedQuestion[] = allRaw.map((q, i) => ({
    ...q,
    id: `q${i + 1}`,
  }));

  return { questions, warnings };
}
