import { Annotation } from '@langchain/langgraph';
import type {
  ResearchBundle,
  ExtractedRole,
  MergedResult,
  CompanyBrief,
  GeneratedQuestion,
  GeneratedFlashcard,
  Schedule,
  AppendixAKit,
} from '../types/kit';

export const KitState = Annotation.Root({
  // existing (iteration 01) — unchanged
  jd: Annotation<string>,
  companyUrl: Annotation<string>,
  days: Annotation<number>,
  research: Annotation<ResearchBundle | null>({ default: () => null, reducer: (_, v) => v }),
  role: Annotation<ExtractedRole | null>({ default: () => null, reducer: (_, v) => v }),
  merged: Annotation<MergedResult | null>({ default: () => null, reducer: (_, v) => v }),

  // new — needed to persist as we go and to resume mid-pipeline on retry
  kitId: Annotation<string>,

  companyBrief: Annotation<CompanyBrief | null>({ default: () => null, reducer: (_, v) => v }),

  questions: Annotation<GeneratedQuestion[]>({ default: () => [], reducer: (_, v) => v }),
  coveragePasses: Annotation<number>({ default: () => 0, reducer: (_, v) => v }),
  uncoveredRequirementIds: Annotation<string[]>({ default: () => [], reducer: (_, v) => v }),

  flashcards: Annotation<GeneratedFlashcard[]>({ default: () => [], reducer: (_, v) => v }),

  schedule: Annotation<Schedule | null>({ default: () => null, reducer: (_, v) => v }),

  warnings: Annotation<string[]>({ default: () => [], reducer: (prev, v) => [...prev, ...v] }),

  finalKit: Annotation<AppendixAKit | null>({ default: () => null, reducer: (_, v) => v }),
});
