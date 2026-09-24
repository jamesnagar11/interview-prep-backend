# Agent Iteration 02 — Generation, Coverage Loop, Schedule, Persistence

## ⚠️ Read this before anything else — self-checkpointing protocol (mandatory)

You (the coding agent) must manage your own context budget across this file.

1. **On start**: check whether `agent_iteration_02_memory.md` exists in the repo root.
   - If it exists, **read it first**. It tells you exactly which checklist items (§0) are DONE, which files exist with what content/decisions, and the exact next item to resume from. Do not redo completed items. Do not re-read files already summarized in the memory doc unless you need to verify something specific.
   - If it doesn't exist, you're starting fresh — work through §0's checklist top to bottom.
2. **Work in checklist order** (§0). After you fully finish and verify each numbered item (code written, compiles, matches this spec), immediately update `agent_iteration_02_memory.md` — don't batch updates till the end.
3. **Proactive abort-and-save rule**: you do not need to be told you're low on budget. If, at any point, you estimate remaining context is tight relative to how much checklist work is left (e.g. you're past the midpoint of your budget but have completed less than half the checklist, or you simply notice responses getting constrained) — **stop what you're doing at the next safe boundary** (end of the current file/function, not mid-edit), write the memory file per the template below, and end your turn. A clean partial handoff is strictly better than a broken half-written file with no record. Do not wait for an explicit instruction to do this.
4. **Memory file template** — overwrite `agent_iteration_02_memory.md` with this shape every time you checkpoint:

   ```markdown
   # Iteration 02 — Progress Memory
   Last updated: <ISO timestamp>

   ## Done (checklist items from agent_iteration_02.md §0)
   - [x] 1. KitState + types updated — src/graph/state.ts, src/types/kit.ts
   - [x] 2. briefNode — src/graph/nodes/briefNode.ts (uses research.aboutText, degrades to empty brief on failure)
   - [ ] 3. questionGenNode — IN PROGRESS, see note below
   ...

   ## Decisions/deviations made so far
   - <anything you decided that wasn't 100% spelled out in the spec, and why>

   ## Exact next step
   - <file to open/create, what function to write next, any partial code already in place>

   ## Known issues / TODO before this item is truly done
   - <anything you noticed but didn't fix yet>
   ```
5. A later agent instance picking this up should treat the memory file as ground truth over its own assumptions, but should still verify against the actual repo state (files may have been hand-edited since the last checkpoint) before continuing.

---

## 0. Checklist (work top to bottom; this is what the memory file's "Done" section tracks)

1. Update `KitState` + shared types (§1, §2)
2. `briefNode` (§3)
3. `questionGenNode` (§4)
4. `coverageCheckNode` + gap-fill loop + conditional edges (§5)
5. `flashcardNode` (§6)
6. `scheduleNode` — the full allocation algorithm (§7)
7. `assembleNode` + `validateNode` (§8)
8. `persistNode`, mapped to the existing Prisma schema (§9)
9. Updated graph wiring (§10)
10. LLM resilience wrapper + failure-severity handling (§11, §12)
11. Backend-requirements checklist pass — idempotency, resumability, validation (§13)
12. SSE status granularity update (§14)
13. Input validation update — 70-day cap (§15)
14. README notes for this iteration's decisions (pull from §7, §11, §6 rationale as you go — don't leave this to the end)

---

## Context — what exists already (from iteration 01)

`researchNode` → `extractNode` → `mergeNode` produces `MergedResult { source, role, research }` and is persisted as a `Kit` row (status progression `PENDING → RUNNING → READY/FAILED`, `POST /api/kits` ack + background run + `GET /api/kits/:id/stream` SSE). This iteration extends the graph **after** `mergeNode` to produce the full Appendix A kit: `company_brief`, `questions[]`, `flashcards[]`, `schedule`, `coverage` — and persists all of it into the already-designed Prisma schema (`Requirement`, `Question`, `QuestionRequirement`, `Flashcard`, `FlashcardRequirement`, `ScheduleDay`, `ScheduleDayQuestion`, plus `KitPage`/`BriefSource`/`Responsibility`/`UncoveredRequirement` for the flattened array fields).

