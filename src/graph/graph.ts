import { StateGraph, START, END } from '@langchain/langgraph';
import { KitState } from './state';
import { researchNode } from './nodes/researchCompany';
import { extractRequirements } from './nodes/extractRequirements';
import { mergeNode } from './nodes/merge';
import type { MergedResult } from '../types/kit';

const extractNode = async (state: typeof KitState.State) => {
  const role = await extractRequirements(state.jd);
  return { role };
};

const builder = new StateGraph(KitState)
  .addNode('researchNode', researchNode) 
  .addNode('extractNode', extractNode)
  .addNode('mergeNode', mergeNode)
  .addEdge(START, 'researchNode')
  .addEdge(START, 'extractNode')
  .addEdge('researchNode', 'mergeNode')
  .addEdge('extractNode', 'mergeNode')
  .addEdge('mergeNode', END);


export const kitGraph = builder.compile();

export async function runKitGraph(input: {
  jd: string;
  companyUrl: string;
  days: number;
}): Promise<{ merged: MergedResult }> {
  const result = await kitGraph.invoke({
    jd: input.jd,
    companyUrl: input.companyUrl,
    days: input.days,
  });

  if (!result.merged) {
    throw new Error('Pipeline completed but produced no merged result');
  }

  return { merged: result.merged };
}
