# Agent Iteration 01 — Implementation Memory

## Execution Status
**Status:** COMPLETED & VERIFIED

All deliverables for **Agent Iteration 01 — Background Pipeline + SSE Status Stream** have been fully implemented, integrated, and verified across both backend and frontend.

---

## Completed Tasks Summary

### 1. Backend Architecture & Setup
- **Dependencies Installed:** `@langchain/langgraph`, `@langchain/core`, `zod`, `cheerio`, `robots-parser`, `fast-xml-parser`, `openai`.
- **Environment Configuration (`src/config/env.ts`):** Environment helper created supporting `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `JWT_SECRET`, and `PORT`. Documented in `.env.example`.
- **OpenRouter Client (`src/llm/openrouterClient.ts`):** Configured OpenAI SDK pointing to OpenRouter API endpoint.

### 2. Database Schema & Prisma Contract
- **Contract Updated (`src/prisma/contract.prisma`):** Updated `Kit` model and `KitStatus` enum to include `PENDING`, `RUNNING`, `READY`, `FAILED` status and `errorMessage`, `result` stringified fields.
- **Contract Emitted:** Ran `bun prisma contract emit` successfully to generate contract JSON and type definitions.

### 3. Types (`src/types/kit.ts`)
Created TypeScript interface definitions:
- `ResearchBundle`
- `Requirement`
- `ExtractedRole`
- `MergedResult`
- `KitStreamEvent`

### 4. Resilient Crawl Pipeline (`src/services/crawl/`)
- `robots.ts`: `robots.txt` fetcher and parser using `robots-parser` with origin caching and allow-all fallback.
- `sitemap.ts`: XML sitemap parser for `/sitemap.xml` and `/sitemap_index.xml` using `fast-xml-parser`.
- `candidates.ts`: Merges candidate URLs (hardcoded about/hiring routes + sitemap + homepage links) and performs keyword scoring for shortlist selection.
- `cleanText.ts`: Cheerio HTML text cleaner (strips nav, footer, header, scripts, styles) and same-origin link extractor.
- `fetchPage.ts`: Concurrency-capped HTTP fetcher with timeouts, max size caps, and retries with backoff.
- `researchCompany.ts`: Main research orchestrator with 25s hard time cap using `Promise.race`, degrading gracefully to empty bundle on failure without throwing.

### 5. Extraction Node (`src/graph/nodes/extractRequirements.ts`)
- Calls OpenRouter model with Zod schema validation.
- Parses role title, seniority, responsibilities, and requirements (`r1, r2, ...`).
- Includes single automatic retry prompt on JSON parsing failure before raising `ExtractionFailedError`.

### 6. Parallel LangGraph Workflow (`src/graph/`)
- `state.ts`: Defined `KitState` with LangGraph `Annotation.Root`.
- `nodes/researchCompany.ts`: LangGraph wrapper for research service.
- `nodes/merge.ts`: Pure object assembly combining extracted role and research bundle into `MergedResult`.
- `graph.ts`: Compiled state graph fanning out from `START` to `researchNode` and `extractNode` in parallel, fanning in to `mergeNode` -> `END`. Exported `runKitGraph()`.

### 7. Background Orchestration & Pub/Sub
- `src/services/kits/kitEvents.ts`: EventEmitter single-instance pub/sub channel.
- `src/services/kits/kitRunner.ts`: `runKit()` background runner. Updates DB status (`RUNNING` -> `READY`/`FAILED`), executes `runKitGraph()`, and emits `status`/`result`/`error` events via `kitEvents`.

### 8. API Routes (`src/routes/kits.ts`)
- `POST /api/kits`: Validates payload (`jd`, `companyUrl`, `days`) using Zod. Creates `Kit` record (`PENDING`), launches `runKit()` asynchronously (fire-and-forget), and immediately returns `202 { kitId, status: "PENDING" }`.
- `GET /api/kits/:id/stream`: Native SSE endpoint (`text/event-stream`). Authenticates via query param `?token=<jwt>` or `Authorization` header using `verifyToken`. Replays existing state (`READY` or `FAILED`) immediately on connect, or subscribes to live updates via `kitEvents` until completion.
- Registered under `/api` in `src/index.ts`.

### 9. Frontend Next.js Client (`client/lib/api/kits.ts` & `client/app/dashboard/interview-prep/page.tsx`)
- `client/lib/api/kits.ts`: `createKit()` API wrapper and `subscribeToKit()` native `EventSource` helper.
- `client/app/dashboard/interview-prep/page.tsx`: Updated creation modal to initiate POST request and listen live to SSE status stream (`PENDING` -> `RUNNING` -> `READY`/`FAILED`), rendering extracted role and responsibilities upon completion.

---

## Verification Results
- **Backend Type Check:** `bun run tsc --noEmit` passed with 0 errors.
- **Frontend Build:** `npm run build` in `client` compiled successfully with Turbopack & static page generation.

---

## Notes for Next Agent / Developer
- Single-instance `EventEmitter` is used for in-process SSE streaming. If scaling horizontally, replace `kitEvents.ts` with Redis Pub/Sub (`kit:${id}`).
- Question generation, flashcards, and schedule generation are deferred to Iteration 02.
