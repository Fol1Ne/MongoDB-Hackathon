# Person 1 — Backend & AI Integration

## Goal

Build the Node.js/TypeScript API that accepts a text prompt and returns a valid `EnvironmentSpec` JSON. Done when `POST /environments/generate` with a prompt returns a validated spec that saves to MongoDB.

---

## Architecture (your slice)

```
Client prompt
    |
    v
POST /api/v1/environments/generate
    |
    +-- Rate limit (express-rate-limit)
    +-- JWT auth check (stub for hackathon if needed)
    |
    v
Cache check (sha256 of prompt) ──hit──> return cached spec
    |
  miss
    |
    v
Embed prompt (Gemini embedding)
    |
    v
MongoDB $vectorSearch → top-3 similar specs (few-shot examples)
    |
    v
Build system prompt (role + rules + catalogue + examples)
    |
    v
LLM Router
  1. Gemini Flash (primary, responseSchema enforced)
  2. OpenRouter free model (fallback on 429/5xx)
    |
    v
Validator (Zod → referential → bounds → overlap)
    |
  invalid + retries < 2
    |
    v
Repair prompt (original + bad spec + error list) → LLM again
    |
  valid
    |
    v
Save to MongoDB (environment_versions + environments head)
    |
    v
Return { environmentId, versionId, spec, provider, warnings }
```

---

## Project structure

```
apps/api/
  src/
    index.ts                   Express app entry, registers routes
    routes/
      environments.ts          POST /environments/generate, GET list
      jobs.ts                  GET /jobs/:id (polling)
    llm/
      interface.ts             LLMProvider TypeScript interface
      gemini.ts                Gemini Flash provider
      openrouter.ts            OpenRouter fallback provider
      router.ts                Provider selection + repair loop (max 2 retries)
      prompts.ts               System prompt + repair prompt builders
    validation/
      schema.ts                Zod EnvironmentSpec schema (single source of truth)
      validator.ts             4-layer validation (structural/referential/bounds/overlap)
    catalogue/
      assets.ts                12-15 known object types with footprints
    db/
      client.ts                MongoDB connection from MONGODB_URI env
      collections.ts           Typed collection wrappers + $jsonSchema setup on startup
    cache.ts                   In-memory Map keyed by sha256(prompt), TTL 1hr
    middleware/
      auth.ts                  JWT verify (stub: accept all if no Authorization header)
      rateLimit.ts             10 req/min per IP
  demo-scenes/
    warehouse.json             Pre-generated valid spec (warehouse, 6 shelf aisles)
    factory.json               Pre-generated valid spec (factory floor)
    office.json                Pre-generated valid spec (office navigation)
    outdoor.json               Pre-generated valid spec (outdoor terrain)
  package.json
  tsconfig.json
  .env.example
```

---

## EnvironmentSpec JSON shape (agree with teammates before coding)

This is the contract everyone builds against. Person 2 (frontend) renders it; Person 3 (data) writes the Zod schema and MongoDB validator. Use the warehouse example below as the hardcoded sample spec until the real API lands.

```json
{
  "schemaVersion": "1.0.0",
  "environment": {
    "name": "Warehouse Environment",
    "type": "warehouse",
    "dimensions": { "width": 50, "length": 80, "height": 12 }
  },
  "terrain": {
    "type": "concrete",
    "properties": { "friction": 0.8, "restitution": 0.05 },
    "heightmap": null
  },
  "objects": [
    {
      "id": "shelf_001",
      "type": "industrial_shelf",
      "position": [10, 0, 15],
      "rotation": [0, 0, 0],
      "scale": [1, 1, 1],
      "physics": { "static": true, "mass": null },
      "tags": ["storage"]
    }
  ],
  "lighting": { "preset": "warehouse_overhead", "intensity": 1.0 },
  "navigation": {
    "waypoints": [
      { "id": "wp_start", "position": [0, 0, 0] },
      { "id": "wp_dock", "position": [-20, 0, 35] }
    ]
  },
  "robotics": { "simulation_enabled": true },
  "provenance": {
    "source": "text",
    "prompt": "A 50 by 80 metre warehouse with 6 shelf aisles and a loading dock.",
    "model": "gemini-1.5-flash",
    "generatedAt": "2026-09-29T14:20:00Z",
    "confidence": null
  }
}
```

Coordinate conventions: metres, Y-up, origin at environment centre on the ground plane.

---

## API endpoints (your responsibility)

| Method | Path | Body / Query | Returns |
|--------|------|--------------|---------|
| POST | `/api/v1/environments/generate` | `{ prompt, projectId? }` | `{ environmentId, versionId, spec, provider, warnings }` |
| GET | `/api/v1/jobs/:id` | — | `{ status, result? }` |
| GET | `/api/v1/assets/catalogue` | — | array of asset definitions |

