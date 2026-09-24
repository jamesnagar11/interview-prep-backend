import { z } from 'zod';
import type { GeneratedQuestion, Requirement } from '../../types/kit';
import { openrouter } from '../../llm/openrouterClient';
import { callOpenRouter, parseJsonFromLLM } from '../../llm/callWithRetry';

const QuestionArraySchema = z.array(
  z.object({
    requirement_ids: z.array(z.string()),
    category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
    prompt: z.string(),
    answer_outline: z.string(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
);

export async function generateGapQuestionsNode(state: {
  role: { requirements: Requirement[] } | null;
  questions: GeneratedQuestion[];
  uncoveredRequirementIds: string[];
  coveragePasses: number;
}): Promise<{ questions: GeneratedQuestion[]; coveragePasses: number; warnings: string[] }> {
  const gapIds = state.uncoveredRequirementIds;

  if (!state.role || gapIds.length === 0) {
    return {
      questions: state.questions,
      coveragePasses: state.coveragePasses + 1,
      warnings: [],
    };
  }

  const gapRequirements = state.role.requirements.filter((r) => gapIds.includes(r.id));

  const requirementsText = gapRequirements
    .map((r) => `- id: "${r.id}", priority: "${r.priority}", kind: "${r.kind}", text: "${r.text}"`)
    .join('\n');

  const prompt = `You are an expert technical interviewer. The following "must-have" requirements from a job description were not covered by the previously generated questions. Generate at least one interview question per requirement to fill these gaps.

Uncovered requirements:
${requirementsText}

Rules:
1. Return ONLY a valid JSON array — no markdown fences, no explanations.
2. Each question must have: requirement_ids (array of ids covered — can be multiple), category (one of: technical, behavioural, system-design, company-fit), prompt (the question), answer_outline (key points, 3-5 sentences), difficulty (1=easy, 2=medium, 3=hard).
3. Every requirement id listed above must appear in at least one question's requirement_ids.

Return format:
[
  {
    "requirement_ids": ["r3"],
    "category": "technical",
    "prompt": "...",
    "answer_outline": "...",
    "difficulty": 2
  }
]`;

  const messages = [{ role: 'user', content: prompt }];
  const warnings: string[] = [];

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const raw = await callOpenRouter(openrouter, messages, 0.3);
        const json = parseJsonFromLLM(raw);
        const validated = QuestionArraySchema.parse(json);

        // Assign ids continuing from existing questions
        const existingCount = state.questions.length;
        const newQuestions: GeneratedQuestion[] = validated.map((q, i) => ({
          ...q,
          id: `q${existingCount + i + 1}`,
        }));

        return {
          questions: [...state.questions, ...newQuestions],
          coveragePasses: state.coveragePasses + 1,
          warnings: [],
        };
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
  } catch {
    warnings.push(`Gap-fill question generation failed — some must-have requirements may remain uncovered`);
  }

  // Gap fill failed — return existing questions unchanged, increment pass counter
  return {
    questions: state.questions,
    coveragePasses: state.coveragePasses + 1,
    warnings,
  };
}
