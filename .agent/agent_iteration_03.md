# Agent Iteration 03 (BACKEND) — The Builder + Practice Mode

## ⚠️ Self-checkpointing protocol (same rule as iteration 02 — mandatory)

Before starting: check for `agent_iteration_03_memory.md` in repo root. If present, read it, resume from its "Exact next step," don't redo completed items. Work the checklist (§0) in order. After finishing each item, immediately update the memory file (same template as iteration 02's, reproduced here for convenience):

```markdown
# Iteration 03 (Backend) — Progress Memory
Last updated: <ISO timestamp>
## Done
- [x] 1. Schema changes applied + migrated
...
## Decisions/deviations
- ...
## Exact next step
- ...
## Known issues
- ...
```

If you estimate your context budget is tight relative to remaining checklist items, stop at the next safe boundary, write the checkpoint, end your turn — don't wait to be told.

---

## 0. Checklist

1. Schema changes (§1) — apply and migrate before writing any route
2. Shared pure-function refactor: extract `generateBrief`, `generateQuestionsForCategory`, `checkCoverage`, `buildSchedule` out of the LangGraph nodes into standalone functions both the graph and the new Builder routes call (§2)
3. Builder — question/flashcard/brief CRUD routes (§3)
4. Builder — commit/diff endpoint + `scheduleStale` mechanics (§4)
5. Builder — regenerate endpoints (brief / one category / schedule) (§5)
6. Builder — manual schedule edit endpoint (§6)
7. Practice — session lifecycle endpoints (§7)
8. Practice — adaptive queue algorithm (§8)
9. Edge cases + failure handling pass (§9)
10. README notes as you go (§10)

---

## Assumptions / schema changes — **frontend must treat these as authoritative going into its own iteration doc**

These are additions to the Prisma schema you pasted. Apply all of them before writing routes:

```prisma
model Kit {
  // ...existing fields unchanged...
  briefState    ItemState @default(GENERATED)   // NEW — brief has no list, so one flag covers edit/regen protection
  research      Json?                            // NEW — persisted ResearchBundle (aboutText/hiringProcessText),
                                                   //       needed so brief regeneration doesn't require re-crawling
  scheduleStale Boolean   @default(false)        // NEW — true whenever a question/flashcard CRUD happens after
                                                   //       the schedule was last (re)generated; frontend reads this
                                                   //       to show the "reschedule needed" banner
}

model PracticeAttempt {
  // ...
  confidence  Int?   // CHANGED from required Int to optional — a skipped card has no meaningful confidence value;
                      // forcing a fake number would corrupt the queue algorithm's averaging/sorting later
}
```

Also add `onDelete: Cascade` to these relations if not already present, so deleting a `Question`/`Flashcard` cleanly removes its join rows instead of orphaning them or throwing an FK error:

- `QuestionRequirement.question` → cascade
- `FlashcardRequirement.flashcard` → cascade
- `ScheduleDayQuestion.question` → cascade (deleting a question removes it from any day it was scheduled on)
- `PracticeAttempt.flashcard` → cascade

**Confidence scale**: keep the 1–10 range from your current schema (not 1–3 as an earlier draft used) — the frontend doc (agent_iteration_02.md, frontend) is written against this 1–10 scale, so don't change it again without updating both docs.

---

## 1. Refactor first — pure functions reused by both the graph and Builder routes

