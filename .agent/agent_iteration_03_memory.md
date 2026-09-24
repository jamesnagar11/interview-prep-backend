# Iteration 03 (Backend) — Progress Memory
Last updated: 2026-09-24T19:28:10Z

## Done
- [x] 1. Schema changes applied + contract emitted — contract.prisma updated (`briefState`, `research`, `scheduleStale`, nullable `confidence`, `PracticeSession` / `PracticeAttempt` relations), `bun contract:emit` compiled cleanly.
- [x] 2. Shared pure-function refactor — extracted `generateBrief.ts`, `generateQuestionsForCategory.ts`, `checkCoverage.ts`, `buildSchedule.ts`, `validateKit.ts` into `src/services/kit/`. Refactored LangGraph nodes to delegate to pure service functions.
- [x] 3. Builder — question/flashcard/brief CRUD routes — implemented in `src/services/kit/builderService.ts` and `src/routes/builder.ts` with `ItemState` (`GENERATED`/`EDITED`/`PINNED`) preservation and `scheduleStale` tracking.
- [x] 4. Builder — commit/diff endpoint + `scheduleStale` mechanics — `POST /api/kits/:id/builder/commit` implemented with atomic transaction, coverage recomputation, and updated `AppendixAKit` response.
- [x] 5. Builder — regenerate endpoints — `POST /api/kits/:id/regenerate/brief` (blocks 409 if EDITED), `POST /api/kits/:id/regenerate/questions/:category` (preserves EDITED/PINNED questions), `POST /api/kits/:id/regenerate/schedule` (resets `scheduleStale = false`).
- [x] 6. Builder — manual schedule edit endpoint — `PATCH /api/kits/:id/schedule` implemented with day validation, question existence verification, soft must-have warnings, and `scheduleStale = false` reset.
- [x] 7. Practice — session lifecycle endpoints — `POST /api/kits/:id/practice/sessions`, `POST /api/kits/:id/practice/sessions/:sid/attempts`, `POST /api/kits/:id/practice/sessions/:sid/end`, `GET /api/kits/:id/practice/sessions`, `GET /api/kits/:id/practice/sessions/:sid` implemented in `src/services/kit/practiceService.ts` and `src/routes/practice.ts`.
- [x] 8. Practice — adaptive queue algorithm — `GET /api/kits/:id/practice/queue` implemented with confidence-weighted resort, staleness handling (edits/skips/unseen reset), and must-priority tie-breaking.
- [x] 9. Edge cases + failure handling pass — 409 handling for non-READY kits / EDITED brief / closed sessions, 404/400 validation errors, soft warnings for unscheduled must-haves.
- [x] 10. README notes updated — `backend/README.md` updated with `ItemState` tri-state, confidence-weighted resort vs SM-2, synchronous regeneration, and `scheduleStale` mechanics.

## Decisions/deviations
- `@prisma/orm-mongo` compatibility: removed `@default` attributes from PSL schema and used `.all()` and `.deleteAll()` query methods.
- `Kit.research` persisted as stringified `ResearchBundle` JSON to enable brief and question category regeneration without re-crawling company web pages.
- Adaptive queue filters latest attempts across *ended* sessions only (`endedAt IS NOT NULL`), automatically ignoring abandoned in-progress sessions.

## Exact next step
- ALL DONE. Iteration 03 Backend implementation complete and verified end-to-end.

## Known issues
- None — TypeScript bundle built cleanly with 0 errors (`bun run build`), and full test suite (`test_builder_practice.ts`) executed with 100% passing tests.
