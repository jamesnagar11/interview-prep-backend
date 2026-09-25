# Agent Iteration 04 - Memory Checkpoint

## Objectives Completed

1. **Fixed Critical Diff Shape Mismatch in `builderService.ts`**:
   - Resolved key structure discrepancy where frontend `commitBuilderChanges` sent `diff.questions.updates`, `diff.questions.pins`, `diff.questions.reorders`, `diff.flashcards.updates`, and `diff.flashcards.pins` as **Objects** (`Record<id, data>`), while backend expected Arrays (`Array.isArray()`).
   - Implemented dual-handling logic across `commitBuilderDiff`:
     - `questions.updates`: Handled both `Record<string, Partial<GeneratedQuestion>>` and legacy Array formats.
     - `questions.pins`: Handled both `Record<string, boolean>` and legacy Array formats.
     - `questions.reorders`: Handled both `Record<QuestionCategory, string[]>` and legacy Array formats.
     - `flashcards.updates`: Handled both `Record<string, Partial<GeneratedFlashcard>>` and legacy Array formats.
     - `flashcards.pins`: Handled both `Record<string, boolean>` and legacy Array formats.
     - `flashcards.reorders`: Handled both flat `string[]` arrays (frontend builder) and legacy `[{ order: string[] }]` array shapes.

2. **Updated `GET /api/kits/:id` to Reconstruct Kit from Database**:
   - Replaced direct reading of stale `kit.result` JSON blob in `src/routes/kits.ts` with `rebuildKitFromDb(kitId)`.
   - Ensures any committed builder modifications (question/flashcard reorders, pins, text edits) immediately project onto kit-page reloads and navigation.
   - Retained fallback to `kit.result` JSON string if DB reconstruction returns null.

3. **Bypassed DB Persistence for Evaluation Mode (`EVAL_MODE`)**:
   - Modified `src/graph/nodes/persistNode.ts` to check `process.env.EVAL_MODE === 'true'`.
   - When running in evaluation mode, `persistNode` bypasses MongoDB/Prisma writes and returns `{}` immediately.

4. **Created Batch Evaluation CLI (`src/evaluate.ts`)**:
   - Implemented CLI runner that reads test cases from a JSONL file (`cases.jsonl` by default).
   - Bootstraps realistic benchmark test cases if `cases.jsonl` does not exist.
   - Runs `runKitGraph` sequentially per case, calculates metrics (Reqs, Questions, Flashcards, Days, Uncovered Musts using `checkCoverage`), and outputs a clean `console.table`.
   - Exits with code 0 on all-PASS, or code 1 on failure.

5. **Added `"evaluate"` Script to `package.json`**:
   - Added `"evaluate": "bun run ./src/evaluate.ts"` to backend `package.json`.

6. **Build & Type Check Verification**:
   - `bun run build`: Clean compilation (2429 modules bundled in 549ms).
   - Backend `bunx tsc --noEmit`: 0 TypeScript errors.
   - Frontend `npx tsc --noEmit`: 0 TypeScript errors.