**Not in this iteration** (next one): Builder UI (edit/reorder/regenerate-one-section), Practice Mode UI. This iteration only needs the `ItemState` field (`GENERATED`/`EDITED`/`PINNED`) to exist and default correctly on every `Question`/`Flashcard` row — everything else in the Prisma schema you pasted for the Builder/Practice layer already exists and just needs correct rows written into it; no new schema needed here.

---

## 1. `KitState` additions — `src/graph/state.ts`

```ts
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
```

Note the `warnings` reducer **appends** rather than replaces — every node that degrades gracefully instead of hard-failing pushes a human-readable string here (e.g. `"No hiring/interview-process page found for this company"`), and it ends up on the final persisted kit as an extra, non-Appendix-A field (`_meta.warnings`) surfaced in the UI as soft notices, never as errors.

---

## 2. New types — add to `src/types/kit.ts`

```ts
export type QuestionCategory = 'technical' | 'behavioural' | 'system-design' | 'company-fit';

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
```

---

## 3. `briefNode` — `src/graph/nodes/briefNode.ts`

Input: `state.research.aboutText`, `state.role.title` (for context), company name derived from `companyUrl` hostname if nothing better is available.

- If `aboutText` is null/empty → **don't call the LLM at all**, skip straight to a fallback brief: `{ summary: "No public information about this company could be found.", what_they_do: "", sources: [] }`, push a warning (`"No company information found — brief is empty"`), return.
- Otherwise: one LLM call, prompt = "summarize what this company does in 2-3 sentences, based only on the following page content — do not invent details not present in the text", input = `aboutText`, output validated against `{summary, what_they_do}` via zod.
- `sources` = `state.research.pagesUsed` filtered to the ones tagged `kind: 'about'` (carry this tag through from iteration 01's `researchCompany` — if not already tagged per-page, add a `kind` field to whatever internal candidate-tracking structure feeds `pagesUsed`, since Appendix A's `pages_used` at the top level is the full list but `company_brief.sources` should be the about-specific subset).
- LLM failure after retries (see §12) → same fallback as "no aboutText" path, with a distinct warning message ("Company brief generation failed after retries — showing empty brief").
- **This node never throws.** A failed/empty brief is never a reason to fail the whole kit.

---

## 4. `questionGenNode` — `src/graph/nodes/questionGenNode.ts`

### Category mapping (Requirement.kind → QuestionCategory)

```
technical    → 'technical'  (+ 'system-design' for a subset, see below)
behavioural  → 'behavioural'
domain       → 'company-fit'
```

**System-design escalation**: among `technical` requirements, flag ones whose text matches architecture/scale signal words (`scale`, `distributed`, `architecture`, `system design`, `high availability`, `throughput`) OR whose `priority === 'must'` and `state.role.seniority` suggests senior/staff/lead — route these into an additional `system-design` category call rather than (or in addition to) `technical`. This is a heuristic, not a hard rule; document it as a judgment call in the README.

### Must vs. nice — question count guidance (prompt-level, not a hard invariant)

```ts
function targetCount(req: Requirement, daysAvailable: number): number {
  if (req.priority === 'must') return daysAvailable >= 14 ? 3 : 2;
  return 1;
}
```

Pass this as guidance text in the prompt per requirement ("aim for \~N questions covering this requirement, more if it's foundational") — **the only code-enforced invariant is coverage (§5): every must-have needs ≥1 question.** The count guidance is a quality nudge, not something you validate against; don't fail or retry a category call just because it under/over-shoots the suggested count.

### One question can cover many requirements; one requirement can have many questions

Explicitly instruct the model in the prompt: *"If a single question naturally tests two or more of these requirements together (e.g. a system-design question that touches both 'distributed systems experience' and '5+ years backend'), return multiple ids in `requirement_ids`. Don't force one-question-per-requirement if that's artificial."* This is why `requirement_ids` is an array, not a single id, in the type above and in Appendix A itself.

