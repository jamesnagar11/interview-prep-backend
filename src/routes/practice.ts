import { Router } from 'express';
import type { Request, Response } from 'express';
import { isAuth } from '../middleware';
import { BuilderError } from '../services/kit/builderService';
import {
  createPracticeSession,
  recordAttempt,
  endPracticeSession,
  listPracticeSessions,
  getPracticeSessionDetails,
  getPracticeQueue,
} from '../services/kit/practiceService';

const router = Router();

function handlePracticeError(err: any, res: Response) {
  if (err instanceof BuilderError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  return res.status(500).json({ success: false, error: err.message || 'Server error' });
}

// ── GET /api/kits/:id/practice/queue ──────────────────────────────────────
router.get('/kits/:id/practice/queue', isAuth, async (req: Request, res: Response) => {
  try {
    const queue = await getPracticeQueue(req.params.id as string, req.user!.userId);
    return res.status(200).json({ success: true, queue });
  } catch (err) {
    return handlePracticeError(err, res);
  }
});

// ── GET /api/kits/:id/practice/sessions ───────────────────────────────────
router.get('/kits/:id/practice/sessions', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await listPracticeSessions(req.params.id as string, req.user!.userId);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handlePracticeError(err, res);
  }
});

// ── POST /api/kits/:id/practice/sessions ──────────────────────────────────
router.post('/kits/:id/practice/sessions', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await createPracticeSession(req.params.id as string, req.user!.userId);
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    return handlePracticeError(err, res);
  }
});

// ── GET /api/kits/:id/practice/sessions/:sid ──────────────────────────────
router.get('/kits/:id/practice/sessions/:sid', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await getPracticeSessionDetails(
      req.params.id as string,
      req.params.sid as string,
      req.user!.userId
    );
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handlePracticeError(err, res);
  }
});

// ── POST /api/kits/:id/practice/sessions/:sid/attempts ────────────────────
router.post('/kits/:id/practice/sessions/:sid/attempts', isAuth, async (req: Request, res: Response) => {
  try {
    const { flashcardId, confidence, skipped } = req.body;
    if (!flashcardId) {
      return res.status(400).json({ success: false, error: 'flashcardId required' });
    }
    const result = await recordAttempt(req.params.id as string, req.params.sid as string, req.user!.userId, {
      flashcardId,
      confidence: confidence !== undefined ? confidence : null,
      skipped: Boolean(skipped),
    });
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    return handlePracticeError(err, res);
  }
});

// ── POST /api/kits/:id/practice/sessions/:sid/end ─────────────────────────
router.post('/kits/:id/practice/sessions/:sid/end', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await endPracticeSession(
      req.params.id as string,
      req.params.sid as string,
      req.user!.userId
    );
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handlePracticeError(err, res);
  }
});

export default router;
