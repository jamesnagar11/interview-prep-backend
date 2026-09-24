import { db } from '../../prisma/db';
import { runKitGraph } from '../../graph/graph';
import { kitEvents } from './kitEvents';
import type { KitStreamEvent } from '../../types/kit';

export async function runKit(kitId: string, jd: string, companyUrl: string, days: number) {
  const publish = (evt: KitStreamEvent) => kitEvents.emit(kitId, evt);

  try {
    await db.orm.kit.where({ _id: kitId as any }).update({
      status: 'RUNNING' as any,
      updatedAt: new Date(),
    });
    publish({ event: 'status', data: { status: 'RUNNING' } });

    const { merged } = await runKitGraph({ jd, companyUrl, days });

    await db.orm.kit.where({ _id: kitId as any }).update({
      status: 'READY' as any,
      result: JSON.stringify(merged),
      updatedAt: new Date(),
    });
    publish({ event: 'result', data: merged });
  } catch (err: any) {
    const errorMsg = err.message || 'Kit processing failed';
    try {
      await db.orm.kit.where({ _id: kitId as any }).update({
        status: 'FAILED' as any,
        errorMessage: errorMsg,
        updatedAt: new Date(),
      });
    } catch {
      // ignore db update error on failure path
    }
    publish({ event: 'error', data: { message: errorMsg } });
  }
}
