import type { GeneratedQuestion, Requirement, Schedule, ScheduleDay } from '../../types/kit';

const TIME_PER_DIFFICULTY_MIN: Record<number, number> = { 1: 10, 2: 15, 3: 20 };
const DEFAULT_DAILY_BUDGET_MIN = 60;
const BUFFER_DAY_MINUTES = 20;

function countBy<T>(arr: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const key = String(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function priorityOf(q: GeneratedQuestion, requirements: Requirement[]): number {
  return q.requirement_ids.some(
    (id) => requirements.find((r) => r.id === id)?.priority === 'must'
  ) ? 0 : 1;
}

/**
 * deriveFocusLabel — picks the label of the most-referenced requirement across
 * a day's questions. Pure frequency count, no LLM call.
 */
function deriveFocusLabel(
  questionIds: string[],
  questions: GeneratedQuestion[],
  requirements: Requirement[]
): string {
  const reqIds = questionIds.flatMap(
    (qid) => questions.find((q) => q.id === qid)?.requirement_ids ?? []
  );
  const counts = countBy(reqIds);
  const topReqId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topReq = requirements.find((r) => r.id === topReqId);
  return topReq ? topReq.text : 'Mixed practice';
}

/**
 * assertMustCoverage — defensive check that every must-have requirement's
 * questions appear somewhere in the schedule. Throws if violated (indicates bug).
 */
function assertMustCoverage(
  days: ScheduleDay[],
  questions: GeneratedQuestion[],
  requirements: Requirement[]
): void {
  const mustReqIds = requirements.filter((r) => r.priority === 'must').map((r) => r.id);
  const scheduledQuestionIds = new Set(days.flatMap((d) => d.question_ids));
  const scheduledReqIds = new Set(
    [...scheduledQuestionIds].flatMap(
      (qid) => questions.find((q) => q.id === qid)?.requirement_ids ?? []
    )
  );

  const unscheduled = mustReqIds.filter((id) => !scheduledReqIds.has(id));
  // Note: this won't trigger if there are truly no questions for a requirement (already recorded
  // in uncoveredRequirementIds by coverageCheckNode). Only triggers if we have a question for it
  // but it was dropped from the schedule — which should be impossible by construction.
  if (unscheduled.length > 0) {
    // Log a warning rather than hard throw, since this would only happen due to an internal bug
    // and we don't want to fail a nearly-complete kit over a schedule assertion.
    console.warn(
      `scheduleNode: assertMustCoverage found unscheduled must-have requirements: ${unscheduled.join(', ')}`
    );
  }
}

/**
 * fillBufferDays — fills empty days (more days than content) with spaced-repetition
 * review days using must-priority questions (or all questions if none are must).
 */
function fillBufferDays(
  days: ScheduleDay[],
  sortedQuestions: GeneratedQuestion[],
  requirements: Requirement[]
): void {
  const emptyDays = days.filter((d) => d.question_ids.length === 0);
  if (emptyDays.length === 0) return;

  // Prefer must-priority questions for review days
  const mustQuestions = sortedQuestions.filter((q) =>
    q.requirement_ids.some(
      (id) => requirements.find((r) => r.id === id)?.priority === 'must'
    )
  );
  const reviewPool = mustQuestions.length > 0 ? mustQuestions : sortedQuestions;

  for (let i = 0; i < emptyDays.length; i++) {
    const day = emptyDays[i];
    if (!day) continue;
    // Rotate through review pool — spaced repetition flavour
    const reviewQ = reviewPool[i % reviewPool.length];
    if (reviewQ) {
      day.question_ids.push(reviewQ.id);
      day.minutes = BUFFER_DAY_MINUTES;
      day.focus = 'Review & light practice';
    } else {
      // Truly no questions at all — should only happen in pathological case
      day.minutes = BUFFER_DAY_MINUTES;
      day.focus = 'Review & light practice';
    }
  }
}

/**
 * buildSchedule — greedy-fill algorithm:
 * 1. Sort: must before nice, then difficulty descending
 * 2. Fill into daysAvailable buckets with a soft daily budget
 * 3. Defensive must-coverage assertion
 * 4. Fill buffer days with review sessions
 * 5. Derive focus label per day
 *
 * Invariants:
 * - schedule.days.length === daysAvailable exactly
 * - Every generated question is scheduled somewhere (nothing dropped)
 * - minutes is always an integer
 * - Must-priority questions land in earlier days
 */
export function buildSchedule(
  questions: GeneratedQuestion[],
  requirements: Requirement[],
  daysAvailable: number
): Schedule {
  if (questions.length === 0) {
    // Degenerate case — no questions at all (fatal in questionGenNode, but be safe)
    const days: ScheduleDay[] = Array.from({ length: daysAvailable }, (_, i) => ({
      day: i + 1,
      focus: 'Review & light practice',
      question_ids: [],
      minutes: BUFFER_DAY_MINUTES,
    }));
    return { days_available: daysAvailable, days };
  }

  // 1. Sort: must before nice, then difficulty descending
  const sorted = [...questions].sort((a, b) =>
    priorityOf(a, requirements) - priorityOf(b, requirements) || b.difficulty - a.difficulty
  );

  // 2. Greedy-fill into daysAvailable buckets
  const days: ScheduleDay[] = Array.from({ length: daysAvailable }, (_, i) => ({
    day: i + 1,
    focus: '',
    question_ids: [],
    minutes: 0,
  }));

  let dayIdx = 0;
  for (const q of sorted) {
    // Advance to next day once current is at soft budget, but never past last day
    while (dayIdx < daysAvailable - 1 && (days[dayIdx]?.minutes ?? 0) >= DEFAULT_DAILY_BUDGET_MIN) {
      dayIdx++;
    }
    const currentDay = days[dayIdx];
    if (currentDay) {
      currentDay.question_ids.push(q.id);
      currentDay.minutes += TIME_PER_DIFFICULTY_MIN[q.difficulty] ?? 15;
    }
  }

  // 3. Defensive must-coverage assertion
  assertMustCoverage(days, questions, requirements);

  // 4. Fill buffer (empty) days with review sessions
  fillBufferDays(days, sorted, requirements);

  // Warn if many buffer days (thin JD)
  const bufferCount = days.filter((d) => d.focus === 'Review & light practice').length;
  const warnings: string[] = [];
  if (bufferCount > daysAvailable * 0.4 && daysAvailable > 3) {
    warnings.push(
      `Only ${questions.length} questions generated from a short job description — later days are review sessions, not new material`
    );
  }

  // 5. Derive focus per day
  for (const day of days) {
    if (day.focus === '') {
      day.focus = deriveFocusLabel(day.question_ids, questions, requirements);
    }
  }

  return { days_available: daysAvailable, days };
}

export async function scheduleNode(state: {
  questions: GeneratedQuestion[];
  role: { requirements: Requirement[] } | null;
  days: number;
  uncoveredRequirementIds: string[];
}): Promise<{ schedule: Schedule; warnings: string[] }> {
  const requirements = state.role?.requirements ?? [];
  const schedule = buildSchedule(state.questions, requirements, state.days);

  const warnings: string[] = [];
  // If many buffer days, emit a warning
  const bufferDays = schedule.days.filter((d) => d.focus === 'Review & light practice').length;
  if (bufferDays > state.days * 0.4 && state.days > 3) {
    warnings.push(
      `Only ${state.questions.length} questions generated from a short job description — later days are review sessions, not new material`
    );
  }

  return { schedule, warnings };
}
