# Agent Iteration 01 — Background Pipeline + SSE Status Stream (Production Architecture)

## Context for the agent

Node.js + TypeScript + Express backend for a job-interview-prep-kit generator. Auth is already implemented: an existing middleware verifies a JWT from the `Authorization` header and attaches `req.user = { userId, email, name }` on any route it's applied to.

**Nothing else exists yet.** LangGraph, OpenRouter, the crawl pipeline, persistence for this feature, and both routes below need to be set up from scratch in this iteration.

**This is production-shaped, not a throwaway test slice.** The request/response split matters:

1. `POST /api/kits` — takes `{ jd, companyUrl, days }`, does the minimum work to persist a Kit row and acknowledge, **returns immediately** (does not wait for the pipeline), and triggers the pipeline to run in the background.
2. The background pipeline runs the parallel research + extraction branches, merges them, persists the result, and publishes status/result events.
3. `GET /api/kits/:id/stream` — a separate SSE endpoint the frontend opens right after the POST ack, using native `EventSource`. It replays current state if the pipeline already progressed/finished, or subscribes live otherwise.

**Scope of this iteration — build exactly this, nothing more:**

- The two routes above, full background-job wiring, the parallel research/extraction/merge pipeline, and the frontend code to call both routes.
- Question generation, flashcards, schedule, coverage loop, batch CLI — **not this iteration**.
- `Requirement`/`Question`/etc. tables — **not this iteration**. The extracted role/requirements data is stored as a JSON blob on the `Kit` row for now; normalizing it into its own tables happens once question generation exists and needs to reference individual requirement ids relationally.
- Fine-grained per-crawl-page progress events — **not this iteration**. Status granularity is `PENDING → RUNNING → READY/FAILED`; that's enough for this slice.
- Multi-instance pub/sub (Redis) for the SSE layer — **not this iteration**, single-instance in-process pub/sub is documented below and is the correct scope for now; note in code comments where Redis would slot in later if horizontally scaled.

---

## 1. Setup tasks

Install:

```
npm install @langchain/langgraph @langchain/core zod cheerio robots-parser fast-xml-parser openai
```

Env vars (`.env` + `.env.example`):

```
OPENROUTER_API_KEY=
OPENROUTER_MODEL=          # pick a free ":free"-suffixed OpenRouter model; document the exact one in README
```

Folder structure:

```
src/
  config/
    env.ts
  llm/
    openrouterClient.ts
  graph/
    state.ts
    graph.ts
    nodes/
      researchCompany.ts
      extractRequirements.ts
      merge.ts
  services/
    crawl/
      robots.ts
      sitemap.ts
      candidates.ts
      fetchPage.ts
      cleanText.ts
      researchCompany.ts
    kits/
      kitRunner.ts          # background orchestrator: run graph, persist, publish events
      kitEvents.ts           # in-process pub/sub (EventEmitter keyed by kitId)
  routes/
    kits.ts                 # POST /api/kits + GET /api/kits/:id/stream
  db/
    prisma.ts                # Prisma client singleton (if not already present)
  types/
    kit.ts
```

---

## 2. Persistence — minimal `Kit` model

