# Person 1 — Backend & AI Integration

**Project:** AI-Powered 3D Environment Platform for Robotics  
**Role:** Person 1 — LLM Router, Prompt Engineering, Repair Loop, Cache, Generate Endpoint  
**Status:** Hackathon implementation plan  
**Primary responsibility:** Accept a text prompt, call Gemini, validate the output using Person 3's validator, and return a valid `EnvironmentSpec` to the caller. Save the result to MongoDB using Person 3's versioned data layer.

> **Dependency:** Person 3 owns the Zod schema, asset catalogue, validator, and MongoDB collections.  
> I import and call their code. I do not duplicate it.  
> Coordinate with Person 3 within the first 20 minutes to agree on exports and collection names.

---

## Architecture (your slice)

```
Client prompt
    |
    v
POST /api/v1/environments/generate
    |
    +-- Rate limit (10 req/min per IP)
    +-- Auth stub (accept all if no Authorization header)
    |
    v
Cache check sha256(prompt)
    |
  hit ──────────────────────────────────────> return { spec, cached: true }
    |
  miss
    |
    v
Embed prompt (Gemini text-embedding-004)
    |
    v
Person 3's MongoDB: $vectorSearch environment_versions
  → top-3 similar specs as few-shot examples
  (fallback to built-in demo scenes if MongoDB unavailable)
    |
    v
Build system prompt
  (role + rules + Person 3's catalogue + examples)
    |
    v
LLM Router
  1. Gemini 1.5 Flash (primary, responseSchema = Person 3's JSON Schema)
  2. OpenRouter meta-llama/llama-3.1-8b-instruct:free (fallback on 429/5xx)
    |
    v
Person 3's Validator (structural → referential → geometric → physical)
    |
  invalid + attempts < 2
    |
    v
Repair prompt (original + bad spec + error list) → LLM again
    |
  valid
    |
    v
Person 3's save logic: insert environment_versions, update environments head
    |
    v
Store in cache
    |
    v
Return { environmentId, versionId, spec, provider, warnings }
```

---

## Project structure (your files only)

```
apps/api/
  src/
    index.ts                     Express app entry, CORS, registers routes
    routes/
      generate.ts                POST /api/v1/environments/generate
      jobs.ts                    GET /api/v1/jobs/:id
    llm/
      interface.ts               LLMProvider TypeScript interface
      gemini.ts                  Gemini 1.5 Flash provider
      openrouter.ts              OpenRouter fallback provider
      router.ts                  Provider selection + repair loop (max 2 retries)
      prompts.ts                 System prompt + repair prompt builders
    cache.ts                     In-memory Map, sha256 key, 1hr TTL
    middleware/
      auth.ts                    JWT stub (accept all if no header)
      rateLimit.ts               10 req/min per IP
  demo-scenes/
    warehouse.json               Pre-generated valid spec (backup / few-shot)
    factory.json
    office.json
    outdoor.json
```

**Not your files — import from Person 3:**
- `packages/schema/src/schema.ts` → Zod schema + JSON Schema export
- `packages/schema/src/catalogue.ts` → `ASSET_CATALOGUE`, `KNOWN_TYPES`
- `packages/validator/src/validator.ts` → `validate(spec)` function
- `apps/api/src/db/` → MongoDB client, collections, save helpers

Agree the exact import paths with Person 3 on day one.

---

## EnvironmentSpec (Person 3's contract — do not redefine)

Person 3 owns this. Copy nothing; import everything. Use the shape below as a reference only — for reading, not for building your own types.

