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
import { emitKitProgress } from '../services/kits/kitEvents';
import type { AppendixAKit } from '../types/kit';

// Disable LangSmith background tracing requests if API key is missing/empty to avoid 403 network noise
if (!process.env.LANGCHAIN_API_KEY || process.env.LANGCHAIN_API_KEY.trim() === '' || process.env.LANGCHAIN_API_KEY.includes('your_langsmith_api_key')) {
  process.env.LANGCHAIN_TRACING_V2 = 'false';
}

// ── Parallel fan-out node: runs extractRequirements and researchCompany concurrently ──────────────
const extractAndResearchNode = async (state: typeof KitState.State) => {
  console.log('[graph] 🚀 Starting extractNode + researchNode in parallel...');
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'RESEARCHING',
      'Researching Company & Crawling Job Description',
      'Crawling company website and analyzing job requirements... Sit tight!',
      15,
      35,
      `Analyzing URL ${state.companyUrl}`
    );
  }
  const [roleResult, researchResult] = await Promise.all([
    extractRequirements(state.jd).then((role) => {
      console.log(`[graph] ✅ extractNode complete (${role.requirements.length} requirements extracted)`);
      return role;
    }),
    researchNode(state).then((r) => {
      console.log('[graph] ✅ researchNode complete');
      return r.research;
    }),
  ]);
  return { role: roleResult, research: researchResult };
};

const mergeNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 🔀 Starting mergeNode...');
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'EXTRACTING',
      'Structuring Role Requirements & Context',
      'Synthesizing role requirements, seniority, and company research into unified schema...',
      30,
      28,
      `Extracted ${state.role?.requirements.length ?? 0} requirements`
    );
  }
  const result = await mergeNode(state);
  console.log('[graph] ✅ mergeNode complete');
  return result;
};

// ── Parallel fan-out node: runs briefNode and questionGenNode concurrently ─────────────────────────
const briefAndQuestionsNode = async (state: typeof KitState.State) => {
  console.log('[graph] 📝❓ Starting briefNode + questionGenNode in parallel...');
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'GENERATING',
      'Generating Interview Questions & Brief',
      'Generating targeted technical, behavioural, system design & company fit questions... Sit tight!',
      50,
      20,
      'Crafting custom question prompts and detailed answer keys'
    );
  }
  const [briefResult, questionsResult] = await Promise.all([
    briefNode(state).then((r) => {
      console.log('[graph] ✅ briefNode complete');
      return r;
    }),
    questionGenNode(state).then((r) => {
      console.log(`[graph] ✅ questionGenNode complete (${r.questions.length} questions generated)`);
      return r;
    }),
  ]);
  return {
    companyBrief: briefResult.companyBrief,
    questions: questionsResult.questions,
    warnings: [...(briefResult.warnings ?? []), ...(questionsResult.warnings ?? [])],
  };
};

const coverageCheckNodeWrapper = async (state: typeof KitState.State) => {
  console.log(`[graph] 🎯 Starting coverageCheckNode (pass ${state.coveragePasses + 1})...`);
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'CHECKING_COVERAGE',
      'Evaluating Requirement Coverage',
      'Auditing requirement coverage across generated questions... Hold on!',
      70,
      14,
      `Pass ${state.coveragePasses + 1} of coverage verification`
    );
  }
  const result = await coverageCheckNode(state);
  console.log(`[graph] ✅ coverageCheckNode complete (${result.uncoveredRequirementIds.length} uncovered)`);
  return result;
};

const generateGapQuestionsNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] ⚡ Starting generateGapQuestionsNode...');
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'CHECKING_COVERAGE',
      'Filling Requirement Coverage Gaps',
      'Generating supplemental targeted questions for uncovered requirements...',
      78,
      10,
      `Addressing ${state.uncoveredRequirementIds.length} uncovered requirements`
    );
  }
  const result = await generateGapQuestionsNode(state);
  console.log(`[graph] ✅ generateGapQuestionsNode complete (${result.questions.length} total questions)`);
  return result;
};

const flashcardNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 🎴 Starting flashcardNode...');
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'GENERATING',
      'Building Interactive Flashcard Studio',
      'Synthesizing interactive flashcard prompts and quick revision cards...',
      84,
      8,
      'Generating flashcard pairs for spaced repetition'
    );
  }
  const result = await flashcardNode(state);
  console.log(`[graph] ✅ flashcardNode complete (${result.flashcards.length} flashcards created)`);
  return result;
};

const scheduleNodeWrapper = async (state: typeof KitState.State) => {
  console.log('[graph] 📅 Starting scheduleNode...');
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'SCHEDULING',
      'Building Interleaved Study Schedule',
      'Designing your personalized study schedule with topic interleaving...',
      92,
      4,
      `Allocating prep over ${state.days} available days`
    );
  }
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
  if (state.kitId) {
    await emitKitProgress(
      state.kitId,
      'SCHEDULING',
      'Finalizing & Persisting Kit',
      'Validating final prep kit and saving all data to database... Almost ready!',
      97,
      2,
      'Saving questions, schedule, and flashcards'
    );
  }
  const result = await persistNode(state);
  console.log('[graph] ✅ persistNode complete');
  return result;
};


const builder = new StateGraph(KitState)
  .addNode('extractAndResearchNode', extractAndResearchNode)
  .addNode('mergeNode', mergeNodeWrapper)
  .addNode('briefAndQuestionsNode', briefAndQuestionsNode)
  .addNode('coverageCheckNode', coverageCheckNodeWrapper)
  .addNode('generateGapQuestionsNode', generateGapQuestionsNodeWrapper)
  .addNode('flashcardNode', flashcardNodeWrapper)
  .addNode('scheduleNode', scheduleNodeWrapper)
  .addNode('assembleNode', assembleNodeWrapper)
  .addNode('validateNode', validateNodeWrapper)
  .addNode('persistNode', persistNodeWrapper)

  // Optimized pipeline:
  //   extractNode + researchNode → (parallel fan-out)
  //   mergeNode
  //   briefNode + questionGenNode → (parallel fan-out)
  //   coverageCheckLoop → flashcard → schedule → assemble → validate → persist
  .addEdge(START, 'extractAndResearchNode')
  .addEdge('extractAndResearchNode', 'mergeNode')
  .addEdge('mergeNode', 'briefAndQuestionsNode')
  .addEdge('briefAndQuestionsNode', 'coverageCheckNode')
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
