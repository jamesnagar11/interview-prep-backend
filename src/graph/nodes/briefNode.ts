import type { CompanyBrief, ResearchBundle } from '../../types/kit';
import { generateBrief } from '../../services/kit/generateBrief';

export async function briefNode(state: {
  research: ResearchBundle | null;
  role: { title: string } | null;
  companyUrl: string;
}): Promise<{ companyBrief: CompanyBrief; warnings: string[] }> {
  const research = state.research;
  const aboutSources = research?.pagesUsed ?? [];
  return generateBrief(research?.aboutText ?? null, aboutSources);
}