```ts
// You IMPORT this, not define it:
// import { EnvironmentSpecSchema, environmentSpecJsonSchema } from 'packages/schema'
// import { EnvironmentSpec } from 'packages/schema'

EnvironmentSpec {
  schemaVersion: "1.0.0";

  environment: {
    name: string;
    type: "warehouse" | "factory" | "office" | "outdoor" | "custom";
    dimensions: { width: number; length: number; height: number };
  };

  terrain: {
    type: "concrete" | "asphalt" | "grass" | "gravel" | "tile" | "dirt" | "custom";
    properties: { friction: number; restitution?: number };
    heightmap?: unknown | null;
  };

  objects: Array<{
    id: string;
    type: string;              // must be in Person 3's catalogue
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    physics?: { static: boolean; mass: number | null };
    tags?: string[];
  }>;

  lighting?: { preset?: string; intensity?: number };
  navigation?: { waypoints?: Array<{ id: string; position: [number, number, number] }> };
  robotics: { simulation_enabled: boolean };

  provenance: {
    source: string;
    prompt?: string;
    model?: string;
    generatedAt?: string;
    confidence?: number | null;
  };
}
```

Coordinate systems: metres, Y-up. X = width, Y = height, Z = length.

---

## Asset catalogue (Person 3's — inject into prompts, do not redefine)

Person 3's catalogue includes these 15 types. Import and use them verbatim in your LLM prompts.

| type | footprint (m) | height (m) |
|---|---|---|
| `industrial_shelf` | 1.2 × 0.6 | 2.4 |
| `pallet` | 1.2 × 0.8 | 0.15 |
| `workbench` | 1.8 × 0.8 | 0.9 |
| `storage_rack` | 1.5 × 0.6 | 2.0 |
| `forklift_zone` | 3.0 × 4.0 | 0.1 |
| `loading_dock` | 5.0 × 3.0 | 1.2 |
| `conveyor` | 4.0 × 0.8 | 0.9 |
| `machine_station` | 2.0 × 1.5 | 2.0 |
| `office_desk` | 1.4 × 0.7 | 0.75 |
| `office_chair` | 0.6 × 0.6 | 1.0 |
| `crate` | 0.8 × 0.8 | 0.8 |
| `barrier` | 2.0 × 0.2 | 1.0 |
| `column` | 0.4 × 0.4 | 4.0 |
| `door` | 1.0 × 0.1 | 2.1 |
| `charging_station` | 0.6 × 0.6 | 1.5 |

---

## Validation result format (Person 3's — do not redefine)

```ts
// You call: import { validate } from 'packages/validator'
// Result shape:
interface ValidationResult {
  valid: boolean;
  errors: { path: string; code: string; message: string }[];
  warnings: { path: string; code: string; message: string }[];
}
// Error codes: SCHEMA_INVALID, UNKNOWN_ASSET, DUPLICATE_ID,
//              OUT_OF_BOUNDS, OVERLAP, INVALID_SCALE,
//              INVALID_DIMENSIONS, INVALID_PHYSICS
```

---

## API endpoints (your responsibility)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/v1/environments/generate` | `{ prompt: string, projectId?: string }` | `{ environmentId, versionId, spec, provider, warnings }` or error |
| GET | `/api/v1/jobs/:id` | — | `{ status, result? }` |

**Person 3's endpoints (do not build these):**
- `GET /environments`, `GET /environments/:id`
- `GET /environments/:id/versions`, `GET /environments/:id/versions/:n`
- `PUT /environments/:id` (save edited spec)
- `POST /environments/:id/revert`
- `GET /assets/catalogue`

---

## Implementation steps

### Step 1 — Scaffold (15 min)

```bash
mkdir -p apps/api/src/{routes,llm,middleware}
mkdir -p apps/api/demo-scenes
cd apps/api
npm init -y
npm install express @google/generative-ai zod mongodb \
            jsonwebtoken express-rate-limit dotenv axios cors
npm install -D typescript @types/express @types/node @types/cors ts-node tsx
npx tsc --init
# tsconfig.json: target ES2022, module commonjs, strict true, outDir dist
```

**Immediately coordinate with Person 3** to agree:
- Where their `schema.ts`, `validator.ts`, and `catalogue.ts` will live
- What the MongoDB database name and collection names are (`environments`, `environment_versions`)
- What save/upsert helpers they will export for you to call

