export interface ResearchBundle {
  pagesUsed: string[];
  pagesSkipped: { url: string; reason: string }[];
  aboutText: string | null;
  hiringProcessText: string | null;
}

export interface Requirement {
  id: string;            // "r1", "r2", ... stable within this run
  text: string;
  kind: 'technical' | 'behavioural' | 'domain';
  priority: 'must' | 'nice';
}

export interface ExtractedRole {
  title: string;
  seniority: string;
  responsibilities: string[];
  requirements: Requirement[];
}

export interface MergedResult {
  source: {
    company_url: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
  };
  role: ExtractedRole;
  research: ResearchBundle;
}

export type KitStreamEvent =
  | { event: 'status'; data: { status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' } }
  | { event: 'result'; data: MergedResult }
  | { event: 'error'; data: { message: string } };
