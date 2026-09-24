import { Router } from 'express';
import type { Request, Response } from 'express';
import { isAuth } from '../middleware';
import {
  BuilderError,
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
  regenerateQuestionsCategoryEndpoint,
  regenerateScheduleEndpoint,
  manualScheduleEdit,
} from '../services/kit/builderService';

const router = Router();

function handleBuilderError(err: any, res: Response) {
  if (err instanceof BuilderError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  return res.status(500).json({ success: false, error: err.message || 'Server error' });
}

// ── Brief CRUD ─────────────────────────────────────────────────────────────
router.patch('/kits/:id/brief', isAuth, async (req: Request, res: Response) => {
  try {
    const updatedKit = await updateBrief(req.params.id as string, req.user!.userId, req.body);
    return res.status(200).json({ success: true, kit: updatedKit, briefState: 'EDITED' });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

// ── Question CRUD ──────────────────────────────────────────────────────────
router.patch('/kits/:id/questions/reorder', isAuth, async (req: Request, res: Response) => {
  try {
    const { category, order } = req.body;
    if (!category || !Array.isArray(order)) {
      return res.status(400).json({ success: false, error: 'category and order array required' });
    }
    const updatedKit = await reorderQuestions(req.params.id as string, req.user!.userId, category, order);
    return res.status(200).json({ success: true, kit: updatedKit });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.patch('/kits/:id/questions/:qid/pin', isAuth, async (req: Request, res: Response) => {
  try {
    const { pinned } = req.body;
    if (typeof pinned !== 'boolean') {
      return res.status(400).json({ success: false, error: 'pinned boolean required' });
    }
    const updatedKit = await pinQuestion(req.params.id as string, req.user!.userId, req.params.qid as string, pinned);
    return res.status(200).json({ success: true, kit: updatedKit });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.patch('/kits/:id/questions/:qid', isAuth, async (req: Request, res: Response) => {
  try {
    const { kit, scheduleStale } = await updateQuestion(
      req.params.id as string,
      req.user!.userId,
      req.params.qid as string,
      req.body
    );
    return res.status(200).json({ success: true, kit, scheduleStale });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.post('/kits/:id/questions', isAuth, async (req: Request, res: Response) => {
  try {
    const { category, prompt, answerOutline, difficulty, requirementIds } = req.body;
    if (!category || !prompt || !answerOutline || !difficulty || !Array.isArray(requirementIds)) {
      return res.status(400).json({ success: false, error: 'category, prompt, answerOutline, difficulty, requirementIds required' });
    }
    const updatedKit = await createQuestion(req.params.id as string, req.user!.userId, {
      category,
      prompt,
      answerOutline,
      difficulty,
      requirementIds,
    });
    return res.status(201).json({ success: true, kit: updatedKit, scheduleStale: true });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.delete('/kits/:id/questions/:qid', isAuth, async (req: Request, res: Response) => {
  try {
    const updatedKit = await deleteQuestion(req.params.id as string, req.user!.userId, req.params.qid as string);
    return res.status(200).json({ success: true, kit: updatedKit, scheduleStale: true });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

// ── Flashcard CRUD ─────────────────────────────────────────────────────────
router.patch('/kits/:id/flashcards/reorder', isAuth, async (req: Request, res: Response) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, error: 'order array required' });
    }
    const updatedKit = await reorderFlashcards(req.params.id as string, req.user!.userId, order);
    return res.status(200).json({ success: true, kit: updatedKit });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.patch('/kits/:id/flashcards/:fid/pin', isAuth, async (req: Request, res: Response) => {
  try {
    const { pinned } = req.body;
    if (typeof pinned !== 'boolean') {
      return res.status(400).json({ success: false, error: 'pinned boolean required' });
    }
    const updatedKit = await pinFlashcard(req.params.id as string, req.user!.userId, req.params.fid as string, pinned);
    return res.status(200).json({ success: true, kit: updatedKit });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.patch('/kits/:id/flashcards/:fid', isAuth, async (req: Request, res: Response) => {
  try {
    const updatedKit = await updateFlashcard(
      req.params.id as string,
      req.user!.userId,
      req.params.fid as string,
      req.body
    );
    return res.status(200).json({ success: true, kit: updatedKit });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.post('/kits/:id/flashcards', isAuth, async (req: Request, res: Response) => {
  try {
    const { front, back, requirementIds } = req.body;
    if (!front || !back || !Array.isArray(requirementIds)) {
      return res.status(400).json({ success: false, error: 'front, back, requirementIds required' });
    }
    const updatedKit = await createFlashcard(req.params.id as string, req.user!.userId, {
      front,
      back,
      requirementIds,
    });
    return res.status(201).json({ success: true, kit: updatedKit });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.delete('/kits/:id/flashcards/:fid', isAuth, async (req: Request, res: Response) => {
  try {
    const updatedKit = await deleteFlashcard(req.params.id as string, req.user!.userId, req.params.fid as string);
    return res.status(200).json({ success: true, kit: updatedKit });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

// ── Batch Commit Endpoint ──────────────────────────────────────────────────
router.post('/kits/:id/builder/commit', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await commitBuilderDiff(req.params.id as string, req.user!.userId, req.body);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

// ── Regenerate Endpoints ───────────────────────────────────────────────────
router.post('/kits/:id/regenerate/brief', isAuth, async (req: Request, res: Response) => {
  try {
    const updatedKit = await regenerateBriefEndpoint(req.params.id as string, req.user!.userId);
    return res.status(200).json({ success: true, kit: updatedKit, briefState: 'GENERATED' });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.post('/kits/:id/regenerate/questions/:category', isAuth, async (req: Request, res: Response) => {
  try {
    const category = req.params.category as any;
    if (!['technical', 'behavioural', 'system-design', 'company-fit'].includes(category)) {
      return res.status(400).json({ success: false, error: 'Invalid category' });
    }
    const updatedKit = await regenerateQuestionsCategoryEndpoint(
      req.params.id as string,
      req.user!.userId,
      category
    );
    return res.status(200).json({ success: true, kit: updatedKit, scheduleStale: true });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

router.post('/kits/:id/regenerate/schedule', isAuth, async (req: Request, res: Response) => {
  try {
    const updatedKit = await regenerateScheduleEndpoint(req.params.id as string, req.user!.userId);
    return res.status(200).json({ success: true, kit: updatedKit, scheduleStale: false });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

// ── Manual Schedule Edit Endpoint ──────────────────────────────────────────
router.patch('/kits/:id/schedule', isAuth, async (req: Request, res: Response) => {
  try {
    const { days } = req.body;
    if (!Array.isArray(days)) {
      return res.status(400).json({ success: false, error: 'days array required' });
    }
    const { kit, warnings } = await manualScheduleEdit(req.params.id as string, req.user!.userId, days);
    return res.status(200).json({ success: true, kit, warnings, scheduleStale: false });
  } catch (err) {
    return handleBuilderError(err, res);
  }
});

export default router;