### Step 2 — LLM provider interface (`src/llm/interface.ts`)

```ts
export interface LLMProvider {
  name: string;
  supportsVision: boolean;
  generateStructured<T>(req: {
    system: string;
    prompt: string;
    jsonSchema: object;
    temperature?: number;
  }): Promise<{ data: T; raw: string }>;
}

export class RetryableError extends Error {
  constructor(message: string) { super(message); this.name = 'RetryableError'; }
}
```

### Step 3 — Gemini provider (`src/llm/gemini.ts`)

- SDK: `@google/generative-ai`
- Model: `gemini-1.5-flash`
- Pass `responseSchema` = `environmentSpecJsonSchema` imported from Person 3's schema package
- Temperature: `0.3`
- On HTTP 429 or any 5xx: throw `RetryableError`
- On JSON parse failure: throw `RetryableError` (let router handle it)
- Include `GEMINI_API_KEY` from env

```ts
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
// responseSchema must be a Gemini-compatible schema object
// Use environmentSpecJsonSchema from Person 3, converted to Gemini format
```

Note: Gemini's `responseSchema` uses its own schema format, not plain JSON Schema. You may need to convert or simplify Person 3's JSON Schema to pass it. A compact hand-written Gemini schema for `EnvironmentSpec` is fine here — just keep the field names exactly matching Person 3's Zod schema.

### Step 4 — OpenRouter fallback (`src/llm/openrouter.ts`)

- POST `https://openrouter.ai/api/v1/chat/completions`
- Model: `meta-llama/llama-3.1-8b-instruct:free`
- No native `responseSchema` — include JSON schema in the system prompt and ask for raw JSON only
- Strip markdown code fences before parsing: `text.replace(/```(?:json)?\n?/g, '').trim()`
- On 429/5xx: throw `RetryableError`

### Step 5 — Prompt builder (`src/llm/prompts.ts`)

System prompt structure (in this order):

```
You convert natural-language environment descriptions into EnvironmentSpec JSON for robot simulation.

RULES:
- All measurements in metres, Y-up coordinate system. X=width, Y=height, Z=length.
- Origin is at the environment centre on the ground plane.
- All object positions MUST be inside environment bounds:
    X: [-width/2, +width/2]  Y: >= 0  Z: [-length/2, +length/2]
- Only use object types from the ASSET CATALOGUE below. No other types.
- Object IDs must be unique strings (e.g. "shelf_001", "shelf_002").
- Static objects should not overlap each other.
- Output raw JSON only — no markdown, no explanation, no code fences.

