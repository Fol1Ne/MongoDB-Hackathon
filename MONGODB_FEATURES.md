# Codebase review & MongoDB/Atlas feature mapping

Status check performed 2026-10-03. Backend is functionally complete for P0/P1 scope; waiting on frontend before wiring up the live Atlas cluster.

## Current repo state

Three-person plan (`PLAN.md`, `Person3_Plan.md`, `person1-plan.md`) merged into one Fastify monorepo under `@twin/*` workspaces.

- [packages/schema](packages/schema/src/index.ts) — Zod `EnvironmentSpec`, single source of truth (dimensions, terrain, objects, physics, provenance, validation codes)
- [packages/catalogue](packages/catalogue/src/index.ts) — 15 fixed asset types (shelf, pallet, forklift, conveyor, etc.) with footprint/height/collision
- [packages/validator](packages/validator/src/index.ts) — structural → referential → geometric → physical validation layers
- [apps/api/src/app.ts](apps/api/src/app.ts) — Fastify routes: CRUD + versioning + revert + `/environments/generate` (LLM) + `/environments/validate`
- [apps/api/src/repository.ts](apps/api/src/repository.ts) — MongoDB repo: `environments` (head pointer) + `environment_versions` (immutable snapshots), transactional writes, optimistic concurrency via `baseVersion`
- [apps/api/src/db/jsonSchema.ts](apps/api/src/db/jsonSchema.ts) — MongoDB `$jsonSchema` as a second validation safety net
- [apps/api/src/llm/](apps/api/src/llm/router.ts) — Gemini 1.5 Flash primary, OpenRouter free-model fallback, 2-attempt repair loop, cache, Gemini `text-embedding-004` + `$vectorSearch` for few-shot examples (falls back to `demo-scenes/*.json` if Mongo/Gemini unavailable)
- [docs/api.md](docs/api.md) — full API contract already written

**Note on git status:** the deletions shown in `git status` (`apps/api/src/db/client.ts`, `catalogue/assets.ts`, `middleware/`, `routes/`, `validation/`, old `tsconfig.json`/`package-lock.json`) are stale duplicate files from an earlier Express-based layout, superseded by the current Fastify `@twin/*` refactor (commit `aa9d8f1`). Safe to commit as deletions — not a bug.

Current embedding/search stack uses **Gemini embeddings + Gemini/OpenRouter LLMs**, not MongoDB Atlas automated embedding or Voyage AI.

## Mapping the 5 requested features onto this codebase

1. **Automated embedding (Atlas + Voyage AI, GA since 2026-08-12)**
   Replaces `createGeminiEmbedding()` in [gemini.ts:118-126](apps/api/src/llm/gemini.ts:118) and the manual embed-then-`$vectorSearch` step in [generate.ts:37-58](apps/api/src/generate.ts:37). Instead of computing the embedding yourself, index `summaryText` (already computed in [repository.ts:39-45](apps/api/src/repository.ts:39)) with an Atlas vector index that auto-embeds via Voyage on insert/update — removes the embedding pipeline code entirely.
   Source: https://www.mongodb.com/products/updates/now-ga-automated-embedding-in-atlas-vector-search/

2. **Multimodal embeddings (Voyage multimodal-3.5, photo upload)**
   Maps to the planned-but-unbuilt image-to-environment pipeline (tech doc section 10) — not started in `apps/api`. Would let "upload a photo, find similar environments" become MongoDB-native. Exact automated-embedding plug-in setup unverified — check Voyage docs before building.
   Source: https://itbrief.co.uk/story/mongodb-adds-voyage-4-ai-models-automates-vector-search

3. **Hybrid search (keyword + vector)**
   Would extend similarity lookups to a combined `$search`/`$vectorSearch` compound stage — useful for catalogue/environment lookup by name and by meaning in one query.
   Source: https://mongodb.com/blog/post/realm-now-part-atlas-platform

4. **Agent memory (retrieval + reranking + persistent memory)**
   Fits the "LLM teammate" layer — an assistant that remembers a user's earlier edits/preferences across sessions. Not yet built.
   Source: https://www.constellationr.com/insights/news/mongodb-adds-automated-voyage-embeddings-atlas-vector-search

5. **Everything in one platform**
   Already the stated design principle in [PLAN.md](PLAN.md) and tech doc section 11: documents, vectors, keyword search, time-series (`run_metrics`), and change streams all on one Atlas cluster — e.g. one query joining "similar warehouses" with "robot success rate above 90%".

## Next step

Waiting on frontend. Once the Atlas cluster is live, swap out the Gemini embedding step for Atlas automated embedding (item 1) first since it's a direct drop-in replacement for existing code.