Move the core logic out of `src/graph/nodes/*.ts` into `src/services/kit/*.ts` as plain, framework-agnostic functions, and have the graph nodes become thin wrappers that call them (same pattern your `*NodeWrapper` naming already suggests you're using — keep it consistent):

```
src/services/kit/
  generateBrief.ts              // (aboutText) => CompanyBrief — pulled out of briefNode
  generateQuestionsForCategory.ts // (requirements, category, hiringContext) => GeneratedQuestion[] — out of questionGenNode
  checkCoverage.ts                // (requirements, questions) => uncoveredIds[] — already pure, just relocate
  buildSchedule.ts                 // (questions, requirements, daysAvailable) => Schedule — out of scheduleNode
  validateKit.ts                    // zod schema check — out of validateNode
```

Why this matters for this iteration specifically: **"regenerate one category" and "regenerate schedule" are not new logic** — they're the exact same functions the initial pipeline already uses, called again with a narrower input. Reimplementing them inside the Builder routes would violate the "clearly separated concerns" backend requirement and double your surface area for bugs. The graph nodes and the Builder routes both become thin callers of the same service functions — this is also a good, concrete thing to point at in the README under "code quality."

---

## 2. Builder — item CRUD routes

All routes below require the existing auth middleware and check `kit.userId === req.user.userId` (404, not 403, if it's someone else's kit — don't leak existence). All also require `kit.status === 'READY'` — return `409 { error: 'Kit is still generating' }` otherwise; Builder actions on a non-ready kit make no sense.

```
PATCH  /api/kits/:id/brief
  body: { summary?, what_they_do? }
  → updates Kit.briefSummary/briefWhatTheyDo, sets briefState = 'EDITED'

PATCH  /api/kits/:id/questions/:qid
  body: { prompt?, answerOutline?, category?, difficulty? }
  → updates the Question row; state becomes 'EDITED' UNLESS it's already 'PINNED' (pinned stays pinned)
  → if `category` changed, this IS "move a question to another category" — no separate endpoint needed
  → sets Kit.scheduleStale = true if this question currently appears in any ScheduleDayQuestion

PATCH  /api/kits/:id/questions/:qid/pin
  body: { pinned: boolean }
  → sets state = 'PINNED' when true, or 'EDITED' when false (never back to 'GENERATED' —
    once a human has touched it, it's never silently eligible for auto-replacement again)

POST   /api/kits/:id/questions
  body: { category, prompt, answerOutline, difficulty, requirementIds: string[] }
  → creates a new Question row, stableKey = next "qN" in sequence for this kit,
    state = 'EDITED' (a hand-added item is never 'GENERATED'), orderIndex = end of its category
  → creates QuestionRequirement rows for each requirementId (validate they exist on this kit first — 400 if not)

DELETE /api/kits/:id/questions/:qid
  → deletes the Question (cascade removes QuestionRequirement + ScheduleDayQuestion rows)
  → if it was referenced in the schedule, set Kit.scheduleStale = true

PATCH  /api/kits/:id/questions/reorder
  body: { category: QuestionCategory, order: string[] }   // ordered array of question ids in that category
  → sets orderIndex on each per its position in `order` — pure reorder, no state change on the items themselves
    (reordering isn't "editing content," so a GENERATED question that just got reordered stays GENERATED —
    it's still fully safe to replace on a future regeneration of its category)

# identical shape for flashcards:
PATCH  /api/kits/:id/flashcards/:fid
PATCH  /api/kits/:id/flashcards/:fid/pin
POST   /api/kits/:id/flashcards
DELETE /api/kits/:id/flashcards/:fid
PATCH  /api/kits/:id/flashcards/reorder
```

**Why per-item routes instead of one big diff endpoint for these**: these are the *individual* CRUD actions (§0 item 3). §4 adds one additional endpoint on top for the frontend's "batch several edits, then hit Save" UX — that's a separate concern (client-side batching), not a replacement for having real, individually-addressable REST routes. Build both; the frontend chooses which to call based on its own save strategy (see the frontend doc, §5).

---

## 3. The "unsaved changes" batch commit endpoint

The frontend's intended UX (per your description) is: local edits accumulate in the UI, a "Save changes" banner appears, and one click flushes everything. Support that with one endpoint that accepts a diff and applies it atomically:

```
POST /api/kits/:id/builder/commit
body: {
  brief?: { summary?, what_they_do? },
  questions?: {
    updates?: [{ id, prompt?, answerOutline?, category?, difficulty? }],
    creates?: [{ category, prompt, answerOutline, difficulty, requirementIds }],
    deletes?: [id],
    reorders?: [{ category, order: string[] }],
    pins?: [{ id, pinned }],
  },
  flashcards?: { /* same shape as questions */ },
}
```

- Runs as one `prisma.$transaction` — either the whole diff applies or none of it does. This is the correct behavior for a "Save" button: a partial save is worse than a failed save the user can retry.
- Internally, this handler is a thin loop that calls the exact same per-item logic as the individual routes in §3 (don't duplicate the update/state-transition rules — factor them into shared functions the individual routes and this commit endpoint both call).
- Response: the full, freshly-recomputed `AppendixAKit` (including re-run `checkCoverage` — see below — and current `scheduleStale` value).
- **Coverage is recomputed after every commit**, not just after generation: call the shared `checkCoverage(requirements, currentQuestions)` function (§1) against whatever the question set looks like *after* this diff applies, and persist the resulting `uncoveredRequirementIds`. `coveragePasses` is left untouched by manual edits — it's a record of how many *automated* gap-fill passes ran during generation, not a count of user actions.
- `scheduleStale` is set `true` if any `questions`/`flashcards` change in this diff touches an item currently referenced in `ScheduleDayQuestion`, or if any question is created/deleted — i.e. essentially any structural question change flips it. A pure flashcard-only diff never touches `scheduleStale` (flashcards aren't part of the schedule).

---

## 4. Regenerate endpoints

All three run **synchronously within the request** (await inline, return the updated kit) — each is a single, fast LLM call (brief) or a handful (one category) or zero (schedule), so there's no need for the SSE/background-job machinery from generation; a normal loading spinner on the frontend covers it. Document this as a deliberate simplicity choice.

```
POST /api/kits/:id/regenerate/brief
  → calls generateBrief(kit.research.aboutText) (§1's shared function)
  → REFUSES to run if briefState === 'EDITED': return 409 { error: 'Brief has manual edits — discard them first or they will be lost' }.
    This is the direct implementation of "regeneration must not discard edits" for the single-item brief case —
    since there's no partial-brief state to merge, the only safe behavior is to block, not silently overwrite.
  → on success: briefState reset to 'GENERATED'

POST /api/kits/:id/regenerate/questions/:category
  → category ∈ technical | behavioural | system-design | company-fit
  → fetch all current Question rows in this kit+category
  → split: keep = state !== 'GENERATED' (i.e. EDITED or PINNED — untouched), replace = state === 'GENERATED'
  → DELETE the `replace` set (cascades their QuestionRequirement + ScheduleDayQuestion rows;
    this is why scheduleStale gets set here too if any were scheduled)
  → call generateQuestionsForCategory(requirements-mapped-to-this-category, category, kit.research.hiringProcessText)
    (§1's shared function — same one the initial pipeline uses)
  → new questions get fresh "qN" stableKeys continuing the kit's existing counter (never reuse a retired id)
  → recompute coverage across the WHOLE kit (a category regeneration can fix or newly create gaps
    in requirements that other categories also touch, so don't scope the coverage check to just this category)
  → set Kit.scheduleStale = true (new question ids exist that aren't in any schedule day yet)
  → this is the literal implementation of "a question the user wrote or edited must survive a regeneration
    of its category": it was never in the `replace` set to begin with, because state !== 'GENERATED' excluded it

POST /api/kits/:id/regenerate/schedule
  → zero LLM cost — calls buildSchedule(currentQuestions, currentRequirements, kit.daysAvailable) (§1's shared function)
  → deletes all existing ScheduleDay/ScheduleDayQuestion rows for this kit, creates fresh ones from the result
  → sets Kit.scheduleStale = false
```

---

## 5. Manual schedule editing (distinct from "regenerate")

Regenerating replaces the whole schedule via the algorithm. Manually rearranging (drag a question to a different day, reorder within a day, edit a day's `focus` label) is a separate, lighter action — no algorithm involved, direct persistence of what the user arranged:

```
PATCH /api/kits/:id/schedule
body: {
  days: [
    { day: number, focus?: string, question_ids: string[], minutes?: number }
  ]
}
```

- Validates every `question_ids` entry references a real `Question` on this kit (400 with the offending id if not) — this is what stops the frontend from accidentally referencing a deleted question.
- Validates `days.length === kit.daysAvailable` (can't manually change the day count — that's a `days` field change, out of scope for the Builder; the user would need a new kit for that).
- Replaces `ScheduleDay`/`ScheduleDayQuestion` rows for the given days wholesale (delete + recreate is simplest and safest here, not a diff).
- If `minutes` is omitted for a day, recompute it as the sum of `TIME_PER_DIFFICULTY_MIN[q.difficulty]` for that day's questions (reuse the constant from `buildSchedule`, don't hardcode it twice).
- Sets `scheduleStale = false` — a manual arrangement is, by definition, exactly what the user wants; it's not "stale," it's deliberate. (Only automated question/flashcard CRUD sets `scheduleStale = true`; a manual schedule edit resets it.)
- **Does not** re-run must-coverage validation as a hard block — if the user manually removes every question tied to a must-have from the schedule, that's their call; surface it as a soft warning in the response (`{ warnings: [...] }`) rather than rejecting the request. Consistent with the "not everything is a failure" philosophy from iteration 02.

---

## 6. Practice sessions

```
POST /api/kits/:id/practice/sessions
  → creates a PracticeSession row (startedAt = now, endedAt = null)
  → 409 if kit.status !== 'READY' or the kit has zero flashcards

POST /api/kits/:id/practice/sessions/:sid/attempts
  body: { flashcardId, confidence: number | null, skipped: boolean }
  → creates a PracticeAttempt row. `confidence` is null when `skipped: true` — this is exactly
    why the schema field was changed to nullable (see the assumptions section above)
  → validate the session belongs to this user and is still open (endedAt === null) — 409 if already ended

POST /api/kits/:id/practice/sessions/:sid/end
  → sets endedAt = now
  → **this is the only action that makes a session count** — see §8. An abandoned session
    (browser closed, navigated away, endedAt never set) is simply never queried by the history
    or the adaptive-queue algorithm; it doesn't need explicit deletion, it's just structurally
    invisible to anything that filters on `endedAt: { not: null }`. Optional hardening (not required
    for this iteration, note as a TODO): a scheduled cleanup job deleting sessions where
    `endedAt IS NULL AND startedAt < now() - 24h`, to keep the table tidy — purely janitorial,
    doesn't change correctness since abandoned sessions are already ignored everywhere that matters.

GET /api/kits/:id/practice/sessions
  → list ended sessions for this user+kit, newest first, with attempt counts + avg confidence per session
    (`WHERE endedAt IS NOT NULL`)

GET /api/kits/:id/practice/sessions/:sid
  → full detail: every attempt in the session, joined to its flashcard's front/back for review
```

---

## 7. The adaptive queue — `GET /api/kits/:id/practice/queue`

**Computed fresh on every call. Never stored.** Zero LLM calls — pure query + sort.

```ts
async function getPracticeQueue(kitId: string, userId: string): Promise<string[]> {
  const flashcards = await prisma.flashcard.findMany({ where: { kitId }, include: { requirements: true } });
  if (flashcards.length === 0) return [];

  // latest attempt per flashcard, across ALL ended sessions for this user+kit —
  // not just the most recent session, since a card might not have appeared in the last session at all
  const lastAttemptByCard = await getLatestAttemptPerFlashcard(userId, kitId); // Map<flashcardId, {confidence, attemptedAt} | undefined>

  const buckets = { unseen: [] as Flashcard[], rated: [] as { card: Flashcard; confidence: number }[] };

  for (const card of flashcards) {
    const last = lastAttemptByCard.get(card.id);
    const isStale = !last || card.updatedAt > last.attemptedAt || last.confidence == null;
    if (isStale) {
      buckets.unseen.push(card); // covers: never attempted, was skipped last time, OR edited since last attempt
    } else {
      buckets.rated.push({ card, confidence: last.confidence });
    }
  }

  const priorityRank = (card: Flashcard) =>
    card.requirements.some(r => r.priority === 'must') ? 0 : 1;

  // unseen first, tie-broken by must-priority — this is also the correct COLD START rule:
  // a first-time user has every card in `buckets.unseen`, so the whole queue falls back to
  // "must-priority first" ordering, which is exactly the sensible default with zero history
  buckets.unseen.sort((a, b) => priorityRank(a) - priorityRank(b));

  // rated cards: lowest confidence first, tie-broken by must-priority
  buckets.rated.sort((a, b) => a.confidence - b.confidence || priorityRank(a.card) - priorityRank(b.card));

  return [...buckets.unseen, ...buckets.rated.map(r => r.card)].map(c => c.id);
}
```

**This single function is the direct answer to every adaptivity requirement in the brief:**

- *"Order the next session by what they were least confident about"* → the `rated` sort.
- *First-time user, no history* → falls out of the same logic for free (`buckets.unseen` = everything), no special-casing needed.
- *Session cut short and abandoned* → never enters `lastAttemptByCard` at all, since that query only reads ended sessions — an abandoned session's in-progress attempts are simply invisible here (they exist in the DB, harmlessly, but nothing reads them).
- *Flashcards added/edited/deleted between sessions* → deleted ones are gone from the `flashcards` query entirely; edited ones get caught by the `card.updatedAt > last.attemptedAt` staleness check and re-bucketed as unseen rather than trusting a rating that was made against different content; newly added ones have no `lastAttemptByCard` entry at all, so they're `unseen` by construction.

**Chosen algorithm, for the README**: confidence-weighted resort with a staleness check, not full spaced-repetition (SM-2/Anki-style intervals). Reasoning: SM-2 needs a notion of "due date" per card that compounds over multiple real review cycles to be meaningful — for a kit someone works through over a handful of days before one interview (not an ongoing long-term deck), that machinery adds complexity without adding real value at this timescale. Confidence-weighted resort is simple, fully explainable to the user, adapts correctly to edits, and directly implements the one behavior the spec actually asks for.

---

## 8. Edge cases

| Situation | Handling |
| --- | --- |
| Builder/practice action on a kit that's still generating | `409`, every route checks `status === 'READY'` first |
| Editing a question that's already `PINNED` | Edit still applies (content updates), state stays `PINNED`, not downgraded |
| Regenerating a category where every question is `EDITED`/`PINNED` | `replace` set is empty, LLM isn't even called (skip the call, return immediately with the unchanged category) — don't waste a call generating questions that will all be discarded anyway since there's nothing to replace |
| Regenerating brief with `briefState: 'EDITED'` | Blocked (`409`) — see §5, this is the correct "don't discard edits" behavior for a non-list field |
| Deleting a question that's the *only* one covering a must-have requirement | Allowed — not blocked. Coverage recompute (§4) will surface it as newly uncovered, shown as a soft warning, exactly like any other coverage gap. The user is allowed to make a kit temporarily "incomplete"; the UI just needs to be honest about it, not prevent it |
| Manual schedule edit referencing a deleted question id | `400`, rejected with the offending id — this is the one case in this whole iteration that IS a hard validation failure, since it's a client bug (stale local state), not a legitimate content situation |
| Practice queue requested on a kit with 0 flashcards | Returns `[]`, not an error — frontend renders an empty state, not a failure state |
| `POST attempts` on an already-ended session | `409` — can't add to a session after it's closed |
| Two commits/regenerations racing on the same kit | Not solved in this iteration beyond normal DB transaction isolation (last-write-wins at the transaction level) — acceptable for a single-user-editing-their-own-kit assumption; note as a known limitation in README, not a bug to chase down here |

---

## 9. README notes to carry over from this iteration

- The `ItemState` tri-state (`GENERATED`/`EDITED`/`PINNED`) is the entire answer to the "hardest state problem" — explain it exactly as described in §5's regeneration logic (filter-then-replace-only-the-generated-subset).
- The confidence-weighted-resort-over-SM2 decision (§8) and why.
- The synchronous-regenerate-instead-of-background-job decision (§5) and why (fast enough not to need it).
- `scheduleStale` as the mechanism connecting Builder edits to the "reschedule needed" prompt, and the distinction between "regenerate" (algorithmic) vs "manual edit" (direct) for the schedule.