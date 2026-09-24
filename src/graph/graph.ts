import { StateGraph, START, END } from '@langchain/langgraph';
import { KitState } from './state';
import { researchNode } from './nodes/researchCompany';
import { extractRequirements } from './nodes/extractRequirements';
import { mergeNode } from './nodes/merge';
import { briefNode } from './nodes/briefNode';
import { questionGenNode } from './nodes/questionGenNode';
import { coverageCheckNode, MAX_COVERAGE_PASSES } from './nodes/coverageCheckNode';
import { generateGapQuestionsNode } from './nodes/generateGapQuestionsNode';
import { flashcardNode } from './nodes/flashcardNode';
import { scheduleNode } from './nodes/scheduleNode';
import { assembleNode, validateNode } from './nodes/assembleNode';
import { persistNode } from './nodes/persistNode';
import type { AppendixAKit } from '../types/kit';

// Disable LangSmith background tracing requests if API key is missing/empty to avoid 403 network noise
if (!process.env.LANGCHAIN_API_KEY || process.env.LANGCHAIN_API_KEY.trim() === '' || process.env.LANGCHAIN_API_KEY.includes('your_langsmith_api_key')) {
  process.env.LANGCHAIN_TRACING_V2 = 'false';
}

const extractNode = async (state: typeof KitState.State) => {
  console.log('[graph] 🧠 Starting extractNode...');
  const role = await extractRequirements(state.jd);
  console.log(`[graph] ✅ extractNode complete (${role.requirements.length} requirements extracted)`);
  return { role };
};

const researchNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 🌐 Starting researchNode...');
  const result = await researchNode(state);
  console.log('[graph] ✅ researchNode complete');
  return result;
};

const mergeNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 🔀 Starting mergeNode...');
  const result = await mergeNode(state);
  console.log('[graph] ✅ mergeNode complete');
  return result;
};

const briefNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 📝 Starting briefNode...');
  const result = await briefNode(state);
  console.log('[graph] ✅ briefNode complete');
  return result;
};

const questionGenNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] ❓ Starting questionGenNode...');
  const result = await questionGenNode(state);
  console.log(`[graph] ✅ questionGenNode complete (${result.questions.length} questions generated)`);
  return result;
};

const coverageCheckNodeWrapper = async (state: typeof KitState.State) => {
  console.log(`[graph] 🎯 Starting coverageCheckNode (pass ${state.coveragePasses + 1})...`);
  const result = await coverageCheckNode(state);
  console.log(`[graph] ✅ coverageCheckNode complete (${result.uncoveredRequirementIds.length} uncovered)`);
  return result;
};

const generateGapQuestionsNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] ⚡ Starting generateGapQuestionsNode...');
  const result = await generateGapQuestionsNode(state);
  console.log(`[graph] ✅ generateGapQuestionsNode complete (${result.questions.length} total questions)`);
  return result;
};

const flashcardNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 🎴 Starting flashcardNode...');
  const result = await flashcardNode(state);
  console.log(`[graph] ✅ flashcardNode complete (${result.flashcards.length} flashcards created)`);
  return result;
};

const scheduleNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 📅 Starting scheduleNode...');
  const result = await scheduleNode(state);
  console.log(`[graph] ✅ scheduleNode complete (${result.schedule.days.length} days scheduled)`);
  return result;
};

const assembleNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 🧩 Starting assembleNode...');
  const result = await assembleNode(state);
  console.log('[graph] ✅ assembleNode complete');
  return result;
};

const validateNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] ✅ Starting validateNode...');
  const result = await validateNode(state);
  console.log('[graph] ✅ validateNode complete');
  return result;
};

const persistNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 💾 Starting persistNode...');
  const result = await persistNode(state);
  console.log('[graph] ✅ persistNode complete');
  return result;
};

const builder = new StateGraph(KitState)
  .addNode('extractNode', extractNode)
  .addNode('researchNode', researchNodeWrapper)
  .addNode('mergeNode', mergeNodeWrapper)
  .addNode('briefNode', briefNodeWrapper)
  .addNode('questionGenNode', questionGenNodeWrapper)
  .addNode('coverageCheckNode', coverageCheckNodeWrapper)
  .addNode('generateGapQuestionsNode', generateGapQuestionsNodeWrapper)
  .addNode('flashcardNode', flashcardNodeWrapper)
  .addNode('scheduleNode', scheduleNodeWrapper)
  .addNode('assembleNode', assembleNodeWrapper)
  .addNode('validateNode', validateNodeWrapper)
  .addNode('persistNode', persistNodeWrapper)

  // Sequential pipeline execution flow
  .addEdge(START, 'extractNode')
  .addEdge('extractNode', 'researchNode')
  .addEdge('researchNode', 'mergeNode')
  .addEdge('mergeNode', 'briefNode')
  .addEdge('briefNode', 'questionGenNode')
  .addEdge('questionGenNode', 'coverageCheckNode')
  .addConditionalEdges('coverageCheckNode', (state) =>
    state.uncoveredRequirementIds.length > 0 && state.coveragePasses < MAX_COVERAGE_PASSES
      ? 'generateGapQuestionsNode'
      : 'flashcardNode'
  )
  .addEdge('generateGapQuestionsNode', 'coverageCheckNode')
  .addEdge('flashcardNode', 'scheduleNode')
  .addEdge('scheduleNode', 'assembleNode')
  .addEdge('assembleNode', 'validateNode')
  .addEdge('validateNode', 'persistNode')
  .addEdge('persistNode', END);

export const kitGraph = builder.compile();

export async function runKitGraph(input: {
  jd: string;
  companyUrl: string;
  days: number;
  kitId: string;
}): Promise<{ finalKit: AppendixAKit }> {
  console.log(`[kitGraph] 🚀 Invoking graph for kitId=${input.kitId}, days=${input.days}`);
  const result = await kitGraph.invoke({
    jd: input.jd,
    companyUrl: input.companyUrl,
    days: input.days,
    kitId: input.kitId,
  });

  if (!result.finalKit) {
    throw new Error('Pipeline completed but produced no final kit');
  }

  return { finalKit: result.finalKit };
}