### Call grouping (keep this to \~3–5 calls total, not one per requirement)

- One call per `(category)` group across all requirements mapped to it: `technical`, `behavioural`, `company-fit`, plus `system-design` if any requirements were flagged into it.
- Each call's input: the requirements in that group (id, text, priority), the per-requirement count guidance, and — **only for `technical`/`system-design`** — `state.research.hiringProcessText` if present, with an explicit instruction: *"If the hiring-process text below mentions a take-home assignment, a system-design round, pair programming, or similar, bias question style and category weighting toward that format. If it says nothing, generate a standard mix."* This is the literal implementation of *"a company that publishes a take-home followed by a system design round should produce a different kit."*
- Output per call: `GeneratedQuestion[]` (zod-validated), `id` assigned by your code as a running `q1, q2, ...` counter across all calls combined (don't let each call restart at `q1` — thread a counter through, or assign ids after all calls return and you've concatenated the arrays).

### Failure handling for this node

- Each category call goes through the resilience wrapper (§12). If **one category** fails after retries → skip it, push a warning (`"Question generation failed for category: behavioural"`), continue with the others.
- If **every** category call fails → this is fatal for the kit (there's nothing to schedule or check coverage on) → propagate an error, mark the Kit `FAILED` with a clear `errorMessage`.

---

## 5. `coverageCheckNode` + gap-fill loop — `src/graph/nodes/coverageCheckNode.ts`, `generateGapQuestionsNode.ts`

**Pure code, zero LLM calls, for the check itself:**

```ts
function checkCoverage(requirements: Requirement[], questions: GeneratedQuestion[]): string[] {
  const covered = new Set(questions.flatMap(q => q.requirement_ids));
  return requirements
    .filter(r => r.priority === 'must' && !covered.has(r.id))
    .map(r => r.id);
}
```

Only `must` requirements are checked — matches the spec's exact wording (*"every must-have requirement has a question"*); `nice` requirements are never gap-filled.

**Loop, via LangGraph conditional edge:**

```ts
.addConditionalEdges('coverageCheckNode', (state) => {
  const hasGaps = state.uncoveredRequirementIds.length > 0;
  const underPassCap = state.coveragePasses < MAX_COVERAGE_PASSES; // = 3, documented in README
  return hasGaps && underPassCap ? 'generateGapQuestionsNode' : 'flashcardNode';
})
.addEdge('generateGapQuestionsNode', 'coverageCheckNode')
```

- `MAX_COVERAGE_PASSES = 3` — a defensible, documented cap (spec: *"decide for yourself how many passes are sensible... explain the choice"*). Reasoning to put in README: pass 1 is the normal generation output; passes 2–3 give the loop two genuine chances to close gaps before diminishing returns (a requirement the model can't cover in 3 tries usually reflects a genuinely awkward/ambiguous JD line, not a fixable prompt issue).
- `generateGapQuestionsNode`: same LLM call shape as `questionGenNode`, but scoped **only** to the requirement ids in `state.uncoveredRequirementIds`, one call regardless of how many gap requirements there are (small list, no need to group by category — mixed categories in one call is fine here since it's a small, targeted fix-up). Increment `coveragePasses` by 1 each time this node runs. New questions get the next available `qN` ids and are appended to `state.questions`.
- **If gaps remain after `MAX_COVERAGE_PASSES`**: this is explicitly **not a fatal failure**. Record `uncoveredRequirementIds` as-is in the final `coverage` field (honest reporting — this is exactly what that field is *for*), push a warning, and proceed to `flashcardNode`. A kit with 1 stubborn uncovered must-have is still a valid, useful, shippable kit — the spec only says this loses points on the automated coverage check, not that it should be withheld from the user.

---

## 6. `flashcardNode` — `src/graph/nodes/flashcardNode.ts`

**Code-derived, no additional LLM call** — this is a deliberate cost-saving choice, document it in README:

```ts
function deriveFlashcards(questions: GeneratedQuestion[]): GeneratedFlashcard[] {
  return questions.map((q, i) => ({
    id: `f${i + 1}`,
    front: q.prompt,
    back: truncateToKeyPoints(q.answer_outline), // simple heuristic: first 2-3 sentences, or first N chars at a sentence boundary
    requirement_ids: q.requirement_ids,
  }));
}
```

- One flashcard per question is the simplest defensible mapping (keeps `requirement_ids` coverage identical to the question bank's, for free). If you want fewer, denser flashcards instead, dedupe by `requirement_ids` overlap (keep the highest-difficulty question per requirement as the flashcard) — either is fine, pick one and note it.
- Failure mode: this is pure code, so "failure" here means a bug, not an external flakiness — if `questions` is empty (only possible if `questionGenNode` produced nothing, which is already the fatal case handled in §4), this returns `[]` and that's consistent, not a new failure path.

---

## 7. `scheduleNode` — the allocation algorithm — `src/graph/nodes/scheduleNode.ts`

**Pure code. Zero LLM calls.** This is the highest-scrutiny part of the automated grading (15 of 55 points) — get the invariants exactly right:

1. `schedule.days.length === daysAvailable` exactly, always.
2. Every `must`-priority requirement's covering question(s) appear somewhere in the schedule.
3. Harder / higher-priority material lands in earlier days.
4. **Every generated question gets scheduled somewhere — nothing is silently dropped.** ("the schedule... allocates all of it" — interpreted as: all generated material, not just must-haves, ends up placed.)
5. `minutes` is always an integer.

### Step-by-step

```ts
const TIME_PER_DIFFICULTY_MIN = { 1: 10, 2: 15, 3: 20 };   // minutes per question, by difficulty
const DEFAULT_DAILY_BUDGET_MIN = 60;                          // soft target, not a hard cap — see below

function buildSchedule(questions: GeneratedQuestion[], requirements: Requirement[], daysAvailable: number): Schedule {
  // 1. sort: must before nice, then difficulty descending
  const priorityOf = (q: GeneratedQuestion) =>
    q.requirement_ids.some(id => requirements.find(r => r.id === id)?.priority === 'must') ? 0 : 1;
  const sorted = [...questions].sort((a, b) =>
    priorityOf(a) - priorityOf(b) || b.difficulty - a.difficulty
  );

  // 2. greedy-fill into daysAvailable buckets, respecting the soft per-day budget
  //    but NEVER dropping an item — if a day is "full", the item still goes in
  //    (overflow is allowed; budget is a target for ordering, not a hard cap)
  const days: ScheduleDay[] = Array.from({ length: daysAvailable }, (_, i) => ({
    day: i + 1, focus: '', question_ids: [], minutes: 0,
  }));

  let dayIdx = 0;
  for (const q of sorted) {
    // advance to the next day once the current one has hit its soft budget,
    // but don't advance past the last day — everything left packs into day N
    while (dayIdx < daysAvailable - 1 && days[dayIdx].minutes >= DEFAULT_DAILY_BUDGET_MIN) {
      dayIdx++;
    }
    days[dayIdx].question_ids.push(q.id);
    days[dayIdx].minutes += TIME_PER_DIFFICULTY_MIN[q.difficulty];
  }

  // 3. force-insert coverage: verify every must-have's question(s) landed somewhere
  //    (they should have, by construction/sort order — this is a defensive re-check,
  //    not expected to trigger, but assert it rather than trust it silently)
  assertMustCoverage(days, questions, requirements);

  // 4. handle leftover empty days (more days requested than content supports)
  fillBufferDays(days, sorted);

  // 5. derive `focus` per day from the dominant requirement among its questions
  for (const day of days) {
    day.focus = deriveFocusLabel(day.question_ids, questions, requirements);
  }

  return { days_available: daysAvailable, days };
}
```

### Edge cases, handled explicitly

| Situation | Handling |
| --- | --- |
| Fewer questions than days (e.g. 6 questions, 10 days) | Days 1–6(ish) get real content by the greedy fill; remaining empty days become **buffer/review days**: `focus: "Review & light practice"`, `question_ids`: a repeated subset of the `must`-priority questions (spaced-repetition-flavored, not a random pick), `minutes`: a smaller default (e.g. 20). Never leave a day with `question_ids: []` and `minutes: 0` — an empty day is a worse answer than a review day, and the spec requires every day to have *a* focus. |
| More questions than days can comfortably hold | Soft daily budget is exceeded rather than dropping items (step 2 above) — a day can run long; that's honest ("this is a lot to cover, here's everything, pace yourself") rather than silently discarding generated content the LLM already produced. |
| 1-day schedule | Everything (or as much as reasonably fits, prioritized must-first) packs into day 1 — no special-casing needed, the algorithm already handles `daysAvailable = 1` as the trivial case of the same loop (the `while` condition's `dayIdx < daysAvailable - 1` is `0 < 0`, false, so everything stays in day 0). |
| Very thin JD → very few requirements/questions, but many days requested | Real content front-loaded into the first few days, the rest become buffer/review days as above — an honest reflection that the posting didn't give you enough to fill 60 days of *new* material, not a fabricated 60-day plan. Note this in `_meta.warnings` (e.g. `"Only 6 questions generated from a short job description — later days are review sessions, not new material"`). |
| `daysAvailable > 70` | **Rejected at input validation** (§15), never reaches this node. |

### `deriveFocusLabel` — no LLM call

```ts
function deriveFocusLabel(questionIds: string[], questions: GeneratedQuestion[], requirements: Requirement[]): string {
  const reqIds = questionIds.flatMap(qid => questions.find(q => q.id === qid)?.requirement_ids ?? []);
  const counts = countBy(reqIds);
  const topReqId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topReq = requirements.find(r => r.id === topReqId);
  return topReq ? topReq.text : 'Mixed practice';
}
```

Just a frequency count over labels the LLM already assigned in earlier calls — no new understanding required at this step.

---

## 8. `assembleNode` + `validateNode`

`assembleNode` — pure object assembly, joins the two parallel branches (`briefNode` output + the `questionGen → coverage → flashcard → schedule` chain output) into the `AppendixAKit` shape from §2. No LLM call.

`validateNode` — zod schema for the **entire** `AppendixAKit` shape (write this once, reuse it for both the live pipeline and the batch CLI in a later iteration). On validation failure: this indicates a real bug in assembly (a missing field, wrong type), not an external flakiness — **do not silently degrade here**; throw, let it propagate to the runner as a genuine `FAILED` with the zod error detail in `errorMessage`. This is the one validation step in the whole pipeline that should be strict, since by this point every upstream node has already done its own graceful-degradation — a validation failure this late means your own code has a bug, and hiding that would be worse than surfacing it.

---

## 9. `persistNode` — mapped to your existing Prisma schema

Runs after successful validation. One transaction (`prisma.$transaction`) writing:

```ts
await prisma.$transaction([
  prisma.kit.update({
    where: { id: kitId },
    data: {
      companyName: finalKit.source.company,
      role: finalKit.source.role,
      location: finalKit.source.location,
      researchedAt: new Date(finalKit.source.researched_at),
      briefSummary: finalKit.company_brief.summary,
      briefWhatTheyDo: finalKit.company_brief.what_they_do,
      roleTitle: finalKit.role.title,
      roleSeniority: finalKit.role.seniority,
      coveragePasses: finalKit.coverage.passes,
      status: 'READY',
    },
  }),
  // KitPage rows — from finalKit.source.pages_used
  ...finalKit.source.pages_used.map(url => prisma.kitPage.create({ data: { kitId, url } })),
  // BriefSource rows
  ...finalKit.company_brief.sources.map(url => prisma.briefSource.create({ data: { kitId, url } })),
  // Responsibility rows
  ...finalKit.role.responsibilities.map(description => prisma.responsibility.create({ data: { kitId, description } })),
  // Requirement rows
  ...finalKit.role.requirements.map(r => prisma.requirement.create({
    data: { kitId, stableKey: r.id, text: r.text, kind: r.kind, priority: r.priority },
  })),
  // ... Question, QuestionRequirement, Flashcard, FlashcardRequirement, ScheduleDay, ScheduleDayQuestion, UncoveredRequirement
  // follow the same pattern: create the parent row per array item with stableKey = the qN/fN id,
  // then create the join-table rows for each requirement_id it references.
  // NOTE: Requirement rows must be created (and their DB ids known) BEFORE QuestionRequirement/
  // FlashcardRequirement rows, since those joins need the Requirement's real DB id, not its
  // stableKey — do this as sequential awaited creates building a stableKey→dbId map, not all
  // inside one flat $transaction array, since later inserts depend on earlier ones' results.
]);
```

Given the join-table dependency, **don't try to do the whole persist as one flat `$transaction([...])` array** — build it as an async function with sequential `await`s (still wrap the whole thing in `prisma.$transaction(async (tx) => { ... })` for atomicity), fetching/mapping ids as you go: create all `Requirement`s first, build a `stableKey → dbId` map, then create `Question`s (with default `state: 'GENERATED'`, `orderIndex` = array index) using that map for `QuestionRequirement` joins, same for flashcards, then `ScheduleDay`/`ScheduleDayQuestion` using the question stableKey→dbId map.

Every `Question`/`Flashcard` row's `state` defaults to `'GENERATED'` — this is what the next iteration's Builder relies on to know these are freely regeneratable.

**Idempotency / resumability for this whole node**: wrap the entire persist in the transaction so a mid-write crash never leaves a half-populated kit — either the full set of rows lands, or none do, and `Kit.status` only flips to `READY` on success. If the transaction fails, catch it, set `status: 'FAILED'`, `errorMessage`, and this is a genuine fatal error (a DB/bug problem, not a "content wasn't found" problem).

---

## 10. Updated graph wiring — `src/graph/graph.ts`

```ts
const builder = new StateGraph(KitState)
  .addNode('researchNode', researchNode)
  .addNode('extractNode', extractNode)
  .addNode('mergeNode', mergeNode)
  .addNode('briefNode', briefNode)
  .addNode('questionGenNode', questionGenNode)
  .addNode('coverageCheckNode', coverageCheckNode)
  .addNode('generateGapQuestionsNode', generateGapQuestionsNode)
  .addNode('flashcardNode', flashcardNode)
  .addNode('scheduleNode', scheduleNode)
  .addNode('assembleNode', assembleNode)
  .addNode('validateNode', validateNode)
  .addNode('persistNode', persistNode)

  .addEdge(START, 'researchNode')
  .addEdge(START, 'extractNode')
  .addEdge('researchNode', 'mergeNode')
  .addEdge('extractNode', 'mergeNode')

  .addEdge('mergeNode', 'briefNode')
  .addEdge('mergeNode', 'questionGenNode')

  .addEdge('questionGenNode', 'coverageCheckNode')
  .addConditionalEdges('coverageCheckNode', (state) =>
    state.uncoveredRequirementIds.length > 0 && state.coveragePasses < MAX_COVERAGE_PASSES
      ? 'generateGapQuestionsNode'
      : 'flashcardNode'
  )
  .addEdge('generateGapQuestionsNode', 'coverageCheckNode')

  .addEdge('flashcardNode', 'scheduleNode')

  // assembleNode waits on BOTH briefNode and scheduleNode — LangGraph joins automatically
  .addEdge('briefNode', 'assembleNode')
  .addEdge('scheduleNode', 'assembleNode')

  .addEdge('assembleNode', 'validateNode')
  .addEdge('validateNode', 'persistNode')
  .addEdge('persistNode', END);
```

---

## 11. Failure-severity matrix (what's actually fatal)

| Node | On failure after retries | Fatal? |
| --- | --- | --- |
| `researchNode` | empty `ResearchBundle`, logged | No — already handled in iteration 01 |
| `extractNode` | throws | **Yes** — nothing downstream can run without requirements (unchanged from iteration 01) |
| `briefNode` | fallback empty brief + warning | No |
| `questionGenNode`, one category | skip that category, warning | No |
| `questionGenNode`, all categories | throws | **Yes** — no content to schedule or check coverage |
| `generateGapQuestionsNode` | loop just stops, uncovered ids recorded honestly | No |
| `flashcardNode` | pure code — only "fails" if there's a real bug | Yes, if it throws (bug, not flakiness) |
| `scheduleNode` | pure code — same | Yes, if it throws (bug, not flakiness) |
| `validateNode` | schema mismatch | **Yes** — indicates an assembly bug, surfaced deliberately |
| `persistNode` | transaction rollback | **Yes** — DB/infra problem |

General rule embedded throughout: **LLM/network flakiness on optional context → degrade with a warning. Missing content the pipeline structurally cannot proceed without → fail loudly with a clear reason.** Never let a silent partial failure produce a `READY` kit that's actually broken (e.g. missing `role.requirements` entirely) — but also never fail a kit just because one hiring page 404'd or one category of questions came back thin.

---

## 12. LLM resilience wrapper — `src/llm/callWithRetry.ts`

Used by every LLM-calling node (`extractNode`, `briefNode`, `questionGenNode`, `generateGapQuestionsNode`):

```ts
async function callLLMWithRetry<T>(
  fn: () => Promise<unknown>,
  schema: z.ZodSchema<T>,
  { maxAttempts = 3 }: { maxAttempts?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await fn();
      return schema.parse(raw); // throws ZodError on shape mismatch — caught below, retried
    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.status === 429;
      const isTransient = isRateLimit || (err?.status >= 500) || err instanceof z.ZodError;
      if (!isTransient || attempt === maxAttempts) break;
      const retryAfterMs = isRateLimit && err?.headers?.['retry-after']
        ? Number(err.headers['retry-after']) * 1000
        : Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 300; // exponential backoff + jitter
      await sleep(retryAfterMs);
    }
  }
  throw lastError;
}
```

Every node above calls this instead of the raw client directly. On final throw, the calling node decides (per §11's table) whether to catch-and-degrade or let it propagate.

---

## 13. Backend-requirements checklist (§13 of the brief)

- **Separation of concerns**: already structural — retrieval (`researchNode`), extraction (`extractNode`), generation (`questionGenNode`/`briefNode`/`flashcardNode`), scheduling (`scheduleNode`), persistence (`persistNode`) are distinct nodes/files, never mixed.
- **Validate incoming requests**: unchanged from iteration 01's zod schema on `POST /api/kits`, now also enforcing the 70-day cap (§15).
- **Validate the generated kit before saving**: `validateNode` (§8), strict, runs before `persistNode`.
- **Persist enough to reopen and continue**: this is already satisfied by writing real rows (not just a JSON blob) — a `GET /api/kits/:id` (build this route now if not already stubbed) reads back `Kit` + all its relations and reconstructs the same `AppendixAKit` shape for the frontend, meaning a user can navigate away mid-generation and come back to a fully resumable view once `status` reaches `READY` (or see the `FAILED` state with its reason).
- **Handle a run triggered twice for the same posting**: the `dedupeHash` check from iteration 01's design already covers this at the `POST /api/kits` layer — confirm it's actually wired into the route handler now if it wasn't yet.
- **Handle generation taking 90s / failing halfway**: the whole point of this iteration's node-by-node degrade-vs-fail design (§11) *is* the "fails halfway" answer — a partial failure produces a `READY` kit with warnings, not a stuck or silently broken one.

---

## 14. SSE status granularity update

Now that there are real phases worth reporting, upgrade the coarse `PENDING/RUNNING` from iteration 01 to the finer-grained enum values already in your `KitStatus`:

```
PENDING → RESEARCHING (research+extract fan-out) → GENERATING (brief+questionGen fan-out
  through the coverage loop) → SCHEDULING → READY / FAILED
```

Emit a `status` SSE event at each transition in `kitRunner.ts` (one line per transition, same `publish()` call already established in iteration 01 — just call it more often, at the start of each phase). `DRAFT` and the bare `RUNNING` value are left unused going forward (harmless to leave in the enum for backward compatibility, not emitted anymore).

---

## 15. Input validation update

```ts
const createKitSchema = z.object({
  jd: z.string().min(1),
  companyUrl: z.string().url(),
  days: z.number().int().min(1).max(70),  // was previously unbounded — cap added this iteration
});
```

`days > 70` → `400` at the route, same as any other validation failure, never reaches the graph. Document the 70-day cap choice in README as a deliberate UX/scope bound (a 70-day prep plan stops being meaningfully different from "just study broadly").

---

## 16. Explicitly out of scope for this iteration

- Builder UI/API (inline edit, reorder, regenerate-one-section) — next iteration. `ItemState` defaulting to `GENERATED` on write is all this iteration needs to set up correctly for that to work later.
- Practice Mode UI/API (`PracticeAttempt` writes, confidence-ordered queue) — next iteration. The `Flashcard` rows this iteration creates are exactly what that will read.
- Batch CLI (`npm run evaluate`) — reuses this same graph, but is its own iteration since it also needs the file I/O and per-case error handling contract from Appendix B.

---

## 17. Frontend — how it should tolerate this iteration's backend behavior

The frontend currently only renders the iteration-01 `MergedResult` shape from the `result` SSE event. That event's payload is now the full `AppendixAKit` (§2) instead — update the type on the frontend to match, and render accordingly.

**Status handling** — update the `onStatus` handler (from `lib/kits.ts` in iteration 01) to branch on the now-finer statuses and show a distinct label per phase (`"Researching the company..."`, `"Generating interview questions..."`, `"Building your study schedule..."`) rather than one generic "loading" state — this is the "clear loading... states" line from the frontend rubric, made concrete.

**Rendering the ready kit** — once `result` arrives, render each section directly off `AppendixAKit`:

- `company_brief` → Brief panel. If `summary` is empty/generic ("No public information...") **render it as a plain, non-alarming note**, not as an error banner — this is the difference between a degraded-but-successful kit and a failure, and the UI needs to visually reflect that distinction (e.g. a small muted "ℹ️ couldn't find public info about this company" line, not a red error state).
- `role.requirements` → a table/list, grouped or tagged by `priority` (must/nice badges) and `kind`.
- `questions` → grouped by `category` into tabs/sections, each card showing `prompt`, expandable `answer_outline`, a difficulty indicator (e.g. 1–3 dots).
- `flashcards` → grid, front-only by default (full flip interaction is Practice Mode's job next iteration; this iteration's kit view can just list them read-only).
- `schedule.days` → day tabs, each rendering `focus` as the tab's heading label, `minutes` as a small duration chip, and its `question_ids` resolved (client-side join) against the already-loaded `questions[]` array to show the actual prompts for that day — don't expect the API to send duplicated question content inside the schedule; resolve by id from the one `questions[]` array already in the payload.
- `coverage.uncovered_requirement_ids` → if non-empty, render a small honest notice ("2 requirements weren't fully covered by generated questions") rather than hiding it — this mirrors the backend's own "honest, not silent" philosophy.
- `_meta.warnings` (extension field, not in Appendix A itself) → render as a dismissible, low-emphasis notice list if present at all; absence of this field or an empty array means a clean run, don't render anything.

**Failure handling** — the `error` SSE event now only fires for genuinely fatal cases (§11's "Yes" rows) — extraction failure, all-categories question generation failure, validation/persist bugs. Render this as a real error state with a retry action, distinct from the soft "some content is degraded" notices above, which arrive bundled inside a normal successful `result` event.

**Resuming a kit later**: add a plain `GET /api/kits/:id` call (not SSE) for whenever the user navigates directly to a kit's page rather than having just submitted it — reconstructs the same `AppendixAKit` shape from the persisted rows (§13), so the kit view component should be written to accept `AppendixAKit` from either source (`result` SSE event or this `GET`) rather than being coupled to the streaming flow.