import type { MergedResult, ResearchBundle, ExtractedRole } from '../../types/kit';

export async function mergeNode(state: {
  jd: string;
  companyUrl: string;
  research: ResearchBundle | null;
  role: ExtractedRole | null;
}): Promise<{ merged: MergedResult }> {
  if (!state.role) {
    throw new Error('Cannot merge: role extraction failed or produced null');
  }

  const researchBundle: ResearchBundle = state.research || {
    pagesUsed: [],
    pagesSkipped: [],
    aboutText: null,
    hiringProcessText: null,
  };

  const merged: MergedResult = {
    source: {
      company_url: state.companyUrl,
      jd_chars: state.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: researchBundle.pagesUsed,
    },
    role: state.role,
    research: researchBundle,
  };

  return { merged };
}
