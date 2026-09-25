import { db } from '../../prisma/db';
import { BuilderError, getReadyKitOrThrow } from './builderService';
import { openrouter } from '../../llm/openrouterClient';
import { callOpenRouter } from '../../llm/callWithRetry';

export interface MockExamQuestionInput {
  questionId: string;    // stableKey e.g. "q1"
  questionText: string;
  answerOutline: string;
  category: string;
  difficulty: number;
  userNotes?: string;
  confidence?: number | null;
  flagged?: boolean;
  position: number;
}

export interface SaveMockExamInput {
  title: string;
  startedAt: string; // ISO string
  finishedAt: string; // ISO string
  durationSec: number;
  questions: MockExamQuestionInput[];
}

// ── Save a completed mock exam ──────────────────────────────────────────────
export async function saveMockExam(kitId: string, userId: string, input: SaveMockExamInput) {
  await getReadyKitOrThrow(kitId, userId);

  const exam = await db.orm.mockExam.create({
    userId,
    kitId,
    title: input.title,
    startedAt: new Date(input.startedAt),
    finishedAt: new Date(input.finishedAt),
    durationSec: input.durationSec,
    aiReport: null,
  } as any);

  const examId = (exam as any)._id.toString();

  for (const q of input.questions) {
    await db.orm.mockExamQuestion.create({
      mockExamId: examId,
      questionId: q.questionId,
      questionText: q.questionText,
      answerOutline: q.answerOutline,
      category: q.category,
      difficulty: q.difficulty,
      userNotes: q.userNotes ?? null,
      confidence: q.confidence ?? null,
      flagged: q.flagged ?? false,
      position: q.position,
    } as any);
  }

  return { examId };
}

// ── List mock exams for a kit ──────────────────────────────────────────────
export async function listMockExams(kitId: string, userId: string) {
  await getReadyKitOrThrow(kitId, userId);

  const exams = await db.orm.mockExam.where({ kitId, userId } as any).all();
  const sorted = [...exams].sort(
    (a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  const result = sorted.map((e: any) => ({
    id: (e as any)._id.toString(),
    title: e.title,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    durationSec: e.durationSec,
    hasAiReport: Boolean(e.aiReport),
    questionCount: 0, // will be filled below
  }));

  // Get question counts in parallel
  await Promise.all(
    result.map(async (r, i) => {
      const qs = await db.orm.mockExamQuestion.where({ mockExamId: r.id } as any).all();
      result[i]!.questionCount = qs.length;
    })
  );

  return { exams: result };
}

// ── Get a single mock exam detail ──────────────────────────────────────────
export async function getMockExamDetail(kitId: string, examId: string, userId: string) {
  await getReadyKitOrThrow(kitId, userId);

  const exam = await db.orm.mockExam.where({ _id: examId as any } as any).first();
  if (!exam || (exam as any).userId !== userId || (exam as any).kitId !== kitId) {
    throw new BuilderError('Mock exam not found', 404);
  }

  const questions = await db.orm.mockExamQuestion.where({ mockExamId: examId } as any).all();
  const sorted = [...questions].sort((a: any, b: any) => a.position - b.position);

  let aiReport: any = null;
  if ((exam as any).aiReport) {
    try { aiReport = JSON.parse((exam as any).aiReport); } catch {}
  }

  return {
    exam: {
      id: examId,
      title: (exam as any).title,
      startedAt: (exam as any).startedAt,
      finishedAt: (exam as any).finishedAt,
      durationSec: (exam as any).durationSec,
      aiReport,
      questions: sorted.map((q: any) => ({
        id: (q as any)._id.toString(),
        questionId: q.questionId,
        questionText: q.questionText,
        answerOutline: q.answerOutline,
        category: q.category,
        difficulty: q.difficulty,
        userNotes: q.userNotes ?? null,
        confidence: q.confidence ?? null,
        flagged: Boolean(q.flagged),
        position: q.position,
      })),
    },
  };
}

// ── Generate AI coaching report for a mock exam ───────────────────────────
export async function generateAiReport(kitId: string, examId: string, userId: string) {
  await getReadyKitOrThrow(kitId, userId);

  const exam = await db.orm.mockExam.where({ _id: examId as any } as any).first();
  if (!exam || (exam as any).userId !== userId || (exam as any).kitId !== kitId) {
    throw new BuilderError('Mock exam not found', 404);
  }

  const questions = await db.orm.mockExamQuestion.where({ mockExamId: examId } as any).all();
  const sorted = [...questions].sort((a: any, b: any) => a.position - b.position);

  const avgConfidence =
    sorted.filter((q: any) => q.confidence !== null && q.confidence !== undefined).length > 0
      ? sorted
          .filter((q: any) => q.confidence !== null && q.confidence !== undefined)
          .reduce((sum: number, q: any) => sum + Number(q.confidence), 0) /
        sorted.filter((q: any) => q.confidence !== null && q.confidence !== undefined).length
      : null;

  const flaggedCount = sorted.filter((q: any) => q.flagged).length;
  const ratedCount = sorted.filter((q: any) => q.confidence !== null).length;

  const questionsText = sorted
    .map(
      (q: any, i: number) =>
        `Q${i + 1} [${q.category}, difficulty ${q.difficulty}/3, confidence ${q.confidence ?? 'not rated'}/10${q.flagged ? ', FLAGGED' : ''}]:
Question: ${q.questionText.slice(0, 200)}
User Notes: ${q.userNotes ? q.userNotes.slice(0, 200) : 'None'}
Expected Answer Key: ${q.answerOutline.slice(0, 300)}`
    )
    .join('\n\n');

  const prompt = `You are an expert interview coach reviewing a mock interview session. Analyze this candidate's mock exam performance and provide a detailed, personalized coaching report.

Exam: "${(exam as any).title}"
Duration: ${(exam as any).durationSec ? Math.round((exam as any).durationSec / 60) : 'N/A'} minutes
Total Questions: ${sorted.length}
Questions Rated: ${ratedCount}/${sorted.length}
Average Confidence: ${avgConfidence !== null ? `${avgConfidence.toFixed(1)}/10` : 'N/A'}
Questions Flagged for Review: ${flaggedCount}

Questions and Performance:
${questionsText}

Provide a JSON coaching report with this EXACT structure (no markdown, no explanation):
{
  "overallScore": 72,
  "grade": "B",
  "summary": "2-3 sentence honest overall assessment",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "focusAreas": [
    {
      "area": "Topic or category name",
      "priority": "high|medium|low",
      "advice": "Specific actionable advice 2-3 sentences",
      "studyTopics": ["topic 1", "topic 2"]
    }
  ],
  "questionFeedback": [
    {
      "position": 1,
      "performance": "strong|adequate|needs_work",
      "feedback": "Brief specific feedback for this question"
    }
  ],
  "nextSteps": ["action 1", "action 2", "action 3"],
  "motivationalNote": "One encouraging personalized sentence"
}`;

  const messages = [{ role: 'user', content: prompt }];
  let reportJson: any = null;

  try {
    const raw = await callOpenRouter(openrouter, messages, 0.4);
    let clean = raw.trim();
    if (clean.startsWith('```json')) clean = clean.slice(7);
    if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    reportJson = JSON.parse(clean.trim());
  } catch (e: any) {
    throw new BuilderError(`AI report generation failed: ${e.message}`, 500);
  }

  // Persist the report
  await db.orm.mockExam.where({ _id: examId as any } as any).update({
    aiReport: JSON.stringify(reportJson),
  } as any);

  return { report: reportJson };
}