Add to `schema.prisma` (adjust to whatever DB/ORM setup already exists in the repo — if Prisma isn't wired up yet, set it up now with whatever DB is already provisioned, e.g. Postgres):

```prisma
model Kit {
  id          String   @id @default(cuid())
  userId      String
  jdText      String
  companyUrl  String
  daysAvailable Int
  status      KitStatus @default(PENDING)
  result      Json?     // MergedResult, written once status = READY
  errorMessage String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum KitStatus {
  PENDING
  RUNNING
  READY
  FAILED
}
```

Run the migration. This is the only table this iteration needs.

---

## 3. Shared types — `src/types/kit.ts`

```ts
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
```

---

## 4. Research branch — `src/services/crawl/researchCompany.ts`

No LLM call in the normal path. Plain async function, never throws — always resolves to a `ResearchBundle`, degrading to empty on any failure.

```ts
export async function researchCompany(companyUrl: string): Promise<ResearchBundle>
```

Steps, each wrapped so failure at any step degrades gracefully instead of throwing:

1. Validate `companyUrl` parses as a URL. Invalid → empty bundle, `pagesSkipped: [{url, reason: 'invalid_url'}]`.
2. `HEAD` (fallback `GET`) the origin, 5s timeout. Unreachable → empty bundle, `reason: 'unreachable'`.
3. Fetch + parse `robots.txt` at the origin, cache per origin for this run. Missing → allow-all.
4. Try `/sitemap.xml`, then `/sitemap_index.xml` (follow one level if it's an index). Parse `<loc>` entries into candidates.
5. Fetch the homepage once, extract same-origin `<a href>` links via cheerio (nav, footer, body).
6. Merge candidates: sitemap URLs + this hardcoded list + homepage links, deduped:

   ```
   about: /about, /about-us, /company, /team, /culture, /mission
   hiring: /careers, /jobs, /careers/jobs, /join-us, /work-with-us, /hiring,
           /interview-process, /careers/interview-process, /handbook,
           /blog/careers, /engineering-blog
   ```
7. Score each candidate by keyword match on URL path + anchor text against `ABOUT_TERMS`/`HIRING_TERMS` (plain string matching, no model call). Sort each bucket descending, take top 3 "about" + top 5 "hiring".
8. Fetch the shortlist: concurrency cap 2–3, per-request timeout 6–8s, `text/html` only, \~2MB size cap, retry up to 2x with exponential backoff on timeout/5xx, no retry on 404/403/robots-disallowed. Every failure recorded in `pagesSkipped`, never aborts the rest.
9. Clean each successful fetch with cheerio (strip `script/style/nav/footer/header`), truncate to \~3000 chars.
10. No embedding scoring in this iteration — keep it to keyword scoring; take the top-scoring successfully-fetched candidate(s) per bucket as `aboutText`/`hiringProcessText` (join with `\n\n` if more than one qualifies).
11. Hard time cap: wrap the whole function in a `Promise.race` against a 25s timer — on timeout, return whatever's been collected.
12. Always return a valid `ResearchBundle`; catch any unexpected error and return the empty-bundle shape instead of throwing.

---

## 5. Extraction branch — `src/llm/openrouterClient.ts` + `src/graph/nodes/extractRequirements.ts`

```ts
// src/llm/openrouterClient.ts
import OpenAI from 'openai';
export const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

`extractRequirements(jd: string): Promise<ExtractedRole>`:

- Zod schema matching `ExtractedRole`.
- Prompt: read the JD, return ONLY JSON matching the schema; assign `id` as `r1, r2, ...` in the order requirements appear; mark `priority: "must"` only for explicit required/must-have language (years-of-experience phrasing counts as must), everything else `"nice"`; never invent requirements not present in the text.
- Call with `response_format: { type: 'json_object' }` if the chosen free model supports JSON mode, else strict-JSON-only prompting + defensive parsing.
- Validate with zod. On failure, retry once with a "your last response was invalid JSON, return ONLY the JSON object" follow-up. Still failing → throw `ExtractionFailedError` (the background runner catches this, see §7).

---

## 6. LangGraph wiring — `src/graph/state.ts` + `src/graph/graph.ts`

```ts
// state.ts
import { Annotation } from '@langchain/langgraph';

export const KitState = Annotation.Root({
  jd: Annotation<string>,
  companyUrl: Annotation<string>,
  days: Annotation<number>,
  research: Annotation<ResearchBundle | null>({ default: () => null, reducer: (_, v) => v }),
  role: Annotation<ExtractedRole | null>({ default: () => null, reducer: (_, v) => v }),
  merged: Annotation<MergedResult | null>({ default: () => null, reducer: (_, v) => v }),
});
```

`graph.ts`:

- Node `researchNode` → `researchCompany(state.companyUrl)` → `{ research: result }`
- Node `extractNode` → `extractRequirements(state.jd)` → `{ role: result }`
- Node `mergeNode` → assembles `MergedResult` from `state.research` + `state.role` (pure object assembly, no LLM) → `{ merged: result }`
- Edges: `START → researchNode`, `START → extractNode` (fan-out = parallel execution), `researchNode → mergeNode`, `extractNode → mergeNode`, `mergeNode → END`. LangGraph waits for all incoming edges before running `mergeNode` — no manual `Promise.all` needed.
- Export `runKitGraph(input: {jd, companyUrl, days}): Promise<{merged: MergedResult}>`.

---

## 7. Background runner + pub/sub — `src/services/kits/kitEvents.ts` + `kitRunner.ts`

`kitEvents.ts` — single-process pub/sub. Fine for one backend instance; if this ever scales horizontally, swap this for a Redis pub/sub channel keyed the same way (`kit:{id}`) without touching the route or runner logic:

```ts
import { EventEmitter } from 'node:events';
export const kitEvents = new EventEmitter();
kitEvents.setMaxListeners(0);
```

`kitRunner.ts`:

```ts
export async function runKit(kitId: string, jd: string, companyUrl: string, days: number) {
  const publish = (evt: KitStreamEvent) => kitEvents.emit(kitId, evt);

  try {
    await prisma.kit.update({ where: { id: kitId }, data: { status: 'RUNNING' } });
    publish({ event: 'status', data: { status: 'RUNNING' } });

    const { merged } = await runKitGraph({ jd, companyUrl, days });

    await prisma.kit.update({
      where: { id: kitId },
      data: { status: 'READY', result: merged as any },
    });
    publish({ event: 'result', data: merged });
  } catch (err: any) {
    await prisma.kit.update({
      where: { id: kitId },
      data: { status: 'FAILED', errorMessage: err.message },
    });
    publish({ event: 'error', data: { message: err.message } });
  }
}
```

This function is called **without `await`** from the POST handler (fire-and-forget from the request's perspective — it keeps running after the response is sent).

---

## 8. Route — `POST /api/kits`

```
POST /api/kits
Headers: Authorization: Bearer <token>
Body: { jd: string, companyUrl: string, days: number }
Response: 202 { kitId: string, status: "PENDING" }
```

```ts
router.post('/api/kits', authMiddleware, async (req, res) => {
  const parsed = createKitSchema.safeParse(req.body); // zod: jd non-empty, companyUrl valid URL, days int 1-90
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { jd, companyUrl, days } = parsed.data;

  const kit = await prisma.kit.create({
    data: {
      userId: req.user.userId,
      jdText: jd,
      companyUrl,
      daysAvailable: days,
      status: 'PENDING',
    },
  });

  void runKit(kit.id, jd, companyUrl, days); // not awaited — runs in background

  res.status(202).json({ kitId: kit.id, status: kit.status });
});
```

The response returns as soon as the DB row is created — this is the "ack" the frontend gets, well before the pipeline finishes.

---

## 9. Route — `GET /api/kits/:id/stream`

```
GET /api/kits/:id/stream?token=<jwt>
```

`EventSource` cannot send an `Authorization` header, so auth here comes from a `token` query param, verified the same way the header-based middleware does (same JWT verify call, different extraction point — don't duplicate the verification logic, factor it into a shared `verifyToken(token)` function used by both the header middleware and this route).

```ts
router.get('/api/kits/:id/stream', async (req, res) => {
  const token = req.query.token as string | undefined;
  let user;
  try {
    user = verifyToken(token); // throws on invalid/missing
  } catch {
    return res.status(401).end();
  }

  const kit = await prisma.kit.findUnique({ where: { id: req.params.id } });
  if (!kit || kit.userId !== user.userId) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (evt: KitStreamEvent) => {
    res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
  };

  // Replay current state immediately — handles the case where the pipeline
  // already progressed or finished before this connection was opened.
  if (kit.status === 'READY') {
    send({ event: 'result', data: kit.result as unknown as MergedResult });
    return res.end();
  }
  if (kit.status === 'FAILED') {
    send({ event: 'error', data: { message: kit.errorMessage ?? 'Unknown error' } });
    return res.end();
  }
  send({ event: 'status', data: { status: kit.status as 'PENDING' | 'RUNNING' } });

  // Not finished yet — subscribe for live updates.
  const listener = (evt: KitStreamEvent) => {
    send(evt);
    if (evt.event === 'result' || evt.event === 'error') {
      kitEvents.off(kit.id, listener);
      res.end();
    }
  };
  kitEvents.on(kit.id, listener);

  req.on('close', () => kitEvents.off(kit.id, listener));
});
```

**Security note to document in README, not to solve in this iteration:** a JWT in a query string can end up in server access logs. Acceptable tradeoff for now given `EventSource`'s header limitation; a short-lived, single-use stream token (minted by the POST handler and handed back alongside `kitId`, verified once and discarded) is the documented upgrade path if this needs to be hardened later.

---

## 10. Frontend — Next.js

Two-step flow: `POST` to create + get `kitId` immediately, then a native `EventSource` against the stream route.

```ts
// lib/kits.ts

export async function createKit(
  jd: string,
  companyUrl: string,
  days: number,
  token: string
): Promise<{ kitId: string; status: string }> {
  const res = await fetch('/api/kits', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jd, companyUrl, days }),
  });
  if (!res.ok) throw new Error(`Failed to create kit: ${res.status}`);
  return res.json();
}

