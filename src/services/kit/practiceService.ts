import { db } from '../../prisma/db';
import { BuilderError, getReadyKitOrThrow } from './builderService';

export async function createPracticeSession(kitId: string, userId: string) {
  await getReadyKitOrThrow(kitId, userId);

  const flashcards = await db.orm.flashcard.where({ kitId }).all();
  if (flashcards.length === 0) {
    throw new BuilderError('Kit has no flashcards for practice', 409);
  }

  const session = await db.orm.practiceSession.create({
    userId,
    kitId,
    startedAt: new Date(),
    endedAt: null,
  } as any);

  const sessionId = (session as any)._id.toString();
  return {
    session: {
      id: sessionId,
      startedAt: session.startedAt,
    },
  };
}

export async function recordAttempt(
  kitId: string,
  sessionId: string,
  userId: string,
  data: {
    flashcardId: string; // stableKey, e.g. "f1"
    confidence: number | null;
    skipped: boolean;
  }
) {
  await getReadyKitOrThrow(kitId, userId);

  const session = await db.orm.practiceSession.where({ _id: sessionId as any }).first();
  if (!session || (session as any).userId !== userId || (session as any).kitId !== kitId) {
    throw new BuilderError('Practice session not found', 404);
  }

  if (session.endedAt) {
    throw new BuilderError('Cannot submit attempt to an ended session', 409);
  }

  const flashcard = await db.orm.flashcard.where({ kitId, stableKey: data.flashcardId }).first();
  if (!flashcard) {
    throw new BuilderError(`Flashcard with id "${data.flashcardId}" not found`, 404);
  }

  const fDbId = (flashcard as any)._id.toString();
  const isSkipped = Boolean(data.skipped);
  const confidenceVal = isSkipped ? null : data.confidence;

  const attempt = await db.orm.practiceAttempt.create({
    sessionId,
    flashcardId: fDbId,
    confidence: confidenceVal,
    skipped: isSkipped,
    attemptedAt: new Date(),
  } as any);

  return {
    attempt: {
      id: (attempt as any)._id.toString(),
      flashcardId: data.flashcardId,
      confidence: confidenceVal,
      skipped: isSkipped,
      attemptedAt: attempt.attemptedAt,
    },
  };
}

export async function endPracticeSession(kitId: string, sessionId: string, userId: string) {
  await getReadyKitOrThrow(kitId, userId);

  const session = await db.orm.practiceSession.where({ _id: sessionId as any }).first();
  if (!session || (session as any).userId !== userId || (session as any).kitId !== kitId) {
    throw new BuilderError('Practice session not found', 404);
  }

  const endedAt = new Date();
  await db.orm.practiceSession.where({ _id: sessionId as any }).update({ endedAt } as any);

  return {
    session: {
      id: sessionId,
      startedAt: session.startedAt,
      endedAt,
    },
  };
}

export async function listPracticeSessions(kitId: string, userId: string) {
  await getReadyKitOrThrow(kitId, userId);

  const sessions = await db.orm.practiceSession.where({ kitId, userId }).all();
  const endedSessions = sessions
    .filter((s: any) => s.endedAt !== null && s.endedAt !== undefined)
    .sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const result = [];
  for (const s of endedSessions) {
    const sDbId = (s as any)._id.toString();
    const attempts = await db.orm.practiceAttempt.where({ sessionId: sDbId }).all();
    const ratedAttempts = attempts.filter((a: any) => a.confidence !== null && a.confidence !== undefined);
    const avgConfidence =
      ratedAttempts.length > 0
        ? Number(
            (
              ratedAttempts.reduce((acc: number, a: any) => acc + Number(a.confidence), 0) /
              ratedAttempts.length
            ).toFixed(1)
          )
        : null;

    result.push({
      id: sDbId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      attemptCount: attempts.length,
      avgConfidence,
    });
  }

  return { sessions: result };
}

