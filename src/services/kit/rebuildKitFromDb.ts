import { db } from '../../prisma/db';
import type { AppendixAKit, CompanyBrief, GeneratedFlashcard, GeneratedQuestion, QuestionCategory, Requirement, ScheduleDay } from '../../types/kit';

export async function rebuildKitFromDb(kitId: string): Promise<AppendixAKit | null> {
  const kit = await db.orm.kit.where({ _id: kitId as any }).first();
  if (!kit) return null;

  const kitPages = await db.orm.kitPage.where({ kitId }).all();
  const briefSources = await db.orm.briefSource.where({ kitId }).all();
  const responsibilities = await db.orm.responsibility.where({ kitId }).all();
  const dbRequirements = await db.orm.requirement.where({ kitId }).all();
  const dbQuestions = await db.orm.question.where({ kitId }).all();
  const dbFlashcards = await db.orm.flashcard.where({ kitId }).all();
  const dbScheduleDays = await db.orm.scheduleDay.where({ kitId }).all();
  const dbUncovered = await db.orm.uncoveredRequirement.where({ kitId }).all();

  // Maps for stable keys and join table queries
  const reqDbIdToStableKey = new Map<string, string>();
  const requirements: Requirement[] = dbRequirements.map((r: any) => {
    const dbId = r._id.toString();
    reqDbIdToStableKey.set(dbId, r.stableKey);
    return {
      id: r.stableKey,
      text: r.text,
      kind: r.kind,
      priority: r.priority,
    };
  });

  // Sort questions by category & orderIndex
  const sortedDbQuestions = [...dbQuestions].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const questions: GeneratedQuestion[] = [];
  const qDbIdToStableKey = new Map<string, string>();

  for (const q of sortedDbQuestions) {
    const qDbId = (q as any)._id.toString();
    qDbIdToStableKey.set(qDbId, q.stableKey);

    const qReqJoins = await db.orm.questionRequirement.where({ questionId: qDbId }).all();
    const reqStableKeys = qReqJoins
      .map((j: any) => reqDbIdToStableKey.get(j.requirementId))
      .filter((k: string | undefined): k is string => !!k);

    questions.push({
      id: q.stableKey,
      requirement_ids: reqStableKeys,
      category: q.category as QuestionCategory,
      prompt: q.prompt,
      answer_outline: q.answerOutline,
      difficulty: q.difficulty as 1 | 2 | 3,
      state: (q as any).state ?? 'GENERATED',
      orderIndex: (q as any).orderIndex ?? 0,
    });
  }

  // Flashcards
  const sortedDbFlashcards = [...dbFlashcards].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const flashcards: GeneratedFlashcard[] = [];

  for (const f of sortedDbFlashcards) {
    const fDbId = (f as any)._id.toString();
    const fReqJoins = await db.orm.flashcardRequirement.where({ flashcardId: fDbId }).all();
    const reqStableKeys = fReqJoins
      .map((j: any) => reqDbIdToStableKey.get(j.requirementId))
      .filter((k: string | undefined): k is string => !!k);

    flashcards.push({
      id: f.stableKey,
      front: f.front,
      back: f.back,
      requirement_ids: reqStableKeys,
      state: (f as any).state ?? 'GENERATED',
      orderIndex: (f as any).orderIndex ?? 0,
    });
  }

  // Schedule days
  const sortedDbDays = [...dbScheduleDays].sort((a: any, b: any) => a.dayNumber - b.dayNumber);
  const days: ScheduleDay[] = [];

  for (const d of sortedDbDays) {
    const dayDbId = (d as any)._id.toString();
    const dayQSlots = await db.orm.scheduleDayQuestion.where({ scheduleDayId: dayDbId }).all();
    const sortedSlots = [...dayQSlots].sort((a: any, b: any) => a.position - b.position);
    const qIds = sortedSlots
      .map((s: any) => qDbIdToStableKey.get(s.questionId))
      .filter((k: string | undefined): k is string => !!k);

    days.push({
      day: d.dayNumber,
      focus: d.focus,
      question_ids: qIds,
      minutes: d.minutes,
    });
  }

  let company = kit.companyName || '';
  if (!company) {
    try {
      const hostname = new URL(kit.companyUrl).hostname;
      company = hostname.replace(/^www\./, '').split('.')[0] ?? hostname;
      company = company.charAt(0).toUpperCase() + company.slice(1);
    } catch {
      company = kit.companyUrl;
    }
  }

  const companyBrief: CompanyBrief = {
    summary: kit.briefSummary || '',
    what_they_do: kit.briefWhatTheyDo || '',
    sources: briefSources.map((s: any) => s.url),
  };

  const finalKit: AppendixAKit = {
    source: {
      company,
      company_url: kit.companyUrl,
      role: kit.role || kit.roleTitle || '',
      location: kit.location || '',
      jd_chars: kit.jdChars || kit.jdText.length,
      researched_at: kit.researchedAt ? kit.researchedAt.toISOString() : new Date().toISOString(),
      pages_used: kitPages.map((p: any) => p.url),
    },
    company_brief: companyBrief,
    role: {
      title: kit.roleTitle || kit.role || '',
      seniority: kit.roleSeniority || '',
      responsibilities: responsibilities.map((r: any) => r.description),
      requirements,
    },
    questions,
    flashcards,
    schedule: {
      days_available: kit.daysAvailable,
      days,
    },
    coverage: {
      uncovered_requirement_ids: dbUncovered.map((u: any) => u.stableKey),
      passes: kit.coveragePasses ?? 0,
    },
  };

  return finalKit;
}
