import type { GeneratedQuestion, QuestionCategory, Requirement } from '../../types/kit';
import { generateQuestionsUnified, generateQuestionsForCategory, isSystemDesignRequirement } from '../../services/kit/generateQuestionsForCategory';

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

  const warnings: string[] = [];

  // Primary Path: Generate all categorized questions in ONE single unified LLM call
  try {
    const rawQuestions = await generateQuestionsUnified(requirements, seniority, daysAvailable, hiringProcessText);
    if (rawQuestions.length > 0) {
      const questions: GeneratedQuestion[] = rawQuestions.map((q, i) => ({
        ...q,
        id: `q${i + 1}`,
      }));
      return { questions, warnings };
    }
  } catch (err: any) {
    warnings.push(`Unified question generation failed (${err.message}). Falling back to per-category fan-out...`);
  }

  // Fallback Path: Per-category parallel fan-out if unified call failed
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
  let successCount = 0;

  const categoryResults = await Promise.allSettled(
    groups.map(({ category, reqs }) =>
      generateQuestionsForCategory(reqs, category, daysAvailable, hiringProcessText)
    )
  );

  for (let i = 0; i < categoryResults.length; i++) {
    const result = categoryResults[i]!;
    if (result.status === 'fulfilled') {
      allRaw.push(...result.value);
      successCount++;
    } else {
      warnings.push(`Question generation failed for category: ${groups[i]!.category}`);
    }
  }

  if (successCount === 0) {
    throw new Error('All question generation calls failed — cannot produce a kit without questions');
  }

  const questions: GeneratedQuestion[] = allRaw.map((q, i) => ({
    ...q,
    id: `q${i + 1}`,
  }));

  return { questions, warnings };
}
