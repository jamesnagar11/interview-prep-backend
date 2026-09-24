import type { GeneratedQuestion, Requirement, Schedule } from '../../types/kit';
import { buildSchedule } from '../../services/kit/buildSchedule';

export async function scheduleNode(state: {
  questions: GeneratedQuestion[];
  role: { requirements: Requirement[] } | null;
  days: number;
  uncoveredRequirementIds: string[];
}): Promise<{ schedule: Schedule; warnings: string[] }> {
  const requirements = state.role?.requirements ?? [];
  const schedule = buildSchedule(state.questions, requirements, state.days);

  const warnings: string[] = [];
  const bufferDays = schedule.days.filter((d) => d.focus === 'Review & light practice').length;
  if (bufferDays > state.days * 0.4 && state.days > 3) {
    warnings.push(
      `Only ${state.questions.length} questions generated from a short job description — later days are review sessions, not new material`
    );
  }

  return { schedule, warnings };
}
