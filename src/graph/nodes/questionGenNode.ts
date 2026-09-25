import type { GeneratedQuestion, QuestionCategory, Requirement } from '../../types/kit';
import { generateQuestionsForCategory, isSystemDesignRequirement } from '../../services/kit/generateQuestionsForCategory';

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

  // Run all question-category LLM calls in parallel — biggest speed win
  const categoryResults = await Promise.allSettled(
    groups.map(({ category, reqs }) => {
      const needsHiringContext = category === 'technical' || category === 'system-design';
      return generateQuestionsForCategory(
        reqs,
        category,
        daysAvailable,
        needsHiringContext ? hiringProcessText : null
      );
    })
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

  // Assign stable ids across all questions
  const questions: GeneratedQuestion[] = allRaw.map((q, i) => ({
    ...q,
    id: `q${i + 1}`,
  }));

  return { questions, warnings };
}
