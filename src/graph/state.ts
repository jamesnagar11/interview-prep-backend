import { Annotation } from '@langchain/langgraph';
import type { ResearchBundle, ExtractedRole, MergedResult } from '../types/kit';

export const KitState = Annotation.Root({
  jd: Annotation<string>,
  companyUrl: Annotation<string>,
  days: Annotation<number>,
  research: Annotation<ResearchBundle | null>({ default: () => null, reducer: (_, v) => v }),
  role: Annotation<ExtractedRole | null>({ default: () => null, reducer: (_, v) => v }),
  merged: Annotation<MergedResult | null>({ default: () => null, reducer: (_, v) => v }),
});
