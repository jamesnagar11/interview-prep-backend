import { db } from '../../prisma/db';
import type { AppendixAKit, GeneratedQuestion, QuestionCategory, ResearchBundle } from '../../types/kit';
import { generateBrief } from './generateBrief';
import { generateQuestionsForCategory, isSystemDesignRequirement } from './generateQuestionsForCategory';
import { checkCoverage } from './checkCoverage';
import { buildSchedule, TIME_PER_DIFFICULTY_MIN } from './buildSchedule';
import { rebuildKitFromDb } from './rebuildKitFromDb';

export class BuilderError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'BuilderError';
    this.statusCode = statusCode;
  }
}

/**
 * Helper to ensure kit exists, belongs to user, and status is READY
 */
export async function getReadyKitOrThrow(kitId: string, userId: string) {
  const kit = await db.orm.kit.where({ _id: kitId as any }).first();
  if (!kit || (kit as any).userId !== userId) {
    throw new BuilderError('Kit not found', 404);
  }
  if (kit.status !== 'READY') {
    throw new BuilderError('Kit is still generating', 409);
  }
  return kit;
}

/**
 * Update brief fields and set briefState = 'EDITED'
 */
export async function updateBrief(
  kitId: string,
  userId: string,
  data: { summary?: string; what_they_do?: string }
) {
  await getReadyKitOrThrow(kitId, userId);

  const updates: any = {
    briefState: 'EDITED' as any,
    updatedAt: new Date(),
  };

  if (data.summary !== undefined) updates.briefSummary = data.summary;
  if (data.what_they_do !== undefined) updates.briefWhatTheyDo = data.what_they_do;

  await db.orm.kit.where({ _id: kitId as any }).update(updates);

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Update single Question
 */
export async function updateQuestion(
  kitId: string,
  userId: string,
  qid: string,
  data: { prompt?: string; answerOutline?: string; category?: QuestionCategory; difficulty?: 1 | 2 | 3 }
) {
  await getReadyKitOrThrow(kitId, userId);

  const question = await db.orm.question.where({ kitId, stableKey: qid }).first();
  if (!question) {
    throw new BuilderError(`Question with id "${qid}" not found`, 404);
  }

  const qDbId = (question as any)._id.toString();

  // State becomes 'EDITED' UNLESS it's already 'PINNED'
  const newState = question.state === 'PINNED' ? 'PINNED' : 'EDITED';

  const updates: any = {
    state: newState as any,
  };
  if (data.prompt !== undefined) updates.prompt = data.prompt;
  if (data.answerOutline !== undefined) updates.answerOutline = data.answerOutline;
  if (data.category !== undefined) updates.category = data.category;
  if (data.difficulty !== undefined) updates.difficulty = data.difficulty;

  await db.orm.question.where({ _id: qDbId as any }).update(updates);

  // Check if this question currently appears in any ScheduleDayQuestion
  const scheduleSlots = await db.orm.scheduleDayQuestion.where({ questionId: qDbId }).all();
  let scheduleStale = false;
  if (scheduleSlots.length > 0) {
    scheduleStale = true;
    await db.orm.kit.where({ _id: kitId as any }).update({ scheduleStale: true as any });
  }

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return { kit: updatedKit, scheduleStale };
}

/**
 * Pin or unpin Question
 */
export async function pinQuestion(kitId: string, userId: string, qid: string, pinned: boolean) {
  await getReadyKitOrThrow(kitId, userId);

  const question = await db.orm.question.where({ kitId, stableKey: qid }).first();
  if (!question) {
    throw new BuilderError(`Question with id "${qid}" not found`, 404);
  }

  const newState = pinned ? 'PINNED' : 'EDITED';
  await db.orm.question.where({ _id: (question as any)._id.toString() as any }).update({ state: newState as any });

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Create Question
 */
export async function createQuestion(
  kitId: string,
  userId: string,
  data: {
    category: QuestionCategory;
    prompt: string;
    answerOutline: string;
    difficulty: 1 | 2 | 3;
    requirementIds: string[];
  }
) {
  await getReadyKitOrThrow(kitId, userId);

  // Validate requirementIds exist on this kit
  const existingReqs = await db.orm.requirement.where({ kitId }).all();
  const reqMap = new Map<string, string>(); // stableKey -> dbId
  for (const r of existingReqs) {
    reqMap.set(r.stableKey, (r as any)._id.toString());
  }

  for (const reqId of data.requirementIds) {
    if (!reqMap.has(reqId)) {
      throw new BuilderError(`Requirement with id "${reqId}" does not exist on this kit`, 400);
    }
  }

  // Find next stableKey index "qN"
  const allQuestions = await db.orm.question.where({ kitId }).all();
  let maxIdx = 0;
  for (const q of allQuestions) {
    const num = parseInt(q.stableKey.replace(/^q/, ''), 10);
    if (!isNaN(num) && num > maxIdx) maxIdx = num;
  }
  const nextStableKey = `q${maxIdx + 1}`;

  // Find orderIndex within category
  const categoryQuestions = allQuestions.filter((q: any) => q.category === data.category);
  const nextOrderIndex = categoryQuestions.length;

  const qRow = await db.orm.question.create({
    kitId,
    stableKey: nextStableKey,
    category: data.category,
    prompt: data.prompt,
    answerOutline: data.answerOutline,
    difficulty: data.difficulty,
    state: 'EDITED' as any,
    orderIndex: nextOrderIndex,
  } as any);

  const qDbId = (qRow as any)._id.toString();

  // Add QuestionRequirement join rows
  for (const reqStableKey of data.requirementIds) {
    const reqDbId = reqMap.get(reqStableKey);
    if (reqDbId) {
      await db.orm.questionRequirement.create({
        questionId: qDbId,
        requirementId: reqDbId,
      } as any);
    }
  }

  // Recompute coverage
  const currentKit = await rebuildKitFromDb(kitId);
  if (currentKit) {
    const uncovered = checkCoverage(currentKit.role.requirements, currentKit.questions);
    await db.orm.uncoveredRequirement.where({ kitId }).deleteAll();
    for (const stableKey of uncovered) {
      await db.orm.uncoveredRequirement.create({ kitId, stableKey } as any);
    }
  }

  // Question creation structurally modifies questions -> scheduleStale = true
  await db.orm.kit.where({ _id: kitId as any }).update({ scheduleStale: true as any });

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Delete Question
 */
export async function deleteQuestion(kitId: string, userId: string, qid: string) {
  await getReadyKitOrThrow(kitId, userId);

  const question = await db.orm.question.where({ kitId, stableKey: qid }).first();
  if (!question) {
    throw new BuilderError(`Question with id "${qid}" not found`, 404);
  }

  const qDbId = (question as any)._id.toString();

  // Delete join rows + question
  await db.orm.questionRequirement.where({ questionId: qDbId }).deleteAll();
  await db.orm.scheduleDayQuestion.where({ questionId: qDbId }).deleteAll();
  await db.orm.question.where({ _id: qDbId as any }).deleteAll();

  // Recompute coverage
  const currentKit = await rebuildKitFromDb(kitId);
  if (currentKit) {
    const uncovered = checkCoverage(currentKit.role.requirements, currentKit.questions);
    await db.orm.uncoveredRequirement.where({ kitId }).deleteAll();
    for (const stableKey of uncovered) {
      await db.orm.uncoveredRequirement.create({ kitId, stableKey } as any);
    }
  }

  // Set scheduleStale if question structural change happened
  await db.orm.kit.where({ _id: kitId as any }).update({ scheduleStale: true as any });

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Reorder Questions within a category
 */
export async function reorderQuestions(
  kitId: string,
  userId: string,
  category: QuestionCategory,
  order: string[]
) {
  await getReadyKitOrThrow(kitId, userId);

  for (let i = 0; i < order.length; i++) {
    const qid = order[i];
    if (!qid) continue;
    const q = await db.orm.question.where({ kitId, stableKey: qid }).first();
    if (q) {
      await db.orm.question.where({ _id: (q as any)._id.toString() as any }).update({ orderIndex: i } as any);
    }
  }

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Update single Flashcard
 */
export async function updateFlashcard(
  kitId: string,
  userId: string,
  fid: string,
  data: { front?: string; back?: string }
) {
  await getReadyKitOrThrow(kitId, userId);

  const flashcard = await db.orm.flashcard.where({ kitId, stableKey: fid }).first();
  if (!flashcard) {
    throw new BuilderError(`Flashcard with id "${fid}" not found`, 404);
  }

  const fDbId = (flashcard as any)._id.toString();
  const newState = flashcard.state === 'PINNED' ? 'PINNED' : 'EDITED';

  const updates: any = { state: newState as any };
  if (data.front !== undefined) updates.front = data.front;
  if (data.back !== undefined) updates.back = data.back;

  await db.orm.flashcard.where({ _id: fDbId as any }).update(updates);

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Pin or unpin Flashcard
 */
export async function pinFlashcard(kitId: string, userId: string, fid: string, pinned: boolean) {
  await getReadyKitOrThrow(kitId, userId);

  const flashcard = await db.orm.flashcard.where({ kitId, stableKey: fid }).first();
  if (!flashcard) {
    throw new BuilderError(`Flashcard with id "${fid}" not found`, 404);
  }

  const newState = pinned ? 'PINNED' : 'EDITED';
  await db.orm.flashcard.where({ _id: (flashcard as any)._id.toString() as any }).update({ state: newState as any });

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Create Flashcard
 */
export async function createFlashcard(
  kitId: string,
  userId: string,
  data: { front: string; back: string; requirementIds: string[] }
) {
  await getReadyKitOrThrow(kitId, userId);

  const existingReqs = await db.orm.requirement.where({ kitId }).all();
  const reqMap = new Map<string, string>();
  for (const r of existingReqs) {
    reqMap.set(r.stableKey, (r as any)._id.toString());
  }

  for (const reqId of data.requirementIds) {
    if (!reqMap.has(reqId)) {
      throw new BuilderError(`Requirement with id "${reqId}" does not exist on this kit`, 400);
    }
  }

  const allFlashcards = await db.orm.flashcard.where({ kitId }).all();
  let maxIdx = 0;
  for (const f of allFlashcards) {
    const num = parseInt(f.stableKey.replace(/^f/, ''), 10);
    if (!isNaN(num) && num > maxIdx) maxIdx = num;
  }
  const nextStableKey = `f${maxIdx + 1}`;

  const fRow = await db.orm.flashcard.create({
    kitId,
    stableKey: nextStableKey,
    front: data.front,
    back: data.back,
    state: 'EDITED' as any,
    orderIndex: allFlashcards.length,
  } as any);

  const fDbId = (fRow as any)._id.toString();

  for (const reqStableKey of data.requirementIds) {
    const reqDbId = reqMap.get(reqStableKey);
    if (reqDbId) {
      await db.orm.flashcardRequirement.create({
        flashcardId: fDbId,
        requirementId: reqDbId,
      } as any);
    }
  }

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Delete Flashcard
 */
export async function deleteFlashcard(kitId: string, userId: string, fid: string) {
  await getReadyKitOrThrow(kitId, userId);

  const flashcard = await db.orm.flashcard.where({ kitId, stableKey: fid }).first();
  if (!flashcard) {
    throw new BuilderError(`Flashcard with id "${fid}" not found`, 404);
  }

  const fDbId = (flashcard as any)._id.toString();
  await db.orm.flashcardRequirement.where({ flashcardId: fDbId }).deleteAll();
  await db.orm.practiceAttempt.where({ flashcardId: fDbId }).deleteAll();
  await db.orm.flashcard.where({ _id: fDbId as any }).deleteAll();

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Reorder Flashcards
 */
export async function reorderFlashcards(kitId: string, userId: string, order: string[]) {
  await getReadyKitOrThrow(kitId, userId);

  for (let i = 0; i < order.length; i++) {
    const fid = order[i];
    if (!fid) continue;
    const f = await db.orm.flashcard.where({ kitId, stableKey: fid }).first();
    if (f) {
      await db.orm.flashcard.where({ _id: (f as any)._id.toString() as any }).update({ orderIndex: i } as any);
    }
  }

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Batch Commit Endpoint logic
 */
export async function commitBuilderDiff(kitId: string, userId: string, diff: any) {
  await getReadyKitOrThrow(kitId, userId);

  let structuralQuestionChanges = false;

  // 1. Brief updates
  if (diff.brief) {
    const updates: any = { briefState: 'EDITED' as any, updatedAt: new Date() };
    if (diff.brief.summary !== undefined) updates.briefSummary = diff.brief.summary;
    if (diff.brief.what_they_do !== undefined) updates.briefWhatTheyDo = diff.brief.what_they_do;
    await db.orm.kit.where({ _id: kitId as any }).update(updates);
  }

  // 2. Question diffs
  if (diff.questions) {
    const qDiff = diff.questions;

    if (qDiff.deletes && Array.isArray(qDiff.deletes)) {
      for (const qid of qDiff.deletes) {
        const q = await db.orm.question.where({ kitId, stableKey: qid }).first();
        if (q) {
          const qDbId = (q as any)._id.toString();
          await db.orm.questionRequirement.where({ questionId: qDbId }).deleteAll();
          await db.orm.scheduleDayQuestion.where({ questionId: qDbId }).deleteAll();
          await db.orm.question.where({ _id: qDbId as any }).deleteAll();
          structuralQuestionChanges = true;
        }
      }
    }

    if (qDiff.creates && Array.isArray(qDiff.creates)) {
      const existingReqs = await db.orm.requirement.where({ kitId }).all();
      const reqMap = new Map<string, string>();
      for (const r of existingReqs) reqMap.set(r.stableKey, (r as any)._id.toString());

      const allQuestions = await db.orm.question.where({ kitId }).all();
      let maxIdx = 0;
      for (const q of allQuestions) {
        const num = parseInt(q.stableKey.replace(/^q/, ''), 10);
        if (!isNaN(num) && num > maxIdx) maxIdx = num;
      }

      for (const createItem of qDiff.creates) {
        maxIdx++;
        const nextStableKey = `q${maxIdx}`;
        const catQuestions = allQuestions.filter((q: any) => q.category === createItem.category);
        const orderIndex = catQuestions.length;

        const qRow = await db.orm.question.create({
          kitId,
          stableKey: nextStableKey,
          category: createItem.category,
          prompt: createItem.prompt,
          answerOutline: createItem.answerOutline ?? createItem.answer_outline ?? "",
          difficulty: createItem.difficulty,
          state: 'EDITED' as any,
          orderIndex,
        } as any);

        const qDbId = (qRow as any)._id.toString();
        if (Array.isArray(createItem.requirementIds)) {
          for (const reqStableKey of createItem.requirementIds) {
            const reqDbId = reqMap.get(reqStableKey);
            if (reqDbId) {
              await db.orm.questionRequirement.create({ questionId: qDbId, requirementId: reqDbId } as any);
            }
          }
        }
        structuralQuestionChanges = true;
      }
    }

    if (qDiff.updates && Array.isArray(qDiff.updates)) {
      for (const upItem of qDiff.updates) {
        const q = await db.orm.question.where({ kitId, stableKey: upItem.id }).first();
        if (q) {
          const qDbId = (q as any)._id.toString();
          const newState = q.state === 'PINNED' ? 'PINNED' : 'EDITED';
          const upData: any = { state: newState as any };
          if (upItem.prompt !== undefined) upData.prompt = upItem.prompt;
          const outline = upItem.answerOutline ?? upItem.answer_outline;
          if (outline !== undefined) upData.answerOutline = outline;
          if (upItem.category !== undefined) upData.category = upItem.category;
          if (upItem.difficulty !== undefined) upData.difficulty = upItem.difficulty;

          await db.orm.question.where({ _id: qDbId as any }).update(upData);

          const slots = await db.orm.scheduleDayQuestion.where({ questionId: qDbId }).all();
          if (slots.length > 0) structuralQuestionChanges = true;
        }
      }
    }

    if (qDiff.pins && Array.isArray(qDiff.pins)) {
      for (const pinItem of qDiff.pins) {
        const q = await db.orm.question.where({ kitId, stableKey: pinItem.id }).first();
        if (q) {
          const newState = pinItem.pinned ? 'PINNED' : 'EDITED';
          await db.orm.question.where({ _id: (q as any)._id.toString() as any }).update({ state: newState as any });
        }
      }
    }

    if (qDiff.reorders && Array.isArray(qDiff.reorders)) {
      for (const reorderGroup of qDiff.reorders) {
        if (Array.isArray(reorderGroup.order)) {
          for (let i = 0; i < reorderGroup.order.length; i++) {
            const qid = reorderGroup.order[i];
            const q = await db.orm.question.where({ kitId, stableKey: qid }).first();
            if (q) {
              await db.orm.question.where({ _id: (q as any)._id.toString() as any }).update({ orderIndex: i } as any);
            }
          }
        }
      }
    }
  }

  // 3. Flashcard diffs
  if (diff.flashcards) {
    const fDiff = diff.flashcards;

    if (fDiff.deletes && Array.isArray(fDiff.deletes)) {
      for (const fid of fDiff.deletes) {
        const f = await db.orm.flashcard.where({ kitId, stableKey: fid }).first();
        if (f) {
          const fDbId = (f as any)._id.toString();
          await db.orm.flashcardRequirement.where({ flashcardId: fDbId }).deleteAll();
          await db.orm.practiceAttempt.where({ flashcardId: fDbId }).deleteAll();
          await db.orm.flashcard.where({ _id: fDbId as any }).deleteAll();
        }
      }
    }

    if (fDiff.creates && Array.isArray(fDiff.creates)) {
      const existingReqs = await db.orm.requirement.where({ kitId }).all();
      const reqMap = new Map<string, string>();
      for (const r of existingReqs) reqMap.set(r.stableKey, (r as any)._id.toString());

      const allFlashcards = await db.orm.flashcard.where({ kitId }).all();
      let maxIdx = 0;
      for (const f of allFlashcards) {
        const num = parseInt(f.stableKey.replace(/^f/, ''), 10);
        if (!isNaN(num) && num > maxIdx) maxIdx = num;
      }

      for (const createItem of fDiff.creates) {
        maxIdx++;
        const nextStableKey = `f${maxIdx}`;
        const fRow = await db.orm.flashcard.create({
          kitId,
          stableKey: nextStableKey,
          front: createItem.front,
          back: createItem.back,
          state: 'EDITED' as any,
          orderIndex: allFlashcards.length,
        } as any);

        const fDbId = (fRow as any)._id.toString();
        if (Array.isArray(createItem.requirementIds)) {
          for (const reqStableKey of createItem.requirementIds) {
            const reqDbId = reqMap.get(reqStableKey);
            if (reqDbId) {
              await db.orm.flashcardRequirement.create({ flashcardId: fDbId, requirementId: reqDbId } as any);
            }
          }
        }
      }
    }

    if (fDiff.updates && Array.isArray(fDiff.updates)) {
      for (const upItem of fDiff.updates) {
        const f = await db.orm.flashcard.where({ kitId, stableKey: upItem.id }).first();
        if (f) {
          const fDbId = (f as any)._id.toString();
          const newState = f.state === 'PINNED' ? 'PINNED' : 'EDITED';
          const upData: any = { state: newState as any };
          if (upItem.front !== undefined) upData.front = upItem.front;
          if (upItem.back !== undefined) upData.back = upItem.back;

          await db.orm.flashcard.where({ _id: fDbId as any }).update(upData);
        }
      }
    }

    if (fDiff.pins && Array.isArray(fDiff.pins)) {
      for (const pinItem of fDiff.pins) {
        const f = await db.orm.flashcard.where({ kitId, stableKey: pinItem.id }).first();
        if (f) {
          const newState = pinItem.pinned ? 'PINNED' : 'EDITED';
          await db.orm.flashcard.where({ _id: (f as any)._id.toString() as any }).update({ state: newState as any });
        }
      }
    }

    if (fDiff.reorders && Array.isArray(fDiff.reorders)) {
      for (const reorderGroup of fDiff.reorders) {
        if (Array.isArray(reorderGroup.order)) {
          for (let i = 0; i < reorderGroup.order.length; i++) {
            const fid = reorderGroup.order[i];
            const f = await db.orm.flashcard.where({ kitId, stableKey: fid }).first();
            if (f) {
              await db.orm.flashcard.where({ _id: (f as any)._id.toString() as any }).update({ orderIndex: i } as any);
            }
          }
        }
      }
    }
  }

  if (structuralQuestionChanges) {
    await db.orm.kit.where({ _id: kitId as any }).update({ scheduleStale: true as any });
  }

  // Recompute coverage
  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    const uncovered = checkCoverage(updatedKit.role.requirements, updatedKit.questions);
    await db.orm.uncoveredRequirement.where({ kitId }).deleteAll();
    for (const stableKey of uncovered) {
      await db.orm.uncoveredRequirement.create({ kitId, stableKey } as any);
    }
    const finalKit = await rebuildKitFromDb(kitId);
    if (finalKit) {
      await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(finalKit) } as any);
      const latestKitRow = await db.orm.kit.where({ _id: kitId as any }).first();
      return {
        kit: finalKit,
        scheduleStale: Boolean((latestKitRow as any)?.scheduleStale),
        briefState: (latestKitRow as any)?.briefState ?? 'GENERATED',
      };
    }
  }

  const latestKitRow = await db.orm.kit.where({ _id: kitId as any }).first();
  return {
    kit: updatedKit,
    scheduleStale: Boolean((latestKitRow as any)?.scheduleStale),
    briefState: (latestKitRow as any)?.briefState ?? 'GENERATED',
  };
}

/**
 * Regenerate Brief Endpoint
 */
export async function regenerateBriefEndpoint(kitId: string, userId: string) {
  const kit = await getReadyKitOrThrow(kitId, userId);

  if (kit.briefState === 'EDITED') {
    throw new BuilderError('Brief has manual edits — discard them first or they will be lost', 409);
  }

  let aboutText: string | null = null;
  if (kit.research) {
    try {
      const bundle: ResearchBundle = typeof kit.research === 'string' ? JSON.parse(kit.research) : kit.research;
      aboutText = bundle.aboutText ?? null;
    } catch {
      // ignore JSON parse failure
    }
  }

  const briefSources = await db.orm.briefSource.where({ kitId }).all();
  const sources = briefSources.map((s: any) => s.url);

  const { companyBrief } = await generateBrief(aboutText, sources);

  await db.orm.kit.where({ _id: kitId as any }).update({
    briefSummary: companyBrief.summary,
    briefWhatTheyDo: companyBrief.what_they_do,
    briefState: 'GENERATED' as any,
    updatedAt: new Date(),
  } as any);

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Regenerate Questions for One Category
 */
export async function regenerateQuestionsCategoryEndpoint(
  kitId: string,
  userId: string,
  category: QuestionCategory
) {
  const kit = await getReadyKitOrThrow(kitId, userId);

  const currentQuestions = await db.orm.question.where({ kitId, category }).all();

  // Split: keep = state !== 'GENERATED' (EDITED/PINNED), replace = state === 'GENERATED'
  const replaceQuestions = currentQuestions.filter((q: any) => q.state === 'GENERATED');

  if (replaceQuestions.length === 0) {
    return rebuildKitFromDb(kitId);
  }

  for (const q of replaceQuestions) {
    const qDbId = (q as any)._id.toString();
    await db.orm.questionRequirement.where({ questionId: qDbId }).deleteAll();
    await db.orm.scheduleDayQuestion.where({ questionId: qDbId }).deleteAll();
    await db.orm.question.where({ _id: qDbId as any }).deleteAll();
  }

  const dbReqs = await db.orm.requirement.where({ kitId }).all();
  const reqMap = new Map<string, string>();
  const requirements = dbReqs.map((r: any) => {
    reqMap.set(r.stableKey, r._id.toString());
    return {
      id: r.stableKey,
      text: r.text,
      kind: r.kind,
      priority: r.priority,
    };
  });

  const seniority = kit.roleSeniority || '';

  const targetReqs = requirements.filter((r) => {
    if (category === 'technical') return r.kind === 'technical' && !isSystemDesignRequirement(r, seniority);
    if (category === 'system-design') return r.kind === 'technical' && isSystemDesignRequirement(r, seniority);
    if (category === 'behavioural') return r.kind === 'behavioural';
    if (category === 'company-fit') return r.kind === 'domain';
    return false;
  });

  let hiringProcessText: string | null = null;
  if (kit.research) {
    try {
      const bundle: ResearchBundle = typeof kit.research === 'string' ? JSON.parse(kit.research) : kit.research;
      hiringProcessText = bundle.hiringProcessText ?? null;
    } catch {
      // ignore
    }
  }

  const generated = await generateQuestionsForCategory(
    targetReqs.length > 0 ? targetReqs : requirements,
    category,
    kit.daysAvailable,
    hiringProcessText
  );

  const allKitQuestions = await db.orm.question.where({ kitId }).all();
  let maxIdx = 0;
  for (const q of allKitQuestions) {
    const num = parseInt(q.stableKey.replace(/^q/, ''), 10);
    if (!isNaN(num) && num > maxIdx) maxIdx = num;
  }

  const categoryQuestions = allKitQuestions.filter((q: any) => q.category === category);
  let orderIdx = categoryQuestions.length;

  for (const g of generated) {
    maxIdx++;
    orderIdx++;
    const stableKey = `q${maxIdx}`;
    const qRow = await db.orm.question.create({
      kitId,
      stableKey,
      category,
      prompt: g.prompt,
      answerOutline: g.answer_outline,
      difficulty: g.difficulty,
      state: 'GENERATED' as any,
      orderIndex: orderIdx,
    } as any);

    const qDbId = (qRow as any)._id.toString();
    for (const reqStableKey of g.requirement_ids) {
      const reqDbId = reqMap.get(reqStableKey);
      if (reqDbId) {
        await db.orm.questionRequirement.create({ questionId: qDbId, requirementId: reqDbId } as any);
      }
    }
  }

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    const uncovered = checkCoverage(updatedKit.role.requirements, updatedKit.questions);
    await db.orm.uncoveredRequirement.where({ kitId }).deleteAll();
    for (const stableKey of uncovered) {
      await db.orm.uncoveredRequirement.create({ kitId, stableKey } as any);
    }
  }

  await db.orm.kit.where({ _id: kitId as any }).update({ scheduleStale: true as any });

  const finalKit = await rebuildKitFromDb(kitId);
  if (finalKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(finalKit) } as any);
  }
  return finalKit;
}

/**
 * Regenerate Schedule Endpoint
 */
export async function regenerateScheduleEndpoint(kitId: string, userId: string) {
  const kit = await getReadyKitOrThrow(kitId, userId);

  const currentKit = await rebuildKitFromDb(kitId);
  if (!currentKit) {
    throw new BuilderError('Failed to load kit data', 500);
  }

  const newSchedule = buildSchedule(currentKit.questions, currentKit.role.requirements, kit.daysAvailable);

  const dbDays = await db.orm.scheduleDay.where({ kitId }).all();
  for (const d of dbDays) {
    const dayDbId = (d as any)._id.toString();
    await db.orm.scheduleDayQuestion.where({ scheduleDayId: dayDbId }).deleteAll();
    await db.orm.scheduleDay.where({ _id: dayDbId as any }).deleteAll();
  }

  const dbQuestions = await db.orm.question.where({ kitId }).all();
  const qMap = new Map<string, string>();
  for (const q of dbQuestions) {
    qMap.set(q.stableKey, (q as any)._id.toString());
  }

  for (const day of newSchedule.days) {
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
      const qDbId = qMap.get(qStableKey);
      if (qDbId) {
        await db.orm.scheduleDayQuestion.create({
          scheduleDayId: dayDbId,
          questionId: qDbId,
          position: pos,
        } as any);
      }
    }
  }

  await db.orm.kit.where({ _id: kitId as any }).update({ scheduleStale: false as any });

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }
  return updatedKit;
}

/**
 * Manual Schedule Edit Endpoint
 */
export async function manualScheduleEdit(
  kitId: string,
  userId: string,
  days: { day: number; focus?: string; question_ids: string[]; minutes?: number }[]
) {
  const kit = await getReadyKitOrThrow(kitId, userId);

  if (days.length !== kit.daysAvailable) {
    throw new BuilderError(
      `Schedule edit must have exactly ${kit.daysAvailable} days (got ${days.length})`,
      400
    );
  }

  const dbQuestions = await db.orm.question.where({ kitId }).all();
  const qMap = new Map<string, any>();
  for (const q of dbQuestions) {
    qMap.set(q.stableKey, q);
  }

  for (const dayItem of days) {
    for (const qid of dayItem.question_ids) {
      if (!qMap.has(qid)) {
        throw new BuilderError(`Invalid question_id "${qid}" in day ${dayItem.day} — question does not exist`, 400);
      }
    }
  }

  const existingDays = await db.orm.scheduleDay.where({ kitId }).all();
  for (const d of existingDays) {
    const dayDbId = (d as any)._id.toString();
    await db.orm.scheduleDayQuestion.where({ scheduleDayId: dayDbId }).deleteAll();
    await db.orm.scheduleDay.where({ _id: dayDbId as any }).deleteAll();
  }

  for (const dayItem of days) {
    let dayMinutes = dayItem.minutes;
    if (dayMinutes === undefined || dayMinutes === null) {
      dayMinutes = dayItem.question_ids.reduce((acc, qid) => {
        const q = qMap.get(qid);
        return acc + (TIME_PER_DIFFICULTY_MIN[q?.difficulty] ?? 15);
      }, 0);
    }

    const focusText = dayItem.focus ?? 'Custom focus';

    const dayRow = await db.orm.scheduleDay.create({
      kitId,
      dayNumber: dayItem.day,
      focus: focusText,
      minutes: dayMinutes,
    } as any);

    const dayDbId = (dayRow as any)._id.toString();

    for (let pos = 0; pos < dayItem.question_ids.length; pos++) {
      const qid = dayItem.question_ids[pos];
      if (!qid) continue;
      const q = qMap.get(qid);
      if (q) {
        await db.orm.scheduleDayQuestion.create({
          scheduleDayId: dayDbId,
          questionId: (q as any)._id.toString(),
          position: pos,
        } as any);
      }
    }
  }

  await db.orm.kit.where({ _id: kitId as any }).update({ scheduleStale: false as any });

  const updatedKit = await rebuildKitFromDb(kitId);
  if (updatedKit) {
    await db.orm.kit.where({ _id: kitId as any }).update({ result: JSON.stringify(updatedKit) } as any);
  }

  const warnings: string[] = [];
  if (updatedKit) {
    const scheduledQuestionIds = new Set(days.flatMap((d) => d.question_ids));
    const scheduledReqIds = new Set(
      [...scheduledQuestionIds].flatMap(
        (qid) => updatedKit.questions.find((q) => q.id === qid)?.requirement_ids ?? []
      )
    );
    const mustReqs = updatedKit.role.requirements.filter((r) => r.priority === 'must');
    const unscheduledMusts = mustReqs.filter((r) => !scheduledReqIds.has(r.id));
    if (unscheduledMusts.length > 0) {
      warnings.push(`Unscheduled must-have requirements: ${unscheduledMusts.map((r) => r.text).join(', ')}`);
    }
  }

  return { kit: updatedKit, warnings };
}
