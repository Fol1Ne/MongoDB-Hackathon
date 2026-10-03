# Environments API (data + validation layer)

Base URL: `/api/v1` · JSON in/out · no auth yet. Frontend never needs MongoDB internals: all ids are 24-char hex strings, dates are ISO strings.

## Errors
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Spec invalid",
  "details": [ { "path": "objects[3].position", "code": "OUT_OF_BOUNDS", "message": "x extent [...] exceeds width 50 (allowed ±25)" } ],
  "warnings": [] } }
```
| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_FAILED` | spec fails schema/semantic validation (`details` = errors). **Nothing is written.** |
| 400 | `BAD_REQUEST` | malformed body/query/id |
| 404 | `NOT_FOUND` | unknown environment/version/route |
| 409 | `VERSION_CONFLICT` | `baseVersion` is stale, or concurrent write |
| 409 | `ALREADY_AT_VERSION` | revert target is already the head |
| 503 | `SEARCH_UNAVAILABLE` | vector search isn't available (local DB, index still building, embedding rate limit) |

Validation codes: `SCHEMA_INVALID UNKNOWN_ASSET_TYPE DUPLICATE_OBJECT_ID DUPLICATE_WAYPOINT_ID OUT_OF_BOUNDS OVERLAP INVALID_SCALE INVALID_DIMENSIONS INVALID_FRICTION INVALID_RESTITUTION INVALID_MASS` (+ warning-only `WAYPOINT_IN_OBSTACLE`, `SUSPICIOUS_ROTATION` (an angle beyond ±2π, i.e. probably degrees), and `OVERLAP` when an object is dynamic).

Ids (objects and waypoints) match `^[A-Za-z_][A-Za-z0-9_]{0,63}$`: they become USD prim names, so `-`, `.` and a leading digit are rejected.

Geometry conventions: origin at environment centre on the ground; X ∈ [-width/2, width/2], Z ∈ [-length/2, length/2], Y ∈ [0, height]. `position` = centre of the footprint (y = base). Footprint = catalogue `[X, Z]` × `scale[0]`, `scale[2]` (yaw-expanded AABB). Objects without `physics` count as static. Static–static footprint overlap (with overlapping vertical span, so stacking is allowed) is an **error**.

## POST /environments — create (version 1)
Body: `{ "spec": <EnvironmentSpec>, "changeNote"?: string, "tags"?: string[], "ownerId"?: hex, "projectId"?: hex }`
→ **201** `{ environment, version, warnings }`
```json
{ "environment": { "id": "66f...", "name": "Warehouse Environment", "type": "warehouse", "headVersionId": "66f...", "versionCount": 1,
    "tags": ["warehouse"], "projectId": null, "ownerId": null, "createdAt": "2026-10-03T12:00:00.000Z", "updatedAt": "2026-10-03T12:00:00.000Z" },
  "version": { "id": "66f...", "environmentId": "66f...", "version": 1, "parentVersionId": null, "schemaVersion": "1.0.0",
    "summaryText": "Warehouse Environment: warehouse 50x80x12m, concrete floor, 2 objects (2 industrial_shelf)",
    "changeNote": null, "revertedFromVersion": null, "createdAt": "...", "spec": { "...": "EnvironmentSpec" } },
  "warnings": [] }
```

## GET /environments — list (newest first)
Query: `limit` (1-500, default 100), `offset`, `type`, `tag`, `ownerId`, `projectId`
→ `{ "items": [ environment ], "total": 12, "limit": 100, "offset": 0 }`

## GET /environments/:id — head
→ `{ environment, version }` (version includes `spec`)

## PUT /environments/:id — save edit (creates next immutable version)
Body: `{ "spec": <EnvironmentSpec>, "changeNote"?: string, "baseVersion"?: number }`
Send `baseVersion` = the version the user was editing to get a 409 instead of silently overwriting a newer save.
→ **200** `{ environment, version, warnings }` · invalid → **400 VALIDATION_FAILED**, no version created.

## GET /environments/:id/versions — history (no `spec` bodies)
Query: `order=asc|desc` (default `asc`: v1, v2, …), `limit`, `offset`
→ `{ "items": [ { "id", "environmentId", "version", "parentVersionId", "schemaVersion", "summaryText", "changeNote", "revertedFromVersion", "createdAt" } ], "limit", "offset", "order" }`

## GET /environments/:id/versions/:version — one full version
→ `{ "version": { ...meta, "spec": {...} } }`

## POST /environments/:id/revert
Body: `{ "toVersion": 1, "changeNote"?: string, "baseVersion"?: number }`
Creates a NEW version (copy of `toVersion`'s spec, `parentVersionId` = current head, `revertedFromVersion` = `toVersion`). History is never deleted. → **201** `{ environment, version, warnings }`

## GET /environments/similar: find similar environments (Atlas Vector Search)
Query: `text` (3–500 chars) **or** `environmentId`, plus optional `type` and `limit` (1–20, default 5).
- With `environmentId`, the query is that environment's head summary, and the environment itself is excluded.

→ `{ "items": [ { "environmentId", "versionId", "version", "name", "type", "summaryText", "score" } ] }`
- Each item is the **current head** of a matching environment, highest score first. Older versions never appear.
- Hits carry no `spec`; fetch it with `GET /environments/:id`.

Atlas embeds `summaryText` and the query text itself (Automated Embedding), so there are no vectors or embedding keys in the app.
- **Setup:** run `npm run db:vector` once (see `infra/mongo/README.md`).
- **503 `SEARCH_UNAVAILABLE`** is returned when search isn't available. `details[0].reason` says why:
  - a local mongod without Atlas Search;
  - the index is missing or still building;
  - Atlas's embedding rate limit.
  Saves are unaffected. Any other database error is a 500.
- **LLM few-shot examples:** use this endpoint, or `repo.similar()`, rather than embedding with another provider and adding a second index. M0 allows 3 search indexes, and every query counts toward M0's limit of 3 query embeddings per minute when the Atlas organization has no payment method.

## Helpers
- `POST /environments/validate` body `{ "spec": ... }` → `{ valid, errors[], warnings[] }`. Writes nothing; use for live editor feedback and the LLM repair loop.
- `GET /assets/catalogue` → `{ "assets": [ { type, name, footprint, height, collision, tags, usdAsset } ] }`

## For teammates
- LLM/generation code: call `validateAndParse(raw)` from `@twin/validator` (or `/validate`), then `POST /environments`. Never write to Mongo directly.
- **Structured output:** pass `toLlmJsonSchema({ objectTypes: ASSET_TYPES })` from `@twin/schema` as Gemini's `responseJsonSchema`, using `@google/genai` with `responseMimeType: "application/json"`.
  - It omits `provenance`; set that on the server.
  - Don't pass `zod-to-json-schema` output directly. It turns the `[x, y, z]` tuples into array-form `items`, which Gemini doesn't handle reliably.
  - Use a current model. `gemini-1.5-flash` and the `@google/generative-ai` SDK are retired; as of Oct 2026 the free tier gets about 500 requests/day on `gemini-3.5-flash-lite`.
- Viewer: `GET /environments/:id` → `version.spec`.
- Catalogue for prompts: `ASSET_CATALOGUE` from `@twin/catalogue`.
- Demo scenes: `apps/api/demo-scenes/{warehouse,factory,office,outdoor}.json` are valid specs, with zero errors and zero warnings.
  - Use them as few-shot examples, as an offline demo fallback, or as viewer test data.
  - `npm run db:seed` loads them into MongoDB.