export async function getPracticeSessionDetails(kitId: string, sessionId: string, userId: string) {
  await getReadyKitOrThrow(kitId, userId);

  const session = await db.orm.practiceSession.where({ _id: sessionId as any }).first();
  if (!session || (session as any).userId !== userId || (session as any).kitId !== kitId) {
    throw new BuilderError('Practice session not found', 404);
  }

  const attempts = await db.orm.practiceAttempt.where({ sessionId }).all();

  const attemptsWithFlashcards = [];
  for (const a of attempts) {
    const flashcard = await db.orm.flashcard.where({ _id: a.flashcardId as any }).first();
    attemptsWithFlashcards.push({
      id: (a as any)._id.toString(),
      flashcardId: flashcard?.stableKey || a.flashcardId,
      front: flashcard?.front || '',
      back: flashcard?.back || '',
      confidence: a.confidence,
      skipped: Boolean(a.skipped),
      attemptedAt: a.attemptedAt,
    });
  }

  return {
    session: {
      id: sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      attempts: attemptsWithFlashcards,
    },
  };
}

export async function getPracticeQueue(kitId: string, userId: string): Promise<string[]> {
  await getReadyKitOrThrow(kitId, userId);

  const flashcards = await db.orm.flashcard.where({ kitId }).all();
  if (flashcards.length === 0) return [];

  const sessions = await db.orm.practiceSession.where({ kitId, userId }).all();
  const endedSessionIds = new Set(
    sessions
      .filter((s: any) => s.endedAt !== null && s.endedAt !== undefined)
      .map((s: any) => (s as any)._id.toString())
  );

  const lastAttemptByCard = new Map<string, any>();

  if (endedSessionIds.size > 0) {
    for (const sid of endedSessionIds) {
      const attempts = await db.orm.practiceAttempt.where({ sessionId: sid }).all();
      for (const att of attempts) {
        const existing = lastAttemptByCard.get(att.flashcardId);
        if (!existing || new Date(att.attemptedAt).getTime() > new Date(existing.attemptedAt).getTime()) {
          lastAttemptByCard.set(att.flashcardId, att);
        }
      }
    }
  }

  const dbRequirements = await db.orm.requirement.where({ kitId }).all();
  const mustReqDbIds = new Set(
    dbRequirements.filter((r: any) => r.priority === 'must').map((r: any) => (r as any)._id.toString())
  );

  const cardMustPriorityMap = new Map<string, boolean>();
  for (const f of flashcards) {
    const fDbId = (f as any)._id.toString();
    const joins = await db.orm.flashcardRequirement.where({ flashcardId: fDbId }).all();
    const hasMust = joins.some((j: any) => mustReqDbIds.has(j.requirementId));
    cardMustPriorityMap.set(fDbId, hasMust);
  }

  const unseen: any[] = [];
  const rated: { card: any; confidence: number }[] = [];

  for (const card of flashcards) {
    const fDbId = (card as any)._id.toString();
    const last = lastAttemptByCard.get(fDbId);
    const cardUpdatedAt = (card as any).updatedAt ? new Date((card as any).updatedAt).getTime() : 0;
    const lastAttemptedAt = last ? new Date(last.attemptedAt).getTime() : 0;

    const isStale =
      !last ||
      cardUpdatedAt > lastAttemptedAt ||
      last.confidence === null ||
      last.confidence === undefined ||
      Boolean(last.skipped);

    if (isStale) {
      unseen.push(card);
    } else {
      rated.push({ card, confidence: Number(last.confidence) });
    }
  }

  const priorityRank = (card: any) => (cardMustPriorityMap.get((card as any)._id.toString()) ? 0 : 1);

  unseen.sort((a, b) => priorityRank(a) - priorityRank(b));
  rated.sort((a, b) => a.confidence - b.confidence || priorityRank(a.card) - priorityRank(b.card));

  const resultQueue = [...unseen.map((c) => c.stableKey), ...rated.map((r) => r.card.stableKey)];
  return resultQueue;
}
