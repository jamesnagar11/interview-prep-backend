import type { GeneratedQuestion, Requirement } from '../../types/kit';
import { checkCoverage } from '../../services/kit/checkCoverage';

export const MAX_COVERAGE_PASSES = 3;

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
    coveragePasses: state.coveragePasses,
  };
}