ASSET CATALOGUE:
(paste catalogue table here, imported from Person 3's catalogue)

EXAMPLES:
(inject 1–3 similar specs from vector search or demo-scenes)

USER DESCRIPTION:
(user prompt)
```

Repair prompt:

```
The EnvironmentSpec you returned was invalid. Fix every listed error.

ORIGINAL REQUEST: (prompt)

YOUR INVALID SPEC:
(raw JSON)

VALIDATION ERRORS:
(errors array as JSON)

Return a corrected EnvironmentSpec JSON only. No markdown. No explanation.
```

### Step 6 — LLM router with repair loop (`src/llm/router.ts`)

```ts
export async function generateWithRepair(
  prompt: string,
  examples: EnvironmentSpec[],
  catalogue: CatalogueEntry[]
): Promise<{ spec: EnvironmentSpec; provider: string; warnings: ValidationWarning[] }> {

  const providers = [geminiProvider, openRouterProvider];

  for (const provider of providers) {
    try {
      const system = buildSystemPrompt(catalogue, examples);
      let { data: spec } = await provider.generateStructured({ system, prompt, jsonSchema, temperature: 0.3 });
      let result = validate(spec);         // Person 3's validator

      if (result.valid) {
        return { spec, provider: provider.name, warnings: result.warnings };
      }

      // Repair loop — max 2 attempts on the same provider
      for (let attempt = 1; attempt <= 2; attempt++) {
        const repairSystem = buildRepairPrompt(prompt, spec, result.errors);
        ({ data: spec } = await provider.generateStructured({ system: repairSystem, prompt: '', jsonSchema, temperature: 0.2 }));
        result = validate(spec);
        if (result.valid) {
          return { spec, provider: provider.name, warnings: result.warnings };
        }
      }

      // This provider exhausted retries — try the next one
    } catch (e) {
      if (e instanceof RetryableError) continue;
      throw e;
    }
  }

  throw Object.assign(new Error('All providers failed'), { code: 'PROVIDER_UNAVAILABLE' });
}
```

### Step 7 — Cache (`src/cache.ts`)

```ts
import { createHash } from 'crypto';

interface CacheEntry { spec: EnvironmentSpec; ts: number }
const store = new Map<string, CacheEntry>();
const TTL_MS = Number(process.env.LLM_CACHE_TTL_SECONDS ?? 3600) * 1000;

export function cacheKey(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

export function getCached(key: string): EnvironmentSpec | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { store.delete(key); return null; }
  return entry.spec;
}

export function setCached(key: string, spec: EnvironmentSpec): void {
  store.set(key, { spec, ts: Date.now() });
}
```

### Step 8 — Generate route (`src/routes/generate.ts`)

```
POST /api/v1/environments/generate

1. rateLimiter middleware
2. authMiddleware (stub: if no Authorization header, attach userId = 'anon')
3. body parse: { prompt: string (10–500 chars), projectId?: string }
   → 400 if missing or invalid
4. key = cacheKey(prompt)
5. if getCached(key): return 200 { spec, cached: true }
6. embed prompt via Gemini embedding API (model: text-embedding-004)
7. Person 3's MongoDB: $vectorSearch environment_versions
   → top-3 similar specs
   → on any MongoDB error: use demo-scenes/warehouse.json as single example
8. load catalogue from Person 3's module
9. generateWithRepair(prompt, examples, catalogue)
   → on PROVIDER_UNAVAILABLE: return 503 { error: { code: 'PROVIDER_UNAVAILABLE', ... } }
10. Person 3's save helper: saveNewVersion(spec, { prompt, provider, projectId })
    → on save error: log and continue (still return spec to client)
11. setCached(key, spec)
12. return 200 {
      environmentId,  // from Person 3's save result
      versionId,
      spec,
      provider,
      warnings
    }
```

All errors return consistent shape:
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [] } }
```
Codes: `VALIDATION_FAILED`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `BAD_REQUEST`

### Step 9 — Express app (`src/index.ts`)

```ts
import express from 'express';
import cors from 'cors';
import { generateRouter } from './routes/generate';
import { jobsRouter } from './routes/jobs';
import { connectMongo } from './db/client'; // Person 3's module

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1/environments', generateRouter);
app.use('/api/v1/jobs', jobsRouter);

const PORT = process.env.PORT ?? 3001;
connectMongo().catch(err => console.warn('MongoDB unavailable, running degraded:', err.message));
app.listen(PORT, () => console.log(`API on port ${PORT}`));
```

### Step 10 — Pre-generated demo scenes (`demo-scenes/`)

Write 4 valid JSON files that each pass `validate(spec)` cleanly:

- `warehouse.json` — 50×80m, 6 industrial_shelf, 2 pallet, 1 loading_dock, 2 waypoints
- `factory.json` — 40×60m, 4 workbench, 3 conveyor, 2 machine_station, 2 pillar
- `office.json` — 20×30m, 6 office_desk, 6 office_chair, 2 barrier
- `outdoor.json` — 80×100m grass terrain, 4 crate, 3 barrier, 2 charging_station

These serve three purposes:
1. Fallback few-shot examples for the LLM system prompt when MongoDB has no similar specs
2. Offline/demo backup spec that works when Gemini is down
3. Seed data for MongoDB on startup

---

## Environment variables (`.env.example`)

```
MONGODB_URI=mongodb+srv://...
GEMINI_API_KEY=
OPENROUTER_API_KEY=
JWT_SECRET=changeme
PORT=3001
CORS_ORIGIN=http://localhost:5173
LLM_CACHE_TTL_SECONDS=3600
```

---

## Interface contracts with other persons

### Person 3 (data/validation) — things you need from them

| What | Import path (agree on day 1) |
|------|------|
| `EnvironmentSpec` TypeScript type | `packages/schema` |
| `EnvironmentSpecSchema` Zod schema | `packages/schema` |
| `environmentSpecJsonSchema` JSON Schema object | `packages/schema` |
| `ASSET_CATALOGUE`, `KNOWN_TYPES` | `packages/schema/catalogue` |
| `validate(spec)` → `ValidationResult` | `packages/validator` |
| MongoDB `connectMongo()` | `apps/api/src/db/client` |
| `saveNewVersion(spec, meta)` helper | `apps/api/src/db/versions` |
| `findSimilarVersions(embedding, topK)` | `apps/api/src/db/versions` |

If Person 3 hasn't built the save helper yet, stub it locally and replace the import when they land it:
```ts
// STUB — replace with Person 3's real save helper
async function saveNewVersion(spec, meta) {
  console.log('[STUB] saveNewVersion called');
  return { environmentId: 'stub-env-id', versionId: 'stub-version-id' };
}
```

### Person 2 (frontend) — things you give them

- `POST /api/v1/environments/generate` endpoint running on `http://localhost:3001`, CORS open
- Response shape: `{ environmentId, versionId, spec, provider, warnings }`
- `demo-scenes/warehouse.json` — the hardcoded sample spec to use before the real API lands
- The Gemini embedding endpoint they can optionally call for "find similar" UI (Point them at Person 3's endpoint for that)

### Person 4 (integration/deployment) — things you give them

- `.env.example` with all required keys
- `GEMINI_API_KEY`, `OPENROUTER_API_KEY` usage docs so they can configure Vercel/Render env vars
- The `/api/v1/environments/generate` endpoint that Person 4 will wire into the photo upload flow

---

## Hackathon build order

```
0 – 20 min    Coordinate with Person 3: agree export paths, collection names,
              save helper signature. Get warehouse.json demo scene done.

20 – 60 min   LLM layer: interface.ts, gemini.ts, openrouter.ts, prompts.ts
              Test Gemini directly with a hardcoded prompt before wiring anything.

60 – 90 min   router.ts: repair loop. Test with a deliberately bad spec —
              inject an out-of-bounds object and confirm the loop triggers.

90 – 120 min  generate route: cache, embedding, vector search (stub if Person 3
              isn't done), generateWithRepair call, save stub.

120 – 150 min Wire in Person 3's real save helper once they land it.
              Run the full curl smoke test (see Done criteria).

150 – 180 min Cache test (same prompt twice), fallback test (remove Gemini key),
              demo-scenes seeding, env vars, CORS.
```

---

## Done criteria

- [ ] `curl -X POST localhost:3001/api/v1/environments/generate -H 'Content-Type: application/json' -d '{"prompt":"warehouse 30x40m with 3 shelf aisles"}'` returns 200 with a valid spec JSON
- [ ] The spec passes Person 3's `validate(spec)` with no errors
- [ ] A prompt that causes the LLM to generate out-of-bounds objects triggers the repair loop (visible in server logs)
- [ ] Removing `GEMINI_API_KEY` from env causes the request to fall through to OpenRouter and still return a valid spec
- [ ] Same prompt sent twice returns the second response from cache (no second LLM call in logs)
- [ ] Spec is saved to Person 3's `environment_versions` collection and retrievable by `environmentId`
- [ ] Response includes CORS headers so Person 2's frontend on `:5173` can call it
