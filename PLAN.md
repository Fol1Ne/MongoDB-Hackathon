# AI-Powered 3D Environment Platform for Robotics: Technical Documentation

Version 0.1 (hackathon draft) Status: Design document

---

## Table of contents

1. [Overview](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#1-overview)
2. [Goals, non-goals and hackathon scope](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#2-goals-non-goals-and-hackathon-scope)
3. [System architecture](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#3-system-architecture)
4. [Technology stack](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#4-technology-stack)
5. [End-to-end workflows](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#5-end-to-end-workflows)
6. [EnvironmentSpec: the central data structure](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#6-environmentspec-the-central-data-structure)
7. [Validation engine](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#7-validation-engine)
8. [Deterministic scene compiler](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#8-deterministic-scene-compiler)
9. [LLM layer](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#9-llm-layer)
10. [Image-to-environment pipeline](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#10-image-to-environment-pipeline)
11. [MongoDB data layer](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#11-mongodb-data-layer)
12. [Memory and retrieval (RAG)](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#12-memory-and-retrieval-rag)
13. [Backend API](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#13-backend-api)
14. [Frontend](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#14-frontend)
15. [Robotics integration and simulation](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#15-robotics-integration-and-simulation)
16. [Metrics and evaluation](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#16-metrics-and-evaluation)
17. [Security, privacy and cost control](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#17-security-privacy-and-cost-control)
18. [Testing strategy](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#18-testing-strategy)
19. [Deployment](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#19-deployment)
20. [Hackathon build plan](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#20-hackathon-build-plan)
21. [Roadmap](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#21-roadmap)
22. [Risks and mitigations](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#22-risks-and-mitigations)
23. [Appendix](https://claude.ai/chat/5d852ae6-cd0b-42a7-83a0-54abd5d5942c#23-appendix)

---

## 1. Overview

### 1.1 Summary

An AI-powered platform that transforms text descriptions and real-world photographs into editable, robotics-ready 3D digital twins. Users can design or add robots, configure sensors, simulate and test behaviour in realistic environments, and prepare robots for real-world deployment.

### 1.2 Core idea

The system does not simply generate 3D models. It creates structured, physically meaningful environments that robots can operate in and be tested against.

The key architectural decision is a strict separation of responsibilities:

|Concern|Owner|
|---|---|
|Interpreting user intent and images|LLM (Gemini or fallback provider)|
|Describing the environment|Structured JSON (`EnvironmentSpec`)|
|Guaranteeing correctness|Validation engine|
|Producing the 3D scene|Deterministic scene compiler|
|Physics and robot behaviour|Isaac Sim (PhysX), ROS 2, Nav2|
|Persistence, history, memory|MongoDB|

The LLM proposes; deterministic code disposes. Generated environments therefore stay consistent, reproducible and editable, because the LLM never writes 3D geometry directly.

### 1.3 Target use cases

- Warehouse and logistics robotics (AMRs, forklifts, pick-and-place)
- Factory floors and assembly lines
- Indoor navigation testing (offices, hospitals, retail)
- Outdoor terrain testing (uneven ground, slopes, surface friction)
- Rapid scenario generation for regression testing

---

## 2. Goals, non-goals and hackathon scope

### 2.1 Goals

- Generate a valid environment from a text prompt in under 30 seconds.
- Produce an environment from one or more photographs (approximate geometry, editable by the user).
- Let users edit any generated environment (move, add, remove objects; change terrain).
- Store every environment version immutably, with undo and history.
- Export to OpenUSD for use in Isaac Sim.
- Run simulations and record metrics.

### 2.2 Non-goals (initial version)

- Photorealistic reconstruction of exact real-world geometry from a single photo.
- Hosting a hosted GPU simulation farm.
- Real robot deployment tooling (roadmap only).

### 2.3 Hackathon scope

|Priority|Feature|In demo?|
|---|---|---|
|P0|Text prompt to validated EnvironmentSpec|Yes|
|P0|MongoDB persistence and version history|Yes|
|P0|Three.js viewer that renders a spec|Yes|
|P1|Editing objects in the viewer and saving a new version|Yes|
|P1|Photo upload to approximate spec|Yes (approximate)|
|P1|Vector search: "find similar environments"|Yes (final feature)|
|P2|OpenUSD export|Stretch|
|P2|Isaac Sim run with metrics|Pre-recorded or roadmap slide|
|P3|ROS 2 / Nav2 live integration|Roadmap|

---

## 3. System architecture

### 3.1 Layered view

```
+--------------------------------------------------------------+
| CLIENT                                                       |
|  Prompt input | Photo upload | 3D editor (Three.js)          |
+------------------------------+-------------------------------+
                               |
+------------------------------v-------------------------------+
| BUSINESS LOGIC (Node.js / TypeScript API)                    |
|  Auth | Validator (Zod) | Scene compiler | Job queue         |
+------------------------------+-------------------------------+
                               |
+------------------------------v-------------------------------+
| AI LAYER (LLM router)                                        |
|  Gemini Flash (primary) | Qwen vision via Cloudflare         |
|  OpenRouter free models | Ollama (local dev)                 |
+------------------------------+-------------------------------+
                               |
+------------------------------v-------------------------------+
| DATA LAYER                                                   |
|  MongoDB Atlas (specs, versions, runs, vectors)              |
|  Object storage (USD files, photos, logs)                    |
+------------------------------+-------------------------------+
                               |
+------------------------------v-------------------------------+
| SIMULATION AND TESTING                                       |
|  Isaac Sim (PhysX + OpenUSD) | ROS 2 + Nav2 | Metrics        |
+--------------------------------------------------------------+
```

### 3.2 Full pipeline

```
USER INPUT
   |-- Text prompt
   '-- Real-world images
         |
         v
   LLM (interpretation)
         |
         v
   ENVIRONMENT SPEC (JSON)
         |
         v
   VALIDATION ENGINE  --(invalid)--> repair loop (re-prompt LLM, max N)
         |
         v
   MONGODB (versioned save)
         |
         v
   DETERMINISTIC SCENE COMPILER
         |
         v
   OpenUSD  --> object storage
         |
         v
   NVIDIA ISAAC SIM (PhysX)
         |
         v
   ROBOT INTEGRATION (URDF / USD)
         |
         v
   ROS 2 / NAV2
         |
         v
   SIMULATION AND TESTING
         |
         v
   PERFORMANCE METRICS --> MongoDB
         |
         v
   REAL-WORLD DEPLOYMENT
```

### 3.3 Component responsibilities

|Component|Responsibility|Must not|
|---|---|---|
|Client|Collect input, render and edit scenes|Call LLM providers directly|
|API|Auth, orchestration, validation, persistence|Trust raw LLM output|
|LLM router|Provider selection, retries, fallback, rate limiting|Hold business rules|
|Validator|Schema and semantic checks|Modify data silently|
|Compiler|Spec to scene graph / USD, pure function|Call the network or LLM|
|MongoDB|Source of truth for structured data|Store large binaries|
|Object storage|Binary assets|Be the source of truth for specs|
|Simulation worker|Run scenes, emit metrics|Mutate specs|

---

## 4. Technology stack

|Layer|Technology|Notes|
|---|---|---|
|Frontend|React, TypeScript, Vite|SPA|
|3D viewer/editor|Three.js via React Three Fiber, drei|Transform controls for editing|
|Backend API|Node.js, TypeScript, Fastify or Express|Alternative: Python FastAPI|
|Validation|Zod (runtime) and JSON Schema (shared with MongoDB)|Single source of truth generated from Zod|
|Job queue|Redis with BullMQ|For LLM calls, compilation, simulation jobs|
|LLM (primary)|Gemini Flash via Gemini API|Free tier, vision, JSON output|
|LLM (fallback)|Qwen vision on Cloudflare Workers AI, OpenRouter free models|Vision-capable fallback|
|LLM (local dev)|Ollama|Offline, unlimited|
|Structured output|Gemini `responseSchema`, Instructor / Zod|Enforce schema across providers|
|Database|MongoDB Atlas|Documents, time-series, vector search|
|Object storage|S3 / Cloudflare R2 / GridFS|USD, meshes, images, logs|
|Scene format|OpenUSD (`usd-core` Python package)|Compiler output|
|Simulator|NVIDIA Isaac Sim (PhysX)|Requires RTX GPU|
|Robot description|URDF and USD|URDF importer in Isaac Sim|
|Middleware|ROS 2|Sensor and command topics|
|Navigation|Nav2|Path planning, costmaps|
|Depth/vision (optional)|Depth Anything or similar monocular depth model|Image-to-geometry|
|Auth|JWT sessions (Clerk, Auth0 or self-hosted)||
|Hosting|Vercel/Netlify (client), Render/Fly/Railway (API), Atlas (DB)||

Note: free-tier LLM offerings change frequently. The abstraction in section 9 exists so providers can be swapped without touching the pipeline.

---

## 5. End-to-end workflows

### 5.1 Text to environment

1. User enters a prompt, for example "A 50 by 80 metre warehouse with six shelf aisles and a loading dock."
2. API creates a `generation_job` and enqueues it.
3. Retrieval step (optional, see section 12): find similar validated specs in MongoDB to use as examples.
4. LLM router calls the primary provider with the system prompt, schema, and examples.
5. Response is parsed as JSON.
6. Validator checks schema and semantics. On failure, the repair loop re-prompts with the error list (maximum 2 retries).
7. Valid spec is saved as version 1 in MongoDB with an embedding.
8. Client receives the spec and renders it in Three.js.
9. User edits; each save creates a new immutable version.
10. On demand, the compiler produces OpenUSD and stores it in object storage.

### 5.2 Image to environment

See section 10 for the detailed pipeline. In summary: upload, visual analysis, geometry estimation, spec generation, validation, and user correction.

### 5.3 Simulation run

1. User selects an environment version and a robot configuration.
2. API creates a `simulation_run` (status `queued`) and enqueues a job.
3. Worker fetches the compiled USD (compiling first if absent), launches Isaac Sim headless, loads robot and sensors.
4. ROS 2 / Nav2 scenario runs (for example navigate between waypoints).
5. Worker streams metrics into the time-series collection and marks the run `completed` or `failed`.
6. Client shows results and comparisons between runs.

---

## 6. EnvironmentSpec: the central data structure

The `EnvironmentSpec` is the contract between every component. The LLM produces it, the validator checks it, MongoDB stores it, the compiler consumes it, and the editor manipulates it.

### 6.1 Conventions

- Units: metres, radians, kilograms, seconds.
- Coordinate system: right-handed, Y up (USD default). Origin at the environment centre on the ground plane.
- Rotations: Euler XYZ in radians (quaternions may be added in v2).
- Every object has a stable string `id` unique within the spec.
- Every spec carries `schemaVersion`.

### 6.2 Example

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
    "prompt": "A 50 by 80 metre warehouse...",
    "model": "gemini-flash",
    "generatedAt": "2026-09-29T14:20:00Z",
    "confidence": null
  }
}
```

### 6.3 Field reference

|Field|Type|Required|Description|
|---|---|---|---|
|`schemaVersion`|string (semver)|yes|For migrations|
|`environment.name`|string|yes|Display name|
|`environment.type`|enum|yes|`warehouse`, `factory`, `office`, `outdoor`, `custom`|
|`environment.dimensions`|object|yes|width (X), length (Z), height (Y), all greater than 0|
|`terrain.type`|enum|yes|`concrete`, `asphalt`, `grass`, `gravel`, `tile`, `dirt`, `custom`|
|`terrain.properties.friction`|number 0..2|yes|Static/dynamic friction coefficient|
|`terrain.heightmap`|object or null|no|Reference to a heightmap asset for uneven terrain|
|`objects[]`|array|yes|Placed objects|
|`objects[].id`|string|yes|Unique|
|`objects[].type`|string|yes|Must exist in the asset catalogue|
|`objects[].position`|[x, y, z]|yes|Metres|
|`objects[].rotation`|[rx, ry, rz]|yes|Radians|
|`objects[].scale`|[sx, sy, sz]|yes|Positive|
|`objects[].physics`|object|no|`static`, `mass`, collision shape override|
|`lighting`|object|no|Preset and intensity|
|`navigation.waypoints[]`|array|no|Named positions for test routes|
|`robotics.simulation_enabled`|boolean|yes||
|`provenance`|object|yes|Where the spec came from|

### 6.4 Asset catalogue

The LLM may only reference object types that exist in the catalogue, which is a fixed list of known assets with dimensions, collision shapes, and USD file references. This prevents hallucinated object types and makes the compiler deterministic.

```json
{
  "type": "industrial_shelf",
  "usdAsset": "assets/shelf_industrial_v2.usd",
  "footprint": [1.2, 0.6],
  "height": 2.4,
  "collision": "box",
  "tags": ["storage"]
}
```

The catalogue is stored in MongoDB (`assets` collection) and injected into the LLM prompt as an enumerated list.

### 6.5 Schema versioning

- Semantic version in `schemaVersion`.
- Migration functions `migrate_1_0_to_1_1(spec)` live in code and run on read when `schemaVersion` is older than current.
- Never mutate stored versions in place; write a migrated copy.

---

## 7. Validation engine

Validation runs after every LLM response and after every user edit.

### 7.1 Layers

1. Structural: JSON parses, matches the Zod / JSON Schema (types, required fields, enums, ranges).
2. Referential: every object `type` exists in the catalogue; IDs unique; waypoint IDs unique.
3. Geometric:
    - Objects lie within environment bounds.
    - No overlapping collision footprints for static objects (axis-aligned check for v1).
    - Scale values are positive and within limits.
4. Physical: friction, mass and restitution in plausible ranges.
5. Navigability (optional): a path exists between waypoints on a coarse occupancy grid.

### 7.2 Result format

```json
{
  "valid": false,
  "errors": [
    { "path": "objects[3].position", "code": "OUT_OF_BOUNDS", "message": "x=62 exceeds width 50" }
  ],
  "warnings": [
    { "path": "objects[7]", "code": "OVERLAP", "message": "Overlaps shelf_002" }
  ]
}
```

### 7.3 Repair loop

- On errors, send the LLM the original request, the invalid spec, and the error list, asking for a corrected spec only.
- Maximum 2 repair attempts, then return the errors to the user.
- Auto-fixable issues (for example clamping to bounds) may be fixed deterministically and reported as warnings rather than silently changed.

### 7.4 Single source of truth for schemas

Define the schema once in Zod, then generate JSON Schema from it (`zod-to-json-schema`). Use the same JSON Schema for:

- Gemini `responseSchema` (structured output)
- MongoDB `$jsonSchema` collection validator
- API request validation
- Documentation

---

## 8. Deterministic scene compiler

### 8.1 Contract

A pure function: `compile(spec, catalogue, compilerVersion) -> SceneArtifacts`. Same input always yields the same output (byte-identical USD where possible). No network calls, no randomness, no LLM.

### 8.2 Outputs

|Output|Purpose|
|---|---|
|Scene graph JSON|Consumed by the Three.js viewer|
|OpenUSD stage (`.usda` or `.usdc`)|Consumed by Isaac Sim|
|Compile report|Warnings, object counts, hash of inputs|

### 8.3 USD structure

```
/World
  /Environment          (Xform, bounds and metadata)
    /Ground             (Mesh, PhysicsCollisionAPI, physics material with friction)
    /Lighting           (DomeLight, DistantLight)
  /Objects
    /shelf_001          (Xform with reference to catalogue asset, transform from spec)
    /shelf_002
  /Waypoints
    /wp_start
```

### 8.4 Compile steps

1. Create stage, set `metersPerUnit = 1`, up axis Y.
2. Build ground plane sized from `dimensions`, apply the physics material from `terrain.properties`.
3. For each object, add a USD reference to the catalogue asset, set translate, rotate, scale from the spec, and apply `UsdPhysics.CollisionAPI` (and `RigidBodyAPI` if not static).
4. Add lighting preset.
5. Add waypoint markers as empty Xforms with custom attributes.
6. Save, compute checksum, store in object storage, write an `assets` record referencing the spec version and compiler version.

### 8.5 Caching

Cache key: `sha256(specVersionId + compilerVersion)`. If an asset with this key exists, skip compilation.

### 8.6 Preview versus simulation fidelity

- The Three.js viewer uses low-poly proxies for speed.
- Isaac Sim uses full USD assets and PhysX collision shapes.
- Both derive from the same spec, so the preview matches layout and scale.

---

## 9. LLM layer

### 9.1 Provider abstraction

All LLM calls go through one interface so providers can be swapped or chained.

```ts
interface LLMProvider {
  name: string;
  supportsVision: boolean;
  generateStructured<T>(req: {
    system: string;
    prompt: string;
    images?: { mimeType: string; data: Buffer }[];
    jsonSchema: object;
    temperature?: number;
  }): Promise<{ data: T; usage?: TokenUsage; raw: string }>;
}
```

### 9.2 Router behaviour

|Behaviour|Detail|
|---|---|
|Priority order|Gemini Flash, then Qwen vision (Cloudflare), then OpenRouter free model, then Ollama|
|Capability filtering|Skip providers without vision when images are present|
|Fallback triggers|HTTP 429, 5xx, timeout, invalid JSON after repair|
|Rate limiting|Token bucket per provider matching the free-tier limits|
|Caching|Cache by hash of (prompt, images, schema, model) for repeated demos|
|Observability|Log provider, latency, tokens, validation outcome per call|

### 9.3 Free-tier considerations

- Free tiers have low per-minute and per-day limits and can change without notice.
- Cache aggressively, queue LLM work, and back off on 429.
- Pre-generate a handful of demo environments and store them so a live demo never depends on provider availability.
- Keep an Ollama model available locally as a last resort.

### 9.4 Prompt design (text to spec)

System prompt outline:

1. Role: "You convert descriptions into EnvironmentSpec JSON for robot simulation."
2. Rules: metres, Y-up, positions inside bounds, only use listed object types, no overlapping objects, output JSON only.
3. Schema: attached via `responseSchema` where supported, and also described in the prompt.
4. Catalogue: enumerated list of allowed `type` values with footprints.
5. Examples: 1 to 3 retrieved similar specs (few-shot), or built-in defaults.
6. User request.

Settings: low temperature (0.2 to 0.4) for consistency.

### 9.5 Prompt design (image to spec)

Two-step approach recommended:

1. Analysis call (vision): extract a structured scene description (room type, approximate dimensions, list of objects with rough positions and confidence, surface materials, reference-scale objects such as doors).
2. Spec call (text): convert the analysis plus any geometric estimates into an `EnvironmentSpec`.

Splitting the steps makes failures easier to debug and lets you inject geometric measurements from computer-vision tools between them.

### 9.6 Safety and robustness

- Treat LLM output as untrusted input: parse, validate, and never execute it.
- Ignore any instructions found inside uploaded images or user-provided text that attempt to change system behaviour.
- Cap object counts (for example 500) and dimensions to prevent runaway generation.

---

## 10. Image-to-environment pipeline

### 10.1 Important limitation

A vision-language model can interpret the contents of a photograph (objects, surfaces, layout). It cannot reliably recover exact 3D geometry from one image: scale is ambiguous, hidden surfaces are unknown. Accurate reconstruction needs extra techniques and the product should present results as approximate and editable.

### 10.2 Stages

|Stage|Description|Tools|
|---|---|---|
|1. Ingestion|Upload one or more images, strip EXIF location data, store originals|Object storage|
|2. Visual analysis|Identify objects, surfaces, structure, relationships|LLM vision|
|3. Geometry estimation|Depth map, floor plane, wall detection, scale from reference objects|Monocular depth model, plane fitting|
|4. JSON generation|Combine analysis and geometry into an `EnvironmentSpec`|LLM (text)|
|5. Validation|Same validator as text flow|Validator|
|6. Compilation and render|Compile and show in viewer|Compiler, Three.js|
|7. Correction|User adjusts scale, positions, objects|Editor|

### 10.3 Improving accuracy

- Ask the user for one known dimension (for example door height or room width) to fix scale.
- Support multiple photos of the same space and merge detections.
- Optional: photogrammetry or Gaussian splatting for true reconstruction, with the LLM used only for labelling and semantic structure.
- Store per-object `confidence` values and highlight low-confidence items in the editor.

### 10.4 Output of the analysis step (intermediate format)

```json
{
  "roomType": "warehouse",
  "estimatedDimensions": { "width": 40, "length": 60, "height": 9, "confidence": 0.4 },
  "referenceObjects": [{ "type": "door", "heightMeters": 2.1 }],
  "surfaces": [{ "kind": "floor", "material": "concrete" }],
  "objects": [
    { "label": "shelf", "count": 12, "roughPosition": "left wall, evenly spaced", "confidence": 0.7 }
  ]
}
```

---

## 11. MongoDB data layer

### 11.1 Why MongoDB

- `EnvironmentSpec` is a nested, evolving JSON document; MongoDB stores it natively without table flattening or an ORM.
- Flexible schema with optional validation supports schema evolution.
- BSON adds useful types (dates, ObjectId, binary, decimals).
- One platform covers documents, time-series metrics, and vector search (Atlas).

### 11.2 What goes where

|Data|Store|
|---|---|
|Specs, versions, robot configs, runs, users, projects|MongoDB collections|
|Metrics and telemetry|MongoDB time-series collection|
|Embeddings|Vector field in MongoDB (Atlas Vector Search)|
|USD files, meshes, textures, photos, logs|Object storage or GridFS, with URI and hash in MongoDB|

MongoDB documents are limited to 16 MB, so large binaries stay out of documents.

### 11.3 Collections

|Collection|Purpose|
|---|---|
|`users`|Accounts and preferences|
|`projects`|Groups environments for a user or team|
|`environments`|Current head of each environment (pointer plus denormalised summary)|
|`environment_versions`|Immutable spec snapshots|
|`source_images`|Photo metadata, storage URL, LLM analysis output|
|`assets`|Catalogue objects and compiled USD artifacts|
|`robots`|Robot definitions (URDF/USD refs)|
|`sensor_configs`|Sensor setups attached to robots|
|`generation_jobs`|LLM job status, provider used, errors|
|`simulation_runs`|Run metadata linking environment version and robot|
|`run_metrics`|Time-series metrics (time-series collection)|

### 11.4 Document shapes

`environments`

```json
{
  "_id": "ObjectId",
  "projectId": "ObjectId",
  "ownerId": "ObjectId",
  "name": "Warehouse Environment",
  "type": "warehouse",
  "headVersionId": "ObjectId",
  "versionCount": 4,
  "tags": ["warehouse", "aisles"],
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

`environment_versions`

```json
{
  "_id": "ObjectId",
  "environmentId": "ObjectId",
  "version": 4,
  "parentVersionId": "ObjectId",
  "schemaVersion": "1.0.0",
  "spec": { "...EnvironmentSpec..." : true },
  "summaryText": "Warehouse 50x80m, 6 shelf aisles, loading dock",
  "embedding": [0.012, -0.034],
  "changeNote": "Added loading dock",
  "createdBy": "ObjectId",
  "createdAt": "ISODate"
}
```

`assets` (compiled artifact)

```json
{
  "_id": "ObjectId",
  "kind": "compiled_usd",
  "environmentVersionId": "ObjectId",
  "compilerVersion": "0.3.1",
  "uri": "s3://bucket/usd/abc123.usdc",
  "sha256": "abc123...",
  "sizeBytes": 4820211,
  "createdAt": "ISODate"
}
```

`simulation_runs`

```json
{
  "_id": "ObjectId",
  "environmentVersionId": "ObjectId",
  "robotId": "ObjectId",
  "sensorConfigId": "ObjectId",
  "scenario": { "type": "waypoint_navigation", "waypoints": ["wp_start", "wp_dock"] },
  "status": "queued | running | completed | failed",
  "startedAt": "ISODate",
  "finishedAt": "ISODate",
  "summary": { "success": true, "durationSec": 84.2, "collisions": 0, "pathLengthM": 61.3 },
  "logUri": "s3://bucket/logs/run_789.log"
}
```

`run_metrics` (time-series)

```js
db.createCollection("run_metrics", {
  timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" }
});
// document
{ ts: ISODate(), meta: { runId: ObjectId(), robotId: ObjectId() },
  speed: 0.82, x: 12.4, z: 3.1, minObstacleDist: 0.61, cpuLoad: 0.44 }
```

### 11.5 Versioning model

- Edits never overwrite `spec`. Each save inserts a new `environment_versions` document and updates `environments.headVersionId` (transaction or ordered writes).
- Undo means moving the head pointer back or creating a new version copying an older spec.
- For very large scenes (thousands of objects), split objects into a separate `environment_objects` collection keyed by `versionId`, or store diffs (JSON Patch) between versions.

### 11.6 Schema validation in MongoDB

Use `$jsonSchema` as a second safety net behind the application validator.

```js
db.createCollection("environment_versions", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["environmentId", "version", "schemaVersion", "spec", "createdAt"],
      properties: {
        version: { bsonType: "int", minimum: 1 },
        schemaVersion: { bsonType: "string" },
        spec: {
          bsonType: "object",
          required: ["environment", "terrain", "objects"],
          properties: {
            environment: {
              bsonType: "object",
              required: ["name", "type", "dimensions"],
              properties: {
                type: { enum: ["warehouse", "factory", "office", "outdoor", "custom"] }
              }
            },
            objects: { bsonType: "array", maxItems: 2000 }
          }
        }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});
```

### 11.7 Indexes

|Collection|Index|Purpose|
|---|---|---|
|`environments`|`{ ownerId: 1, updatedAt: -1 }`|List a user's environments|
|`environments`|`{ projectId: 1 }`|Project view|
|`environments`|`{ tags: 1 }`|Tag filter|
|`environment_versions`|`{ environmentId: 1, version: -1 }` unique|Fetch history and head|
|`simulation_runs`|`{ environmentVersionId: 1, startedAt: -1 }`|Runs per version|
|`simulation_runs`|`{ status: 1 }`|Worker polling|
|`assets`|`{ environmentVersionId: 1, compilerVersion: 1 }` unique|Compile cache lookup|
|`generation_jobs`|`{ status: 1, createdAt: 1 }`|Queue inspection|

Spatial queries over 3D object positions are usually done in application code; use a 2dsphere index only for real-world geo coordinates (for example site location).

### 11.8 Retention

- Keep all environment versions for active projects.
- TTL index on `generation_jobs` (for example 30 days).
- Time-series collection TTL via `expireAfterSeconds` if storage is a concern.

---

## 12. Memory and retrieval (RAG)

### 12.1 What "memory" means here

The core of the system is structured state, not conversational memory. Exact data (specs, versions, runs) is fetched by ID or filter, not by similarity. Vector retrieval is an add-on used where semantic matching helps.

### 12.2 Memory layers

|Layer|Content|Mechanism|
|---|---|---|
|Structured state|Specs, versions, robots, runs|Plain MongoDB queries|
|User preferences|Units, default robot, favourite asset packs|`users.preferences` document|
|Semantic memory|Similar environments, asset search|Atlas Vector Search|
|Knowledge base (optional)|Sensor, Nav2, Isaac Sim documentation|Chunk, embed, retrieve|
|Session context|Current conversation and edits|Application state, optionally persisted|

### 12.3 Where retrieval helps

1. Grounding generation with similar validated specs as few-shot examples.
2. Asset and object library search by meaning.
3. "Find similar environments" for templates and galleries.
4. Assistant answers about robotics configuration (documentation retrieval).

### 12.4 Embedding strategy

- Embed a short `summaryText` per environment version (type, dimensions, key objects, terrain, tags), not the raw JSON.
- Use one embedding model consistently (dimension must match the index, for example 768).
- Regenerate the embedding only when a version is saved.
- Embeddings can come from the Gemini embedding endpoint, an OpenRouter/Cloudflare embedding model, or a local model.

### 12.5 Atlas Vector Search index

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "spec.environment.type" }
  ]
}
```

### 12.6 Query

```js
db.environment_versions.aggregate([
  {
    $vectorSearch: {
      index: "env_vector_index",
      path: "embedding",
      queryVector: promptEmbedding,
      numCandidates: 100,
      limit: 3,
      filter: { "spec.environment.type": "warehouse" }
    }
  },
  { $project: { spec: 1, summaryText: 1, score: { $meta: "vectorSearchScore" } } }
]);
```

### 12.7 Retrieval-augmented generation flow

```
Prompt -> embed prompt -> $vectorSearch (filter by type)
       -> top-k similar specs -> few-shot examples in LLM prompt
       -> LLM -> validator -> save (with new embedding)
```

Retrieval only supplies examples; validation and compilation stay deterministic.

---

## 13. Backend API

### 13.1 Conventions

REST over HTTPS, JSON bodies, JWT bearer auth, `/api/v1` prefix. Long operations return a job ID; clients poll or subscribe via Server-Sent Events / WebSocket.

### 13.2 Endpoints

|Method|Path|Description|
|---|---|---|
|POST|`/auth/login`|Obtain a session|
|GET|`/projects`|List projects|
|POST|`/projects`|Create project|
|POST|`/environments/generate`|Body: `{ prompt, projectId }`, returns `{ jobId }`|
|POST|`/environments/from-images`|Multipart images and options, returns `{ jobId }`|
|GET|`/jobs/:id`|Job status and result reference|
|GET|`/environments`|List environments|
|GET|`/environments/:id`|Head version and metadata|
|GET|`/environments/:id/versions`|Version history|
|GET|`/environments/:id/versions/:n`|Specific version|
|PUT|`/environments/:id`|Save edited spec, creates new version|
|POST|`/environments/:id/revert`|Body: `{ toVersion }`|
|GET|`/environments/similar`|Query: `text` or `environmentId`, vector search|
|POST|`/environments/:id/compile`|Compile version to USD, returns asset|
|GET|`/assets/catalogue`|Object catalogue|
|POST|`/robots`|Create robot config|
|POST|`/simulations`|Body: `{ environmentVersionId, robotId, scenario }`|
|GET|`/simulations/:id`|Run status and summary|
|GET|`/simulations/:id/metrics`|Time-series metrics|
|GET|`/simulations/compare`|Compare runs|

### 13.3 Example: generate environment

Request

```http
POST /api/v1/environments/generate
Content-Type: application/json

{ "projectId": "66f...", "prompt": "Small warehouse 30x40m with three aisles" }
```

Response

```json
{ "jobId": "job_01H..." }
```

Job result

```json
{
  "status": "completed",
  "environmentId": "66f...",
  "versionId": "66f...",
  "provider": "gemini-flash",
  "warnings": []
}
```

### 13.4 Errors

Consistent error body:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Spec invalid", "details": [ ... ] } }
```

Codes include `VALIDATION_FAILED`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `NOT_FOUND`, `FORBIDDEN`, `COMPILE_FAILED`.

---

## 14. Frontend

### 14.1 Main screens

|Screen|Function|
|---|---|
|Dashboard|Projects, recent environments, templates|
|Create|Prompt box, photo upload, options (size, type)|
|Editor|3D viewport, object tree, inspector, version history|
|Robots|Robot library, sensor configuration|
|Simulate|Choose environment version and robot, run, watch progress|
|Results|Metrics charts, run comparison|

### 14.2 Editor features

- Orbit, pan and zoom camera.
- Select object; move, rotate, scale with transform gizmos.
- Snap to grid and to floor.
- Add object from catalogue (searchable, using vector search).
- Delete, duplicate, group.
- Live validation feedback (out-of-bounds and overlap highlighting).
- Save creates a version; undo/redo locally, history from the server.
- Confidence overlay for image-derived objects.

### 14.3 State management

- The spec is the single source of truth in client state (for example Zustand store).
- The 3D scene is a pure render of the spec; all edits are spec mutations.
- Diff view between versions using JSON diff.

---

## 15. Robotics integration and simulation

### 15.1 Robot definition

Robots are described by URDF (or USD) and stored as references in the `robots` collection.

```json
{
  "name": "AMR-01",
  "format": "urdf",
  "uri": "s3://bucket/robots/amr01.urdf",
  "footprint": { "radius": 0.35 },
  "limits": { "maxLinearSpeed": 1.5, "maxAngularSpeed": 2.0 }
}
```

### 15.2 Sensor configuration

```json
{
  "robotId": "ObjectId",
  "sensors": [
    { "type": "lidar_2d", "mount": [0, 0.3, 0.15], "range": 12, "fov": 270, "rateHz": 20 },
    { "type": "rgb_camera", "mount": [0.2, 0.5, 0], "resolution": [640, 480], "rateHz": 15 },
    { "type": "imu", "mount": [0, 0.1, 0], "rateHz": 100 }
  ]
}
```

### 15.3 Simulation stack

```
OpenUSD stage (from compiler)
   |
Isaac Sim (PhysX): loads stage, imports robot, attaches sensors
   |
ROS 2 bridge: publishes /scan, /camera, /imu, /odom; subscribes /cmd_vel
   |
Nav2: map, localisation, planner, controller
   |
Scenario runner: sends goals, monitors success and failure
   |
Metrics collector -> MongoDB (run_metrics, simulation_runs)
```

### 15.4 Scenario types

|Scenario|Description|Pass criteria|
|---|---|---|
|Waypoint navigation|Visit waypoints in order|Reaches all within time limit|
|Obstacle avoidance|Dynamic obstacles inserted|Zero collisions|
|Terrain traversal|Uneven or low-friction ground|No tip-over, slip below threshold|
|Sensor degradation|Noise or dropout applied|Success rate above threshold|
|Stress test|Many randomised environment variants|Aggregate success rate|

### 15.5 Simulation worker

- Runs on a GPU machine (RTX class) that pulls jobs from the queue.
- Launches Isaac Sim headless via its Python API, loads the USD, spawns robot, starts ROS 2 nodes, runs the scenario.
- Isaac Sim requires NVIDIA RTX hardware; for a hackathon, run it locally or record a demo instead of hosting it.

### 15.6 Environment variation (roadmap)

Programmatically vary a base spec (object positions, friction, lighting) to generate many test environments for robustness testing. This works well because specs are structured data.

---

## 16. Metrics and evaluation

### 16.1 Metrics collected

|Metric|Type|Notes|
|---|---|---|
|Success|boolean|Goal reached|
|Time to goal|seconds||
|Path length|metres|Compared to optimal|
|Collisions|count||
|Minimum obstacle distance|metres|Time-series|
|Average and peak speed|m/s||
|Localisation error|metres|If ground truth available|
|Planner replans|count||
|Compute load|percent|Optional|

### 16.2 Storage and use

- Continuous samples go in `run_metrics` (time-series).
- Aggregates go in `simulation_runs.summary`.
- Compare runs across robots, sensor configs, or environment versions with aggregation pipelines.

### 16.3 Readiness score (concept)

Combine success rate across scenario variants, collision rate, and sensor-degradation results into a single deployment-readiness score, shown with its breakdown so it is never a black box.

---

## 17. Security, privacy and cost control

|Area|Measure|
|---|---|
|Secrets|LLM and database credentials in environment variables or a secrets manager, never in the client|
|Auth|JWT with short expiry; per-user ownership checks on every query|
|Uploads|Validate MIME type and size, strip EXIF/GPS, virus-scan where possible|
|Prompt injection|Treat text and images as data; validate all model output; never execute model output|
|LLM cost/limits|Per-user quotas, request caps, queueing, response caching|
|Data privacy|Photos of real facilities may be sensitive; allow deletion, restrict sharing, disclose third-party LLM processing|
|MongoDB|Atlas IP allowlist, least-privilege DB users, TLS, backups|
|Object storage|Private buckets, signed URLs with short expiry|
|Abuse|Rate limiting per IP and per user|

---

## 18. Testing strategy

|Level|What|Tools|
|---|---|---|
|Unit|Validator rules, compiler transforms, migrations|Vitest / Jest|
|Golden tests|Fixed spec produces identical scene graph / USD checksum|Snapshot tests|
|Contract|Spec matches shared JSON Schema everywhere|Schema tests|
|LLM evals|Set of 30 to 50 prompts; measure valid-on-first-try rate, repair success, latency per provider|Custom eval script|
|Integration|API to MongoDB to compiler flow|Testcontainers or Atlas dev cluster|
|E2E|Prompt to viewer to edit to save|Playwright|
|Simulation smoke|One known scene, one robot, expected metrics range|Scripted on GPU host|

Key quality metric: percentage of prompts that yield a valid spec without repair.

---

## 19. Deployment

### 19.1 Environments

|Environment|Setup|
|---|---|
|Local|Docker Compose: API, Redis, MongoDB (or Atlas dev), Ollama|
|Hackathon demo|Client on Vercel/Netlify, API on Render/Fly/Railway, Atlas free tier, R2 or S3|
|Simulation|Separate GPU workstation or cloud GPU instance running the worker|

### 19.2 Configuration

```
MONGODB_URI=
GEMINI_API_KEY=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
OPENROUTER_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
REDIS_URL=
STORAGE_BUCKET=
JWT_SECRET=
LLM_PROVIDER_ORDER=gemini,cloudflare,openrouter,ollama
```

### 19.3 CI

Lint, type-check, unit tests, schema contract tests, build. Run LLM evals manually or nightly, not on every commit (rate limits).

---

## 20. Hackathon build plan

Assumes a 48-hour event and a small team. Adjust proportionally.

### Phase 0: Setup (hours 0 to 3)

- Repo, monorepo layout, Atlas cluster, API keys.
- Define the Zod schema and the asset catalogue (10 to 15 objects).

### Phase 1: Core loop (hours 3 to 16)

- API endpoint: prompt to Gemini to validated spec to MongoDB.
- Validator with structural, referential and bounds checks.
- Repair loop.
- Minimal Three.js viewer rendering boxes for objects on a ground plane.

Milestone: type a prompt, see a warehouse.

### Phase 2: Editing and history (hours 16 to 28)

- Transform gizmos, add/delete objects.
- Save creates versions; history list and revert.
- MongoDB `$jsonSchema` validator enabled.

Milestone: edit, save, undo across versions.

### Phase 3: Differentiators (hours 28 to 40)

- Photo upload with two-step vision analysis to approximate spec.
- Vector search for "find similar environments" and few-shot grounding.
- Provider fallback (Gemini to Cloudflare Qwen or OpenRouter).

### Phase 4: Simulation story (hours 40 to 44)

- OpenUSD export if time allows.
- Pre-record an Isaac Sim run of an exported scene, or prepare a roadmap slide.

### Phase 5: Polish and demo (hours 44 to 48)

- Pre-generate backup demo scenes and cache responses.
- Rehearse a 3-minute demo script.

### Demo script (3 minutes)

1. Problem: testing robots needs many realistic environments, and building them by hand is slow.
2. Type a prompt and show the generated warehouse.
3. Edit an object; show version history and undo (MongoDB versioning).
4. Upload a photo; show the approximate reconstruction and the confidence overlay.
5. Show "find similar environments" (vector search in the same database).
6. Show the validation engine rejecting a bad spec.
7. Show or describe the Isaac Sim / ROS 2 pipeline and metrics.
8. Close with the roadmap to deployment readiness scoring.

### Suggested team split

|Role|Focus|
|---|---|
|Backend and AI|LLM router, prompts, validator, MongoDB|
|Frontend and 3D|Three.js viewer and editor|
|Robotics / integration|Compiler, USD export, simulation demo|
|Product / demo|Pitch, demo script, test prompts, backups|

---

## 21. Roadmap

|Stage|Capabilities|
|---|---|
|v0.1 (hackathon)|Text to environment, editor, MongoDB versioning, similar-environment search|
|v0.2|OpenUSD export, Isaac Sim runs, basic metrics|
|v0.3|Robot and sensor configuration UI, Nav2 scenarios, run comparison|
|v0.4|Better image reconstruction (depth, multi-view), scale calibration|
|v0.5|Automated environment variation and robustness testing|
|v1.0|Deployment readiness scoring, team collaboration, hosted simulation|
|Later|Real-world digital twin sync, fleet-level simulation, sim-to-real gap analysis|

---

## 22. Risks and mitigations

|Risk|Impact|Mitigation|
|---|---|---|
|Free LLM tier limits or changes|Demo failure|Provider abstraction, caching, pre-generated scenes, local Ollama|
|Invalid or inconsistent LLM output|Broken scenes|Schema-constrained output, validator, repair loop, MongoDB validator|
|Inaccurate image reconstruction|User distrust|Present as approximate, confidence overlay, scale calibration, easy editing|
|Isaac Sim needs RTX GPU|Cannot demo live|Pre-recorded run, local demo, cloud GPU later|
|Scope too large for hackathon|Unfinished demo|Strict P0/P1 priorities, stub simulation|
|MongoDB 16 MB document limit|Large scenes fail to save|Split objects into a separate collection, keep binaries in object storage|
|Hallucinated object types|Compile failures|Enumerated catalogue in prompt and validation|
|Privacy of uploaded photos|Legal or trust issues|EXIF stripping, deletion, private storage, disclosure|

---

## 23. Appendix

### 23.1 Glossary

|Term|Meaning|
|---|---|
|EnvironmentSpec|Structured JSON description of an environment|
|OpenUSD|Universal Scene Description, a 3D scene format|
|Isaac Sim|NVIDIA robotics simulator built on Omniverse|
|PhysX|NVIDIA physics engine used by Isaac Sim|
|URDF|XML robot description format|
|ROS 2|Robot Operating System 2, robotics middleware|
|Nav2|ROS 2 navigation stack|
|BSON|Binary JSON, MongoDB's storage format|
|RAG|Retrieval-augmented generation|
|Digital twin|Virtual representation of a real place or system|

### 23.2 One-sentence project summary

An AI-powered platform that transforms text and real-world images into editable, robotics-ready 3D digital twins where users can design or add robots, simulate and test them in realistic environments, and prepare them for real-world deployment.

### 23.3 Suggested repository layout

```
/apps
  /web                 React + Three.js client
  /api                 Node.js API
  /sim-worker          Isaac Sim / ROS 2 job runner (Python)
/packages
  /schema              Zod schema, generated JSON Schema, migrations
  /validator           Validation engine
  /compiler            Spec to scene graph and OpenUSD
  /llm                 Provider interface, router, prompts
  /catalogue           Asset catalogue definitions
/infra
  docker-compose.yml
  mongo/               Validators, index scripts, vector index definitions
/docs
  technical-doc.md
/evals
  prompts.json         LLM evaluation set
```

### 23.4 Open questions

- Which embedding model and dimension will be used, and is it available on the free tier?
- Should rotations move to quaternions in schema v2?
- How much geometric reconstruction (depth models versus full photogrammetry) is realistic beyond the hackathon?
- What is the first real robot platform to target for sim-to-real validation?