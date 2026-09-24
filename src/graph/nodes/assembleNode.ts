import { z } from 'zod';
import type {
  AppendixAKit,
  CompanyBrief,
  GeneratedFlashcard,
  GeneratedQuestion,
  MergedResult,
  Schedule,
} from '../../types/kit';

// ─── Zod schema for full AppendixAKit validation ──────────────────────────────

const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['technical', 'behavioural', 'domain']),
  priority: z.enum(['must', 'nice']),
});

const QuestionSchema = z.object({
  id: z.string(),
  requirement_ids: z.array(z.string()),
  category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const FlashcardSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string()),
});

const ScheduleDaySchema = z.object({
  day: z.number().int(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int(),
});

const ScheduleSchema = z.object({
  days_available: z.number().int(),
  days: z.array(ScheduleDaySchema),
});

export const AppendixAKitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int(),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(RequirementSchema),
  }),
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int(),
  }),
  _meta: z
    .object({
      warnings: z.array(z.string()),
    })
    .optional(),
});

// ─── assembleNode ──────────────────────────────────────────────────────────────

export async function assembleNode(state: {
  merged: MergedResult | null;
  companyBrief: CompanyBrief | null;
  questions: GeneratedQuestion[];
  flashcards: GeneratedFlashcard[];
  schedule: Schedule | null;
  uncoveredRequirementIds: string[];
  coveragePasses: number;
  warnings: string[];
}): Promise<{ finalKit: AppendixAKit }> {
  if (!state.merged) {
    throw new Error('assembleNode: merged result is null — cannot assemble kit');
  }
  if (!state.companyBrief) {
    throw new Error('assembleNode: companyBrief is null — cannot assemble kit');
  }
  if (!state.schedule) {
    throw new Error('assembleNode: schedule is null — cannot assemble kit');
  }

  // Derive company name from URL hostname
  let company = '';
  try {
    const hostname = new URL(state.merged.source.company_url).hostname;
    company = hostname.replace(/^www\./, '').split('.')[0] ?? hostname;
    // Capitalize first letter
    company = company.charAt(0).toUpperCase() + company.slice(1);
  } catch {
    company = state.merged.source.company_url;
  }

  const finalKit: AppendixAKit = {
    source: {
      company,
      company_url: state.merged.source.company_url,
      role: state.merged.role.title,
      location: '',  // not available from JD extraction currently; future iteration can add
      jd_chars: state.merged.source.jd_chars,
      researched_at: state.merged.source.researched_at,
      pages_used: state.merged.source.pages_used,
    },
    company_brief: state.companyBrief,
    role: {
      title: state.merged.role.title,
      seniority: state.merged.role.seniority,
      responsibilities: state.merged.role.responsibilities,
      requirements: state.merged.role.requirements,
    },
    questions: state.questions,
    flashcards: state.flashcards,
    schedule: state.schedule,
    coverage: {
      uncovered_requirement_ids: state.uncoveredRequirementIds,
      passes: state.coveragePasses,
    },
    ...(state.warnings.length > 0 ? { _meta: { warnings: state.warnings } } : {}),
  };

  return { finalKit };
}

// ─── validateNode ──────────────────────────────────────────────────────────────

export async function validateNode(state: {
  finalKit: AppendixAKit | null;
}): Promise<{ finalKit: AppendixAKit }> {
  if (!state.finalKit) {
    throw new Error('validateNode: finalKit is null — assembly must have failed');
  }

  // Strict validation — a failure here indicates an assembly bug, not LLM flakiness.
  // Let ZodError propagate so it surfaces as a FAILED kit with a clear error message.
  const validated = AppendixAKitSchema.parse(state.finalKit);

  // Additional invariant: schedule.days.length === schedule.days_available
  if (validated.schedule.days.length !== validated.schedule.days_available) {
    throw new Error(
      `validateNode: schedule has ${validated.schedule.days.length} days but days_available=${validated.schedule.days_available}`
    );
  }

  return { finalKit: validated as AppendixAKit };
}
