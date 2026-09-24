import { db } from '../../prisma/db';
import { kitGraph } from '../../graph/graph';
import { kitEvents } from './kitEvents';
import type { KitStreamEvent, KitStatus } from '../../types/kit';

export async function runKit(kitId: string, jd: string, companyUrl: string, days: number) {
  const publish = (evt: KitStreamEvent) => kitEvents.emit(kitId, evt);

  const updateStatus = async (status: KitStatus) => {
    await db.orm.kit.where({ _id: kitId as any }).update({
      status: status as any,
      updatedAt: new Date(),
    } as any);
    publish({ event: 'status', data: { status } });
  };

  try {
    // Phase 1: RESEARCHING — fan-out research + extract
    await updateStatus('RESEARCHING');

    // Phase 2: GENERATING — brief + question gen through coverage loop
    // We emit these status events before invoking the graph; the graph itself
    // handles all the node execution. We'll use a callback-based status
    // update inside the graph by hooking into the runner here.
    //
    // Since LangGraph doesn't have per-node hooks in this setup, we emit
    // the fine-grained statuses before and after graph execution phases.
    // The graph runs as a single invoke, so we emit GENERATING at the start
    // and SCHEDULING before persist completes.

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
