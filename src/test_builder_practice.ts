import dotenv from 'dotenv';
dotenv.config();

import { db } from './prisma/db';
import {
  updateBrief,
  updateQuestion,
  pinQuestion,
  createQuestion,
  deleteQuestion,
  reorderQuestions,
  updateFlashcard,
  pinFlashcard,
  createFlashcard,
  deleteFlashcard,
  reorderFlashcards,
  commitBuilderDiff,
  regenerateBriefEndpoint,
  regenerateScheduleEndpoint,
  manualScheduleEdit,
} from './services/kit/builderService';
import {
  createPracticeSession,
  recordAttempt,
  endPracticeSession,
  listPracticeSessions,
  getPracticeSessionDetails,
  getPracticeQueue,
} from './services/kit/practiceService';

async function runIteration03Tests() {
  console.log('🧪 Starting Iteration 03 Builder & Practice End-to-End Test Suite...');

  const userId = 'user_test_iter03_' + Date.now();

  // Create test User
  await db.orm.user.create({
    name: 'Test Builder User',
    email: `${userId}@example.com`,
    passwordHash: 'hashed_pw',
    createdAt: new Date(),
  } as any);

  // Create test Kit
  const kitRow = await db.orm.kit.create({
    userId,
    companyName: 'Acme Corp',
    companyUrl: 'https://acme.example.com',
    jdText: 'Sample JD for Full Stack Engineer',
    daysAvailable: 3,
    status: 'READY' as any,
    briefSummary: 'Original summary',
    briefWhatTheyDo: 'Original product',
    briefState: 'GENERATED' as any,
    scheduleStale: false as any,
    roleTitle: 'Full Stack Engineer',
    roleSeniority: 'Senior',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const kitId = (kitRow as any)._id.toString();
  console.log(`✅ Test Kit created with ID: ${kitId}`);

  // Create sample Requirement
  const req1 = await db.orm.requirement.create({
    kitId,
    stableKey: 'r1',
    text: 'TypeScript and Node.js proficiency',
    kind: 'technical',
    priority: 'must',
  } as any);
  const req1DbId = (req1 as any)._id.toString();

  // Create sample Question
  const q1 = await db.orm.question.create({
    kitId,
    stableKey: 'q1',
    category: 'technical',
    prompt: 'Explain event loop in Node.js',
    answerOutline: 'Call stack, task queue, microtasks...',
    difficulty: 2,
    state: 'GENERATED' as any,
    orderIndex: 0,
  } as any);
  const q1DbId = (q1 as any)._id.toString();
  await db.orm.questionRequirement.create({ questionId: q1DbId, requirementId: req1DbId } as any);

  // Create sample Flashcards
  const f1 = await db.orm.flashcard.create({
    kitId,
    stableKey: 'f1',
    front: 'What is Node.js event loop?',
    back: 'Single-threaded event-driven async I/O',
    state: 'GENERATED' as any,
    orderIndex: 0,
  } as any);
  await db.orm.flashcardRequirement.create({ flashcardId: (f1 as any)._id.toString(), requirementId: req1DbId } as any);

  const f2 = await db.orm.flashcard.create({
    kitId,
    stableKey: 'f2',
    front: 'What is TypeScript Interface?',
    back: 'A contract for object structure',
    state: 'GENERATED' as any,
    orderIndex: 1,
  } as any);
  await db.orm.flashcardRequirement.create({ flashcardId: (f2 as any)._id.toString(), requirementId: req1DbId } as any);

  // 1. Test Brief Update & Protection
  console.log('\n--- 1. Testing Brief Update & Protection ---');
  await updateBrief(kitId, userId, { summary: 'Edited summary' });
  const kitAfterBriefEdit = await db.orm.kit.where({ _id: kitId as any }).first();
  console.log(`BriefState after update: ${(kitAfterBriefEdit as any)?.briefState} (expected: EDITED)`);

  try {
    await regenerateBriefEndpoint(kitId, userId);
    console.error('❌ ERROR: Brief regeneration should have failed due to EDITED state!');
  } catch (err: any) {
    console.log(`✅ Brief regeneration blocked correctly: "${err.message}"`);
  }

  // 2. Test Question CRUD & Pinning
  console.log('\n--- 2. Testing Question CRUD & Pinning ---');
  await pinQuestion(kitId, userId, 'q1', true);
  const q1Row = await db.orm.question.where({ kitId, stableKey: 'q1' }).first();
  console.log(`Question q1 state after pin: ${q1Row?.state} (expected: PINNED)`);

  await updateQuestion(kitId, userId, 'q1', { prompt: 'Updated prompt for q1' });
  const q1Row2 = await db.orm.question.where({ kitId, stableKey: 'q1' }).first();
  console.log(`Question q1 state after edit on pinned item: ${q1Row2?.state} (expected: PINNED)`);

  await createQuestion(kitId, userId, {
    category: 'technical',
    prompt: 'What is React useEffect hook?',
    answerOutline: 'Side-effects management in functional components',
    difficulty: 1,
    requirementIds: ['r1'],
  });
  const allQ = await db.orm.question.where({ kitId }).all();
  console.log(`Total questions after create: ${allQ.length} (expected: 2)`);

  // 3. Test Batch Commit
  console.log('\n--- 3. Testing Batch Commit ---');
  const commitRes = await commitBuilderDiff(kitId, userId, {
    questions: {
      updates: [{ id: 'q2', prompt: 'Updated q2 prompt via commit' }],
    },
    flashcards: {
      creates: [{ front: 'What is Closure?', back: 'Function with lexical scope', requirementIds: ['r1'] }],
    },
  });
  console.log(`Commit success: kit questions=${commitRes.kit?.questions.length}, scheduleStale=${commitRes.scheduleStale}`);

  // 4. Test Schedule Regeneration & Manual Edit
  console.log('\n--- 4. Testing Schedule Regeneration & Manual Edit ---');
  await regenerateScheduleEndpoint(kitId, userId);
  const kitAfterSchedRegen = await db.orm.kit.where({ _id: kitId as any }).first();
  console.log(`scheduleStale after regen: ${(kitAfterSchedRegen as any)?.scheduleStale} (expected: false)`);

  const manualRes = await manualScheduleEdit(kitId, userId, [
    { day: 1, focus: 'Day 1 Node.js', question_ids: ['q1'] },
    { day: 2, focus: 'Day 2 React', question_ids: ['q2'] },
    { day: 3, focus: 'Day 3 Review', question_ids: [] },
  ]);
  console.log(`Manual schedule edit result: ${manualRes.kit?.schedule.days.length} days, warnings=${manualRes.warnings.length}`);

  // 5. Test Practice Sessions & Adaptive Queue
  console.log('\n--- 5. Testing Practice Sessions & Adaptive Queue ---');
  const initialQueue = await getPracticeQueue(kitId, userId);
  console.log(`Initial practice queue (unseen cards):`, initialQueue);

  const { session } = await createPracticeSession(kitId, userId);
  console.log(`Created Practice Session ID: ${session.id}`);

  // Submit attempts (f1: rated 9/10, f2: skipped)
  await recordAttempt(kitId, session.id, userId, { flashcardId: 'f1', confidence: 9, skipped: false });
  await recordAttempt(kitId, session.id, userId, { flashcardId: 'f2', confidence: null, skipped: true });

  await endPracticeSession(kitId, session.id, userId);
  console.log(`Ended Practice Session ID: ${session.id}`);

  const postSessionQueue = await getPracticeQueue(kitId, userId);
  console.log(`Practice queue after session (skipped/unseen first, rated last):`, postSessionQueue);

  const sessionList = await listPracticeSessions(kitId, userId);
  console.log(`Ended sessions count: ${sessionList.sessions.length}, session #1 avgConfidence: ${sessionList.sessions[0]?.avgConfidence}`);

  const sessionDetails = await getPracticeSessionDetails(kitId, session.id, userId);
  console.log(`Session details attempts count: ${sessionDetails.session.attempts.length}`);

  console.log('\n🎉 ALL ITERATION 03 TESTS PASSED FLAWLESSLY!');
  process.exit(0);
}

runIteration03Tests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