export function subscribeToKit(
  kitId: string,
  token: string,
  handlers: {
    onStatus?: (status: 'PENDING' | 'RUNNING') => void;
    onResult: (result: MergedResult) => void;
    onError: (message: string) => void;
  }
): () => void {
  const es = new EventSource(`/api/kits/${kitId}/stream?token=${encodeURIComponent(token)}`);

  es.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    handlers.onStatus?.(data.status);
  });

  es.addEventListener('result', (e) => {
    handlers.onResult(JSON.parse(e.data));
    es.close();
  });

  es.addEventListener('error', (e: any) => {
    // Note: EventSource also fires a generic 'error' on connection drop —
    // distinguish a real server-sent error frame (has e.data) from a
    // transport-level error (no e.data) before surfacing it as a failure.
    if (e.data) {
      handlers.onError(JSON.parse(e.data).message);
    } else {
      handlers.onError('Connection lost');
    }
    es.close();
  });

  return () => es.close(); // cleanup handle for the component to call on unmount
}
```

```tsx
// app/kits/new/page.tsx (usage sketch)
'use client';
import { useState } from 'react';
import { createKit, subscribeToKit } from '@/lib/kits';

export default function NewKitPage() {
  const [status, setStatus] = useState<'idle' | 'PENDING' | 'RUNNING' | 'done' | 'error'>('idle');

  async function handleSubmit(jd: string, companyUrl: string, days: number, token: string) {
    const { kitId } = await createKit(jd, companyUrl, days, token);
    setStatus('PENDING');

    const unsubscribe = subscribeToKit(kitId, token, {
      onStatus: (s) => setStatus(s),
      onResult: (result) => {
        setStatus('done');
        // render `result`, or router.push(`/kits/${kitId}`) and re-fetch there
      },
      onError: (message) => {
        setStatus('error');
        // surface `message` in the UI
      },
    });

    // unsubscribe() on component unmount if the user navigates away mid-stream
  }

  return null; // wire up the actual form + status UI
}
```

---

## 11. Non-goals for this iteration

- No `Requirement`/`Question`/`Flashcard`/`ScheduleDay` tables — extracted role data stays as a JSON blob on `Kit.result` for now.
- No question generation, flashcards, schedule, or coverage loop.
- No embedding-based relevance scoring in the crawl — keyword scoring only.
- No fine-grained per-crawl-page or per-branch progress events — `PENDING → RUNNING → READY/FAILED` is the full status granularity for this slice.
- No batch CLI endpoint.
- No Redis/multi-instance pub/sub — documented as the scale-up path, not built now.
- No short-lived single-use stream token — query-param JWT is the documented, acceptable-for-now tradeoff.

## 12. Done criteria

- `POST /api/kits` with a valid JWT returns `202 { kitId, status: "PENDING" }` in well under a second, regardless of how long the pipeline takes.
- Opening `GET /api/kits/:id/stream?token=...` immediately after the POST receives a `status` event, then eventually a `result` or `error` event, then the connection closes cleanly.
- Opening the same `GET` stream **after** the pipeline has already finished (e.g. page refresh) immediately receives the final `result`/`error` event instead of hanging — this is the replay-on-connect check.
- An invalid `companyUrl` still produces a `result` event with an empty research bundle — extraction succeeds independently, this is not a `FAILED` kit.
- Killing the crawl's network mid-run doesn't hang past \~25–30s — the research node's internal timeout returns whatever it collected, the pipeline still reaches `READY`.
- Frontend: submitting the form shows a pending state immediately (from the POST ack), then updates live as `status`/`result`/`error` events arrive, with no polling involved.