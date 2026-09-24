# Iteration 02 — Progress Memory
Last updated: 2026-09-24T13:41:30Z

## Done (checklist items from agent_iteration_02.md §0)
- [x] 1. KitState + types updated — src/graph/state.ts, src/types/kit.ts
- [x] 2. briefNode — src/graph/nodes/briefNode.ts (uses research.aboutText, degrades to empty brief on failure, never throws)
- [x] 3. questionGenNode — src/graph/nodes/questionGenNode.ts (category grouping, system-design escalation, hiring-process injection, per-category failure degradation)
- [x] 4. coverageCheckNode + gap-fill loop + conditional edges — src/graph/nodes/coverageCheckNode.ts + generateGapQuestionsNode.ts (MAX_COVERAGE_PASSES=3)
- [x] 5. flashcardNode — src/graph/nodes/flashcardNode.ts (code-derived, no LLM call, one per question)
- [x] 6. scheduleNode — src/graph/nodes/scheduleNode.ts (greedy-fill, soft budget, buffer days, all invariants satisfied)
- [x] 7. assembleNode + validateNode — src/graph/nodes/assembleNode.ts (strict Zod schema, schedule.days.length invariant check)
- [x] 8. persistNode — src/graph/nodes/persistNode.ts (sequential awaits, stableKey→dbId map, all 9 model types, Kit.status READY on success only)
- [x] 9. Updated graph wiring — src/graph/graph.ts (sequential execution flow, prevents fan-in race conditions)
- [x] 10. LLM resilience wrapper — src/llm/callWithRetry.ts (exponential backoff, rate-limit detection, ZodError retry)
- [x] 11. Backend-requirements checklist pass — dedupeHash in route, GET /api/kits/:id added, SSE replay updated
- [x] 12. SSE status granularity update — kitRunner.ts emits RESEARCHING; KitStatus typed throughout
- [x] 13. Input validation update — 70-day cap in createKitSchema (routes/kits.ts)
- [x] 14. README notes — backend/README.md (all design decisions documented)
- [x] 15. Fixed assembleNode fan-in bug — refactored graph edges to sequential pipeline execution in graph.ts
- [x] 16. Added LangSmith observability — installed `langsmith`, configured env vars in `.env` and `.env.example`, added missing-key auto-guard

## Decisions/deviations made so far
- Refactored graph execution flow to be sequential (`extractNode → researchNode → mergeNode → briefNode → questionGenNode → coverageCheckNode loop → flashcardNode → scheduleNode → assembleNode → validateNode → persistNode`) to eliminate LangGraph fan-in race conditions where `assembleNode` fired before `scheduleNode` completed.
- Added LangSmith SDK dependency and configuration variables (`LANGCHAIN_TRACING_V2`, `LANGCHAIN_ENDPOINT`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`) to `.env` and `.env.example`.
- Added dynamic key check guard in `src/index.ts` and `src/graph/graph.ts` to automatically suppress 403 HTTP tracing error noise when `LANGCHAIN_API_KEY` is not yet provided by the user.

## Exact next step
- ALL DONE. Iteration 02 bug fixes and LangSmith observability complete and verified end-to-end.

## Known issues / TODO before this item is truly done
- None — TypeScript compiles clean (0 errors) and end-to-end pipeline test executed successfully in 80.29s with Kit status READY in DB.
