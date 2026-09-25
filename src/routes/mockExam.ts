import { Router } from 'express';
import type { Request, Response } from 'express';
import { isAuth } from '../middleware';
import { BuilderError } from '../services/kit/builderService';
import {
  saveMockExam,
  listMockExams,
  getMockExamDetail,
  generateAiReport,
} from '../services/kit/mockExamService';

const router = Router();

function handleError(err: any, res: Response) {
  if (err instanceof BuilderError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  return res.status(500).json({ success: false, error: err.message || 'Server error' });
}

// ── GET /api/kits/:id/mock-exams — list all saved exams ──────────────────
router.get('/kits/:id/mock-exams', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await listMockExams(req.params.id as string, req.user!.userId);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handleError(err, res);
  }
});

// ── POST /api/kits/:id/mock-exams — save a completed exam ────────────────
router.post('/kits/:id/mock-exams', isAuth, async (req: Request, res: Response) => {
  try {
    const { title, startedAt, finishedAt, durationSec, questions } = req.body;
    if (!title || !startedAt || !finishedAt || !questions) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const result = await saveMockExam(req.params.id as string, req.user!.userId, {
      title,
      startedAt,
      finishedAt,
      durationSec,
      questions,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    return handleError(err, res);
  }
});

// ── GET /api/kits/:id/mock-exams/:eid — get exam detail ──────────────────
router.get('/kits/:id/mock-exams/:eid', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await getMockExamDetail(
      req.params.id as string,
      req.params.eid as string,
      req.user!.userId
    );
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handleError(err, res);
  }
});

// ── POST /api/kits/:id/mock-exams/:eid/ai-report — generate AI coaching ──
router.post('/kits/:id/mock-exams/:eid/ai-report', isAuth, async (req: Request, res: Response) => {
  try {
    const result = await generateAiReport(
      req.params.id as string,
      req.params.eid as string,
      req.user!.userId
    );
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return handleError(err, res);
  }
});

export default router;
