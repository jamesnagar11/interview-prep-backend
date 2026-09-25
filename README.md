# AI Interview Prep — Backend

## Running the server

```bash
bun install
bun run dev   # or: bun run src/index.ts
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `DATABASE_URL` | MongoDB connection string |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `JWT_SECRET` | JWT signing secret |

---

## Architecture

### Graph pipeline (LangGraph)

The kit generation pipeline is a LangGraph `StateGraph`. Each node is a separate file in `src/graph/nodes/`. The full flow:

```
START → [researchNode, extractNode] (parallel fan-out)
      → mergeNode
      → [briefNode, questionGenNode] (parallel fan-out)

questionGenNode → coverageCheckNode
coverageCheckNode → (has gaps & passes < 3?) generateGapQuestionsNode → coverageCheckNode
                    (no gaps or cap reached) → flashcardNode → scheduleNode

[briefNode, scheduleNode] → assembleNode → validateNode → persistNode → END
```

### Iteration 02 design decisions

#### `MAX_COVERAGE_PASSES = 3`
The gap-fill loop runs at most 3 times. Pass 1 is the normal questionGenNode output. Passes 2–3 give the loop two genuine retries to close coverage gaps. A requirement the model can't cover in 3 tries usually reflects a genuinely awkward or ambiguous JD line rather than a fixable prompt issue — logging it in `coverage.uncovered_requirement_ids` is the honest, user-visible answer.

#### `flashcardNode` — code-derived, no LLM call
Flashcards are derived directly from questions (one per question, front = prompt, back = first 2–3 sentences of `answer_outline`). This is a deliberate cost-saving choice: it keeps `requirement_ids` coverage identical to the question bank, for free. The next iteration's Practice Mode will add flip interaction; this iteration only needs readable flashcard rows in the DB.

#### `scheduleNode` — pure code, zero LLM calls
The schedule is built by a greedy-fill algorithm:
- Questions sorted: must-priority first, then difficulty descending (harder material early)
- Soft daily budget of 60 minutes; days can overflow rather than dropping questions
- Buffer/review days fill remaining slots when there are fewer questions than days, using must-priority questions for spaced-repetition review
- `deriveFocusLabel` uses a frequency count of requirement text — no new LLM call needed

#### 70-day cap on `days` input
`days > 70` returns a 400 at the route before the graph runs. A 70-day prep plan stops being meaningfully different from "just study broadly" — capping it keeps the schedule dense and useful.

#### System-design question escalation (heuristic)
Technical requirements whose text contains architecture/scale signal words (`scale`, `distributed`, `architecture`, `system design`, `high availability`, `throughput`, etc.) OR whose priority is `must` and the role seniority suggests senior/staff/lead are escalated to the `system-design` category. This is a heuristic, not a hard rule — it affects prompt grouping and question style, not coverage or scoring.

#### Hiring-process context injection
If the company's hiring process page was successfully crawled, its text is included in the `technical` and `system-design` category prompts. The prompt instructs the model: *"If the hiring-process text mentions a take-home assignment, a system-design round, pair programming, or similar, bias question style toward that format."* This produces meaningfully different kits for companies that publish their interview format.

#### Failure severity
- **Fatal** (marks kit `FAILED`): `extractNode` failure, all question-generation categories failing, `validateNode` schema mismatch, `persistNode` DB error
- **Non-fatal** (pushes a warning, kit still reaches `READY`): `briefNode` failure (empty brief), individual category failure in `questionGenNode`, coverage gap remaining after max passes, `generateGapQuestionsNode` failure

#### Idempotency / deduplication
`POST /api/kits` hashes `jd + companyUrl` and skips creating a new kit if one with the same hash and a non-failed status already exists for that user. The full kit data is stored in `Kit.result` (JSON) for replay on SSE reconnect and for `GET /api/kits/:id` direct navigation.

---

### Iteration 03 design decisions — Builder + Practice Mode

#### `ItemState` tri-state (`GENERATED` / `EDITED` / `PINNED`)
The `ItemState` tri-state solves the partial-regeneration state protection problem:
- `GENERATED`: untouched model output, eligible for replacement on category regeneration.
- `EDITED`: content modified by user, preserved across category regenerations.
- `PINNED`: explicitly locked by user, preserved across category regenerations and excluded from auto-replacement pools.
When regenerating a question category, the handler splits existing questions into `keep` (`EDITED` or `PINNED`) and `replace` (`GENERATED`). Only the `replace` set is deleted and replaced with new LLM output.

#### Confidence-weighted resort vs SM-2 algorithm
For practice flashcard queueing, a confidence-weighted resort algorithm with staleness check was chosen over full SM-2/Anki-style interval scheduling:
- SM-2 requires interval compounding across long-term review cycles, whereas prep kits are focused on short-term interview preparation (a few days to weeks).
- Confidence-weighted resort prioritizes unseen/skipped cards first (sorted by must-have requirement priority), followed by rated cards sorted by lowest confidence score.
- Flashcard edits/staleness dynamically reset cards to the unseen bucket.

#### Synchronous regeneration
Regeneration endpoints (`brief`, question category, `schedule`) run synchronously within standard HTTP requests rather than queued background jobs. Since single-category or brief calls are fast single LLM interactions (~2-5 seconds), standard request-response with loading indicators provides a simpler, lower-overhead UX.

#### `scheduleStale` flag mechanics
Structural edits to questions (creating, deleting, category updating, or altering questions present in schedule slots) flip `Kit.scheduleStale = true`. This flags to the UI that a schedule re-alignment is recommended. Regenerating the schedule or manually editing the schedule resets `scheduleStale = false`.

---

### Iteration 04 design decisions — Batch Evaluation & Kit DB Reconstruction

#### Batch Evaluation CLI (`bun run evaluate`)
- Evaluates full graph pipeline quality and coverage offline across multiple JDs in batch without writing to MongoDB (`EVAL_MODE=true`).
- Command: `bun run evaluate [path/to/cases.jsonl]` (defaults to `cases.jsonl`).
- Bypasses DB writes in `persistNode` while validating complete kit generation, `checkCoverage` must-have requirement tracking, and step timings.
- Output: `console.table` summary report detailing Reqs, Questions, Flashcards, Days, Uncovered Musts, and status (`PASS`/`FAIL`). Exits with code 0 on all-PASS, code 1 on failure.

#### DB-backed Kit Reconstruction (`rebuildKitFromDb`)
- `GET /api/kits/:id` calls `rebuildKitFromDb(kitId)` instead of serving stale `Kit.result` JSON strings.
- Reconstructs `AppendixAKit` directly from relational tables (`Requirement`, `Question`, `Flashcard`, `ScheduleDay`, etc.), guaranteeing that builder edits (pins, reorders, category updates) immediately reflect across page navigation and reloads.
- Dual-handling diff shape alignment: `builderService.ts` accepts both Map/Record objects (`Record<id, data>`) and legacy arrays for question/flashcard batch commits.
