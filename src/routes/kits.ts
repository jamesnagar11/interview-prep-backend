import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { isAuth } from '../middleware';
import { verifyToken } from '../service/auth';
import { db } from '../prisma/db';
import { runKit } from '../services/kits/kitRunner';
import { kitEvents } from '../services/kits/kitEvents';
import type { KitStreamEvent, MergedResult } from '../types/kit';

const router = Router();

const createKitSchema = z.object({
  jd: z.string().min(1, 'Job description cannot be empty'),
  companyUrl: z.string().url('Invalid company URL format'),
  days: z.number().int().min(1).max(90),
});

// POST /api/kits
router.post('/kits', isAuth, async (req: Request, res: Response) => {
  const parsed = createKitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  const { jd, companyUrl, days } = parsed.data;
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ success: false, msg: 'Unauthorized' });
  }

  try {
    const kit = await db.orm.kit.create({
      userId,
      companyUrl,
      jdText: jd,
      daysAvailable: days,
      status: 'PENDING' as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const kitId = kit._id.toString();

    // Trigger background execution without awaiting
    void runKit(kitId, jd, companyUrl, days);

    return res.status(202).json({ kitId, status: 'PENDING' });
  } catch (err: any) {
    return res.status(500).json({ success: false, msg: err.message || 'Failed to create kit' });
  }
});

// GET /api/kits/:id/stream
router.get('/kits/:id/stream', async (req: Request, res: Response) => {
  const tokenParam = req.query.token;
  const authHeader = req.headers.authorization;
  const token = (typeof tokenParam === 'string' ? tokenParam : undefined) || (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined);

  if (!token) {
    return res.status(401).json({ success: false, msg: 'Token not provided' });
  }

  let user;
  try {
    user = verifyToken(token);
  } catch {
    return res.status(401).json({ success: false, msg: 'Invalid or expired token' });
  }

  const kitId = String(req.params.id || '');
  if (!kitId || kitId === '') {
    return res.status(400).json({ success: false, msg: 'Kit ID missing' });
  }

  const kit = await db.orm.kit.where({ _id: kitId as any }).first();

  if (!kit || kit.userId !== user.userId) {
    return res.status(404).json({ success: false, msg: 'Kit not found' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (evt: KitStreamEvent) => {
    res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
  };

  // Replay current state immediately
  if (kit.status === 'READY') {
    let resultData: MergedResult;
    try {
      resultData = typeof kit.result === 'string' ? JSON.parse(kit.result) : (kit.result as any);
    } catch {
      resultData = kit.result as any;
    }
    send({ event: 'result', data: resultData });
    return res.end();
  }

  if (kit.status === 'FAILED') {
    send({ event: 'error', data: { message: kit.errorMessage || 'Unknown error' } });
    return res.end();
  }

  send({ event: 'status', data: { status: kit.status as 'PENDING' | 'RUNNING' } });

  // Subscribe for live updates
  const listener = (evt: KitStreamEvent) => {
    send(evt);
    if (evt.event === 'result' || evt.event === 'error') {
      kitEvents.off(kitId, listener);
      res.end();
    }
  };

  kitEvents.on(kitId, listener);

  req.on('close', () => {
    kitEvents.off(kitId, listener);
  });
});

export default router;
