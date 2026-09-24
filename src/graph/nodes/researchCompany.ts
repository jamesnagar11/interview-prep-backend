import { researchCompany } from '../../services/crawl/researchCompany';
import type { ResearchBundle } from '../../types/kit';

export async function researchNode(state: { companyUrl: string }): Promise<{ research: ResearchBundle }> {
  const result = await researchCompany(state.companyUrl);
  return { research: result };
}
