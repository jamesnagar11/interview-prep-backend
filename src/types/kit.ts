export type QuestionCategory = 'technical' | 'behavioural' | 'system-design' | 'company-fit';

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

export interface GeneratedQuestion {
  id: string;                 // "q1", "q2", ... stable within this kit
  requirement_ids: string[];  // 1+ requirement ids this question covers — NOT always length 1
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
}

export interface GeneratedFlashcard {
  id: string;                 // "f1", "f2", ...
  front: string;
  back: string;
  requirement_ids: string[];
}

export interface CompanyBrief {
  summary: string;
  what_they_do: string;
  sources: string[];
}

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface Schedule {
  days_available: number;
  days: ScheduleDay[];
}

export interface AppendixAKit {
  source: {
    company: string;
    company_url: string;
    role: string;
    location: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
  };
  company_brief: CompanyBrief;
  role: {
    title: string;
    seniority: string;
    responsibilities: string[];
    requirements: Requirement[];
  };
  questions: GeneratedQuestion[];
  flashcards: GeneratedFlashcard[];
  schedule: Schedule;
  coverage: { uncovered_requirement_ids: string[]; passes: number };
  _meta?: { warnings: string[] };  // extension, not part of Appendix A proper — UI-only, never required
}

export type KitStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'DRAFT'
  | 'RESEARCHING'
  | 'EXTRACTING'
  | 'GENERATING'
  | 'CHECKING_COVERAGE'
  | 'SCHEDULING'
  | 'READY'
  | 'FAILED';

export type KitStreamEvent =
  | { event: 'status'; data: { status: KitStatus } }
  | { event: 'result'; data: AppendixAKit }
  | { event: 'error'; data: { message: string } };
