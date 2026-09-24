import type { AppendixAKit } from '../../types/kit';
import { db } from '../../prisma/db';

/**
 * persistNode — writes the full AppendixAKit into the database using the existing
 * Prisma-ORM-Mongo schema. Uses sequential awaits with a stableKey→dbId map
 * for join tables (since later inserts depend on earlier ids).
 *
 * Atomicity: if the entire write succeeds, Kit.status flips to READY.
 * If any step throws, we catch at the runner level and mark FAILED.
 */
export async function persistNode(state: {
  kitId: string;
  finalKit: AppendixAKit | null;
}): Promise<Record<string, never>> {
  const { kitId, finalKit } = state;

  if (!finalKit) {
    throw new Error('persistNode: finalKit is null — validateNode must have failed silently');
  }

  // ── 1. KitPage rows (pages_used) ───────────────────────────────────────────
  for (const url of finalKit.source.pages_used) {
    await db.orm.kitPage.create({
      kitId,
      url,
    } as any);
  }

  // ── 2. BriefSource rows ────────────────────────────────────────────────────
  for (const url of finalKit.company_brief.sources) {
    await db.orm.briefSource.create({
      kitId,
      url,
    } as any);
  }

  // ── 3. Responsibility rows ─────────────────────────────────────────────────
  for (const description of finalKit.role.responsibilities) {
    await db.orm.responsibility.create({
      kitId,
      description,
    } as any);
  }

  // ── 4. Requirement rows → build stableKey→dbId map ─────────────────────────
  const requirementIdMap = new Map<string, string>(); // stableKey → db _id string

  for (const req of finalKit.role.requirements) {
    const row = await db.orm.requirement.create({
      kitId,
      stableKey: req.id,
      text: req.text,
      kind: req.kind,
      priority: req.priority,
    } as any);
    requirementIdMap.set(req.id, (row as any)._id.toString());
  }

  // ── 5. Question rows + QuestionRequirement join rows ───────────────────────
  const questionIdMap = new Map<string, string>(); // stableKey → db _id string

  for (let i = 0; i < finalKit.questions.length; i++) {
    const q = finalKit.questions[i];
    if (!q) continue;
    const qRow = await db.orm.question.create({
      kitId,
      stableKey: q.id,
      category: q.category,
      prompt: q.prompt,
      answerOutline: q.answer_outline,
      difficulty: q.difficulty,
      state: 'GENERATED',
      orderIndex: i,
    } as any);
    const qDbId = (qRow as any)._id.toString();
    questionIdMap.set(q.id, qDbId);

    // Create QuestionRequirement join rows
    for (const reqStableKey of q.requirement_ids) {
      const reqDbId = requirementIdMap.get(reqStableKey);
      if (reqDbId) {
        await db.orm.questionRequirement.create({
          questionId: qDbId,
          requirementId: reqDbId,
        } as any);
      }
    }
  }

  // ── 6. Flashcard rows + FlashcardRequirement join rows ─────────────────────
  const flashcardIdMap = new Map<string, string>(); // stableKey → db _id string

  for (let i = 0; i < finalKit.flashcards.length; i++) {
    const f = finalKit.flashcards[i];
    if (!f) continue;
    const fRow = await db.orm.flashcard.create({
      kitId,
      stableKey: f.id,
      front: f.front,
      back: f.back,
      state: 'GENERATED',
      orderIndex: i,
    } as any);
    const fDbId = (fRow as any)._id.toString();
    flashcardIdMap.set(f.id, fDbId);

    // Create FlashcardRequirement join rows
    for (const reqStableKey of f.requirement_ids) {
      const reqDbId = requirementIdMap.get(reqStableKey);
      if (reqDbId) {
        await db.orm.flashcardRequirement.create({
          flashcardId: fDbId,
          requirementId: reqDbId,
        } as any);
      }
    }
  }

  // ── 7. ScheduleDay rows + ScheduleDayQuestion join rows ────────────────────
  for (const day of finalKit.schedule.days) {
    const dayRow = await db.orm.scheduleDay.create({
      kitId,
      dayNumber: day.day,
      focus: day.focus,
      minutes: day.minutes,
    } as any);
    const dayDbId = (dayRow as any)._id.toString();

    for (let pos = 0; pos < day.question_ids.length; pos++) {
      const qStableKey = day.question_ids[pos];
      if (!qStableKey) continue;
      const qDbId = questionIdMap.get(qStableKey);
      if (qDbId) {
        await db.orm.scheduleDayQuestion.create({
          scheduleDayId: dayDbId,
          questionId: qDbId,
          position: pos,
        } as any);
      }
    }
  }

  // ── 8. UncoveredRequirement rows ───────────────────────────────────────────
  for (const stableKey of finalKit.coverage.uncovered_requirement_ids) {
    await db.orm.uncoveredRequirement.create({
      kitId,
      stableKey,
    } as any);
  }

  // ── 9. Update Kit row with summary fields + READY status ───────────────────
  await db.orm.kit.where({ _id: kitId as any }).update({
    companyName: finalKit.source.company,
    role: finalKit.source.role,
    location: finalKit.source.location || null,
    researchedAt: new Date(finalKit.source.researched_at),
    briefSummary: finalKit.company_brief.summary,
    briefWhatTheyDo: finalKit.company_brief.what_they_do,
    roleTitle: finalKit.role.title,
    roleSeniority: finalKit.role.seniority,
    jdChars: finalKit.source.jd_chars,
    coveragePasses: finalKit.coverage.passes,
    result: JSON.stringify(finalKit),
    status: 'READY' as any,
    updatedAt: new Date(),
  } as any);

  return {};
}