Person 3 owns save/list/revert/history endpoints. You own the generation side.

---

## Implementation steps

### Step 1 — Scaffold (15 min)

```bash
mkdir -p apps/api/src/{routes,llm,validation,catalogue,db,middleware}
mkdir -p apps/api/demo-scenes
cd apps/api
npm init -y
npm install express @google/generative-ai zod zod-to-json-schema mongodb \
            jsonwebtoken express-rate-limit dotenv axios
npm install -D typescript @types/express @types/node ts-node tsx
npx tsc --init  # then set target: ES2022, module: commonjs, strict: true
```

### Step 2 — Zod schema (`src/validation/schema.ts`)

Define `EnvironmentSpecSchema`. Key constraints:
- `environment.type`: enum `["warehouse","factory","office","outdoor","custom"]`
- `terrain.type`: enum `["concrete","asphalt","grass","gravel","tile","dirt","custom"]`
- `terrain.properties.friction`: `z.number().min(0).max(2)`
- `objects[].scale`: each element `z.number().positive()`
- `objects[].id`: unique (enforced in validator layer, not Zod)
- Max 500 objects

Then export the JSON Schema for Gemini and MongoDB:
```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
export const environmentSpecJsonSchema = zodToJsonSchema(EnvironmentSpecSchema);
```

### Step 3 — Asset catalogue (`src/catalogue/assets.ts`)

12 known types. Person 3 may expand this but you need it first for prompts and validation.

```ts
export const ASSET_CATALOGUE = [
  { type: "industrial_shelf",         footprint: [1.2, 0.6],  height: 2.4 },
  { type: "pallet",                   footprint: [1.2, 0.8],  height: 0.15 },
  { type: "forklift_bay",             footprint: [3.0, 4.0],  height: 0.1 },
  { type: "loading_dock",             footprint: [5.0, 3.0],  height: 1.2 },
  { type: "wall_panel",               footprint: [4.0, 0.2],  height: 3.0 },
  { type: "door",                     footprint: [1.0, 0.1],  height: 2.1 },
  { type: "conveyor_belt",            footprint: [4.0, 0.8],  height: 0.9 },
  { type: "robot_charging_station",   footprint: [0.6, 0.6],  height: 1.5 },
  { type: "workbench",                footprint: [1.8, 0.8],  height: 0.9 },
  { type: "storage_bin",              footprint: [0.6, 0.4],  height: 0.5 },
  { type: "pillar",                   footprint: [0.3, 0.3],  height: 4.0 },
  { type: "floor_marking",            footprint: [1.0, 0.1],  height: 0.01 },
];
export const KNOWN_TYPES = new Set(ASSET_CATALOGUE.map(a => a.type));
```

### Step 4 — LLM provider interface (`src/llm/interface.ts`)

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
```

### Step 5 — Gemini provider (`src/llm/gemini.ts`)

- SDK: `@google/generative-ai`
- Model: `gemini-1.5-flash`
- Pass `responseSchema` = the exported `environmentSpecJsonSchema`
- Temperature: `0.3`
- Throw a typed `RetryableError` on HTTP 429 or 5xx so the router can catch it

### Step 6 — OpenRouter fallback (`src/llm/openrouter.ts`)

- POST to `https://openrouter.ai/api/v1/chat/completions`
- Model: `meta-llama/llama-3.1-8b-instruct:free`
- No native schema enforcement — include JSON schema in the system prompt and parse the response
- Extract JSON from code fences if needed

### Step 7 — Prompt builder (`src/llm/prompts.ts`)

System prompt sections (in order):
1. **Role**: "You convert natural-language descriptions into EnvironmentSpec JSON for robot simulation."
2. **Rules**: metres, Y-up, positions must be inside environment bounds, only use the listed object types, no overlapping static objects, output raw JSON only (no markdown).
3. **Schema**: paste a compact version of the JSON Schema.
4. **Catalogue**: enumerated list — `type | footprint (m) | height (m)` for each asset.
5. **Examples**: inject 1–3 similar specs retrieved from MongoDB (or hardcoded warehouse example if none available).
6. **Request**: `User description: <prompt>`

Repair prompt:
```
The spec you returned was invalid. Original request: <prompt>

Invalid spec:
<spec as JSON>

Validation errors:
<error list>

Return a corrected EnvironmentSpec JSON that fixes every error listed. Output raw JSON only.
```

### Step 8 — LLM Router with repair loop (`src/llm/router.ts`)

```
async function generateWithRepair(prompt, examples):
  providers = [geminiProvider, openRouterProvider]
  for provider of providers:
    try:
      spec = await provider.generateStructured(buildSystemPrompt(examples), prompt, schema, 0.3)
      result = validate(spec)
      if result.valid: return { spec, provider.name }
      
      for attempt in [1, 2]:  // repair loop
        spec = await provider.generateStructured(repairPrompt(prompt, spec, result.errors))
        result = validate(spec)
        if result.valid: return { spec, provider.name, warnings: result.warnings }
      
      // exhausted retries on this provider, try fallback
    catch RetryableError:
      continue  // try next provider
  
  throw new Error('PROVIDER_UNAVAILABLE')
```

