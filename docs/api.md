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

Validation codes: `SCHEMA_INVALID UNKNOWN_ASSET_TYPE DUPLICATE_OBJECT_ID DUPLICATE_WAYPOINT_ID OUT_OF_BOUNDS OVERLAP INVALID_SCALE INVALID_DIMENSIONS INVALID_FRICTION INVALID_RESTITUTION INVALID_MASS` (+ warning-only `WAYPOINT_IN_OBSTACLE`, and `OVERLAP` when an object is dynamic).

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

## Helpers
- `POST /environments/validate` body `{ "spec": ... }` → `{ valid, errors[], warnings[] }`. Writes nothing; use for live editor feedback and the LLM repair loop.
- `GET /assets/catalogue` → `{ "assets": [ { type, name, footprint, height, collision, tags, usdAsset } ] }`

## For teammates
- LLM/generation code: call `validateAndParse(raw)` from `@twin/validator` (or `/validate`), then `POST /environments`. Never write to Mongo directly.
- Viewer: `GET /environments/:id` → `version.spec`.
- Catalogue for prompts: `ASSET_CATALOGUE` from `@twin/catalogue`.
- Demo scenes: `apps/api/demo-scenes/{warehouse,factory,office,outdoor}.json` are valid specs, with zero errors and zero warnings.
  - Use them as few-shot examples, as an offline demo fallback, or as viewer test data.
  - `npm run db:seed` loads them into MongoDB.
