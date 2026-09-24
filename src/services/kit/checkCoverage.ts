import type { GeneratedQuestion, Requirement } from '../../types/kit';

export function checkCoverage(requirements: Requirement[], questions: GeneratedQuestion[]): string[] {
  const covered = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements
    .filter((r) => r.priority === 'must' && !covered.has(r.id))
    .map((r) => r.id);
}
