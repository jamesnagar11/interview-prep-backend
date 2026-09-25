import { EventEmitter } from 'node:events';
import { db } from '../../prisma/db';
import type { KitStatus, KitProgressPayload } from '../../types/kit';

export const kitEvents = new EventEmitter();
kitEvents.setMaxListeners(0);

// In-memory cache for the latest progress event per kit so late SSE subscribers get current state immediately
const kitProgressCache = new Map<string, KitProgressPayload>();

export function getLatestKitProgress(kitId: string): KitProgressPayload | undefined {
  return kitProgressCache.get(kitId);
}

export async function emitKitProgress(
  kitId: string,
  status: KitStatus,
  step: string,
  message: string,
  progress: number,
  estimatedSecondsRemaining: number,
  detail?: string
) {
  const payload: KitProgressPayload = {
    status,
    step,
    message,
    progress,
    estimatedSecondsRemaining,
    detail,
    timestamp: new Date().toISOString(),
  };

  kitProgressCache.set(kitId, payload);

  // 1. Broadcast SSE events
  kitEvents.emit(kitId, { event: 'progress', data: payload });
  kitEvents.emit(kitId, { event: 'status', data: payload });

  // 2. Persist status update in DB asynchronously
  try {
    await db.orm.kit.where({ _id: kitId as any }).update({
      status: status as any,
      updatedAt: new Date(),
    } as any);
  } catch (err) {
    console.error(`[emitKitProgress] DB status update error for kit ${kitId}:`, err);
  }
}

