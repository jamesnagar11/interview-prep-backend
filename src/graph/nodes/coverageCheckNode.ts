import type { GeneratedQuestion, Requirement } from '../../types/kit';

export const MAX_COVERAGE_PASSES = 3;

function checkCoverage(requirements: Requirement[], questions: GeneratedQuestion[]): string[] {
  const covered = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements
    .filter((r) => r.priority === 'must' && !covered.has(r.id))
    .map((r) => r.id);
}

export async function coverageCheckNode(state: {
  role: { requirements: Requirement[] } | null;
  questions: GeneratedQuestion[];
  coveragePasses: number;
}): Promise<{ uncoveredRequirementIds: string[]; coveragePasses: number }> {
  if (!state.role) {
    return { uncoveredRequirementIds: [], coveragePasses: state.coveragePasses };
  }

  const uncoveredRequirementIds = checkCoverage(state.role.requirements, state.questions);

  return {
    uncoveredRequirementIds,
    // don't increment here — increment happens in generateGapQuestionsNode
    coveragePasses: state.coveragePasses,
  };
}
