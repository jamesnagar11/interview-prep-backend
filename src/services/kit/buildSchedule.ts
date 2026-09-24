import type { GeneratedQuestion, QuestionCategory, Requirement, Schedule, ScheduleDay } from '../../types/kit';

export const TIME_PER_DIFFICULTY_MIN: Record<number, number> = { 1: 10, 2: 15, 3: 20 };

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

function deriveFocusLabel(
  questionIds: string[],
  questions: GeneratedQuestion[],
  requirements: Requirement[]
): string {
  if (questionIds.length === 0) return 'Rest / Buffer';
  const reqIds = questionIds.flatMap(
    (qid) => questions.find((q) => q.id === qid)?.requirement_ids ?? []
  );
  const counts = countBy(reqIds);
  const topReqId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topReq = requirements.find((r) => r.id === topReqId);
  return topReq ? topReq.text : 'Mixed practice';
}

/**
 * Creates an interleaved queue of questions across categories,
 * preserving priority (must-haves first) and difficulty within each category.
 */
function createInterleavedQueue(
  questions: GeneratedQuestion[],
  requirements: Requirement[]
): GeneratedQuestion[] {
  const categories: QuestionCategory[] = ['technical', 'system-design', 'behavioural', 'company-fit'];
  const categoryBuckets: Record<string, GeneratedQuestion[]> = {};

  for (const cat of categories) {
    categoryBuckets[cat] = questions
      .filter((q) => q.category === cat)
      .sort((a, b) => priorityOf(a, requirements) - priorityOf(b, requirements) || b.difficulty - a.difficulty);
  }

  // Also catch any questions with unknown categories
  const knownCats = new Set<string>(categories);
  const misc = questions
    .filter((q) => !knownCats.has(q.category))
    .sort((a, b) => priorityOf(a, requirements) - priorityOf(b, requirements) || b.difficulty - a.difficulty);
  if (misc.length > 0) categoryBuckets['misc'] = misc;

  const result: GeneratedQuestion[] = [];
  let addedAny = true;

  while (addedAny) {
    addedAny = false;
    for (const catKey of Object.keys(categoryBuckets)) {
      const bucket = categoryBuckets[catKey];
      if (bucket && bucket.length > 0) {
        const item = bucket.shift()!;
        result.push(item);
        addedAny = true;
      }
    }
  }

  return result;
}

export function buildSchedule(
  questions: GeneratedQuestion[],
  requirements: Requirement[],
  daysAvailable: number
): Schedule {
  if (questions.length === 0 || daysAvailable <= 0) {
    const days: ScheduleDay[] = Array.from({ length: Math.max(1, daysAvailable) }, (_, i) => ({
      day: i + 1,
      focus: 'Rest / Buffer',
      question_ids: [],
      minutes: 0,
    }));
    return { days_available: daysAvailable, days };
  }

  // 1. Interleave questions by category for balanced topic mixture
  const interleavedQueue = createInterleavedQueue(questions, requirements);

  // 2. Active days count capped by available questions to avoid unnecessary empty spread
  const activeDaysCount = Math.min(daysAvailable, interleavedQueue.length);

  const days: ScheduleDay[] = Array.from({ length: daysAvailable }, (_, i) => ({
    day: i + 1,
    focus: '',
    question_ids: [],
    minutes: 0,
  }));

  // 3. Round-Robin distribution of questions across active days (each question used EXACTLY ONCE)
  for (let i = 0; i < interleavedQueue.length; i++) {
    const q = interleavedQueue[i]!;
    const dayIndex = i % activeDaysCount;
    const targetDay = days[dayIndex];
    if (targetDay) {
      targetDay.question_ids.push(q.id);
      targetDay.minutes += TIME_PER_DIFFICULTY_MIN[q.difficulty] ?? 15;
    }
  }

  // 4. Derive dynamic focus labels for each day
  for (const day of days) {
    day.focus = deriveFocusLabel(day.question_ids, questions, requirements);
  }

  return { days_available: daysAvailable, days };
}
