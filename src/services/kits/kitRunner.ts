import { db } from '../../prisma/db';
import { kitGraph } from '../../graph/graph';
import { kitEvents, emitKitProgress } from './kitEvents';
import type { KitStreamEvent } from '../../types/kit';

export async function runKit(kitId: string, jd: string, companyUrl: string, days: number) {
  const publish = (evt: KitStreamEvent) => kitEvents.emit(kitId, evt);

  try {
    // Initial Progress Step
    await emitKitProgress(
      kitId,
      'PENDING',
      'Initializing Pipeline',
      'Preparing AI analysis engine... Sit tight, starting research!',
      5,
      40,
      `Target website: ${companyUrl}, Prep timeframe: ${days} days`
    );


    const result = await kitGraph.invoke({
      jd,
      companyUrl,
      days,
      kitId,
    });

    if (!result.finalKit) {
      throw new Error('Pipeline completed but produced no final kit');
    }

    // Kit status was set to READY by persistNode — just emit the result event
    publish({ event: 'result', data: result.finalKit });
  } catch (err: any) {
    const errorMsg = err.message || 'Kit processing failed';
    try {
      await db.orm.kit.where({ _id: kitId as any }).update({
        status: 'FAILED' as any,
        errorMessage: errorMsg,
        updatedAt: new Date(),
      } as any);
    } catch {
      // ignore db update error on failure path
    }
    publish({ event: 'error', data: { message: errorMsg } });
  }
}