### Step 9 — Validator (`src/validation/validator.ts`)

4 layers, run in sequence. Stop at first layer failure (return errors immediately).

1. **Structural** — `EnvironmentSpecSchema.safeParse(spec)`
2. **Referential** — all `objects[].type` in `KNOWN_TYPES`; all `objects[].id` unique
3. **Geometric** — for each object: `position[0] >= -dims.width/2 && <= dims.width/2` (X), same for Z with length, Y >= 0; all scale values > 0
4. **Overlap** — AABB check for static objects: for each pair, check if `|x1-x2| < (fw1+fw2)/2 && |z1-z2| < (fd1+fd2)/2`. Flag as warning (not error) on overlap.

Return format:
```ts
interface ValidationResult {
  valid: boolean;
  errors: { path: string; code: string; message: string }[];
  warnings: { path: string; code: string; message: string }[];
}
```

### Step 10 — MongoDB setup (`src/db/`)

`client.ts`: connect once from `process.env.MONGODB_URI`. Export client and db ref.

`collections.ts`: on app startup, run `db.createCollection("environment_versions", { validator: { $jsonSchema: ... }, validationLevel: "strict", validationAction: "error" })` — catch `already exists` errors. Create indexes:
- `environment_versions`: `{ environmentId: 1, version: -1 }` unique
- `environments`: `{ ownerId: 1, updatedAt: -1 }`

If MongoDB is unreachable, log and continue — the endpoint degrades to returning the spec without saving.

### Step 11 — Cache (`src/cache.ts`)

```ts
const cache = new Map<string, { spec: EnvironmentSpec; ts: number }>();
const TTL_MS = 60 * 60 * 1000;

export function getCached(key: string): EnvironmentSpec | null { ... }
export function setCached(key: string, spec: EnvironmentSpec): void { ... }
// cache key = sha256(prompt + version of catalogue)
```

Use Node's built-in `crypto.createHash('sha256')`.

### Step 12 — Generate route (`src/routes/environments.ts`)

```
POST /api/v1/environments/generate

1. rateLimiter middleware
2. authMiddleware (stub)
3. parse + validate body (prompt required, string, 10–500 chars)
4. cacheKey = sha256(prompt)
5. if cache hit: return { spec, cached: true }
6. embed prompt via Gemini embedding API
7. $vectorSearch environment_versions for top-3 similar (fallback to [] if MongoDB unavailable)
8. call generateWithRepair(prompt, examples)
9. insert environment_versions doc, upsert environments head
10. setCached(cacheKey, spec)
11. return 200 { environmentId, versionId, spec, provider, warnings }
```

On any unhandled error: return `{ error: { code: "PROVIDER_UNAVAILABLE", message: "..." } }`.

### Step 13 — Pre-generated demo scenes

Write 4 valid JSON files in `demo-scenes/`. Each must pass the Zod validator. Use them as:
- Fallback few-shot examples when MongoDB has no similar specs
- Offline demo backup (serve from a `/demo/:name` endpoint)
- Seed data for MongoDB on startup

---

## Environment variables (`.env.example`)

```
MONGODB_URI=mongodb+srv://...
GEMINI_API_KEY=
OPENROUTER_API_KEY=
JWT_SECRET=changeme
PORT=3001
LLM_CACHE_TTL_SECONDS=3600
```

---

## Interfaces shared with other persons

**Person 2 (frontend)** needs:
- `POST /api/v1/environments/generate` working and CORS-enabled
- The `EnvironmentSpec` JSON shape (section above) — share `schema.ts` or at minimum the JSON Schema export
- Use the hardcoded warehouse `demo-scenes/warehouse.json` as the sample spec until the API is live

**Person 3 (data/validation)** owns:
- The canonical Zod schema (you write a draft in step 2; they refine it)
- MongoDB `environment_versions` collection creation
- Save / list / revert / history endpoints

Coordinate: agree on `schema.ts` exports within the first 20 minutes.

---

## Done criteria

- [ ] `curl -X POST localhost:3001/api/v1/environments/generate -H 'Content-Type: application/json' -d '{"prompt":"warehouse 30x40m with 3 shelf aisles"}'` returns a valid spec JSON
- [ ] The spec passes `EnvironmentSpecSchema.safeParse()` without errors
- [ ] Out-of-bounds objects trigger the repair loop (visible in logs)
- [ ] Gemini 429 falls through to OpenRouter and still returns a spec
- [ ] Same prompt twice returns the cached result (no second LLM call in logs)
- [ ] Spec saved to MongoDB and retrievable by `environmentId`
