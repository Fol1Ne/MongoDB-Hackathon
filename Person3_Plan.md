# Person 3 — Data & Validation Plan

**Project:** AI-Powered 3D Environment Platform for Robotics  
**Role:** Person 3 — Data, Validation & MongoDB  
**Status:** Hackathon implementation plan  
**Primary responsibility:** Make sure every `EnvironmentSpec` is structurally valid, semantically valid, persistable, versioned, and safely available to the rest of the team.

> **Core principle:** The LLM proposes; deterministic code disposes.
>
> My work provides the data contract and persistence layer that the LLM, frontend, compiler, and other components depend on.

---

## 1. Role Overview

My responsibility is the **data and validation layer** of the application.

I will build:

1. The shared `EnvironmentSpec` Zod schema.
2. The asset catalogue containing 10–15 known environment objects.
3. The deterministic validation engine.
4. MongoDB Atlas setup for environments and immutable environment versions.
5. MongoDB `$jsonSchema` validation as a second safety layer.
6. Environment save, list, history, version retrieval, and revert APIs.
7. Tests proving that valid specifications are accepted and invalid specifications are rejected.
8. Vector search for similar environments **only after the core functionality is complete and if time remains**.

The frontend, LLM layer, 3D compiler, and robotics/simulation components consume the contracts and APIs produced here.

---

## 2. Scope

### 2.1 In scope

| Area                    | Responsibility                                                      |
| ----------------------- | ------------------------------------------------------------------- |
| EnvironmentSpec         | Define and maintain the Zod schema                                  |
| JSON Schema             | Generate/shared schema for MongoDB and other consumers              |
| Asset catalogue         | Define 10–15 supported object types and their footprints            |
| Validation              | Structural, referential, bounds, overlap, and basic physical checks |
| MongoDB Atlas           | Configure database/collections needed for this role                 |
| Environment persistence | Save and retrieve environments                                      |
| Versioning              | Immutable `environment_versions` records                            |
| History                 | List and retrieve previous versions                                 |
| Revert                  | Restore an older version by creating a new version                  |
| API                     | Environment CRUD/version endpoints required by the team             |
| Tests                   | Unit, schema, validation, and API/database integration tests        |
| Vector Search           | Similar-environment endpoint if core work is finished               |

### 2.2 Out of scope

I am **not** responsible for:

- React / TypeScript frontend implementation
- Three.js / React Three Fiber viewer
- Frontend editing controls
- LLM provider integration
- Gemini prompts
- LLM repair loops
- Image-to-environment generation
- Deterministic scene compiler
- OpenUSD generation
- Isaac Sim
- ROS 2 / Nav2
- Robot simulation
- Simulation metrics
- Authentication/UI

I may define interfaces that these components use, but I should not implement their internal functionality.

---

# 3. EnvironmentSpec Contract

`EnvironmentSpec` is the central data structure shared between the different parts of the system.

The LLM produces it, the validator checks it, MongoDB stores it, the compiler consumes it, and the frontend edits it.

## 3.1 Conventions

- Units: metres, radians, kilograms, seconds.
- Coordinate system: right-handed, Y-up.
- X = width.
- Y = height.
- Z = length.
- Every object has a stable unique string `id`.
- Every specification contains a `schemaVersion`.
- Object types must exist in the asset catalogue.
- Invalid specifications must never be silently saved.

## 3.2 Core structure

```ts
EnvironmentSpec {
  schemaVersion: string;

  environment: {
    name: string;
    type: "warehouse" | "factory" | "office" | "outdoor" | "custom";
    dimensions: {
      width: number;
      length: number;
      height: number;
    };
  };

  terrain: {
    type:
      | "concrete"
      | "asphalt"
      | "grass"
      | "gravel"
      | "tile"
      | "dirt"
      | "custom";

    properties: {
      friction: number;
      restitution?: number;
    };

    heightmap?: unknown | null;
  };

  objects: EnvironmentObject[];

  lighting?: {
    preset?: string;
    intensity?: number;
  };

  navigation?: {
    waypoints?: Waypoint[];
  };

  robotics: {
    simulation_enabled: boolean;
  };

  provenance: {
    source: string;
    prompt?: string;
    model?: string;
    generatedAt?: string;
    confidence?: number | null;
  };
}
```

---

# 4. Zod Schema

## 4.1 Goals

The Zod schema is the application-level source of truth for the `EnvironmentSpec`.

It should enforce:

- Required fields.
- Correct primitive types.
- Valid enums.
- Positive dimensions.
- Positive scale values.
- Valid array structures.
- Reasonable numeric ranges.
- Maximum object counts.
- Stable schema versioning.

The schema should be strict enough to reject malformed model output while remaining practical for the hackathon.

## 4.2 Schema sharing

The project plan defines a single-source-of-truth approach:

```text
Zod schema
     |
     +--> Runtime validation
     |
     +--> Generated JSON Schema
     |
     +--> MongoDB $jsonSchema
     |
     +--> API contract
     |
     +--> LLM structured output
```

The exact conversion mechanism can use `zod-to-json-schema` if compatible with the team's chosen implementation.

## 4.3 Schema version

Current target:

```text
schemaVersion: "1.0.0"
```

Future schema changes should increment the version rather than silently changing the meaning of stored data.

---

# 5. Asset Catalogue

## 5.1 Purpose

The asset catalogue defines the object types that can legally appear in an `EnvironmentSpec`.

This prevents hallucinated object types and gives the validator deterministic geometric information.

The LLM may only reference object types that exist in this catalogue.

## 5.2 Catalogue fields

Each asset should contain at least:

```ts
{
  type: string;
  usdAsset?: string;
  footprint: [number, number];
  height: number;
  collision: "box" | "cylinder" | "mesh";
  tags: string[];
}
```

Example:

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

## 5.3 Initial catalogue

Target: **10–15 objects**.

Suggested categories:

| Asset              | Example purpose                  |
| ------------------ | -------------------------------- |
| `industrial_shelf` | Warehouse storage                |
| `pallet`           | Warehouse cargo                  |
| `workbench`        | Factory/maintenance area         |
| `storage_rack`     | Industrial storage               |
| `forklift_zone`    | Warehouse area marker            |
| `loading_dock`     | Warehouse loading area           |
| `conveyor`         | Factory production               |
| `machine_station`  | Factory machinery                |
| `office_desk`      | Office environment               |
| `office_chair`     | Office environment               |
| `crate`            | Generic obstacle/cargo           |
| `barrier`          | Safety/obstacle                  |
| `column`           | Structural obstacle              |
| `door`             | Navigation/environment structure |
| `charging_station` | Robot/AMR environment            |

The exact asset list can be adjusted with the frontend/compiler teammate so that every referenced object has a corresponding renderable asset or agreed placeholder.

---

# 6. Validation Engine

Validation runs after generated specifications and after edited specifications.

The validator should **never silently modify the input**.

Instead, it returns a structured result describing errors and warnings.

## 6.1 Validation layers

### Layer 1 — Structural validation

Check:

- JSON/object structure.
- Required fields.
- Correct types.
- Enums.
- Numeric ranges.
- Positive dimensions.
- Positive scale.
- Maximum object count.
- Valid array lengths.

Handled primarily by Zod.

### Layer 2 — Referential validation

Check:

- Every `objects[].type` exists in the asset catalogue.
- Object IDs are unique.
- Waypoint IDs are unique.
- Referenced values are valid.

Example:

```text
UNKNOWN_ASSET
objects[4].type
"robotic_shelf_v9" does not exist in the asset catalogue
```

### Layer 3 — Geometric validation

Check:

- Objects remain inside environment bounds.
- Static objects do not overlap.
- Object footprints are calculated from catalogue dimensions and scale.
- Positions and scales are valid.

For the hackathon, overlap detection can use an **axis-aligned bounding-box/footprint check**.

Rotation-aware collision geometry is not required for the first version unless time permits.

### Layer 4 — Basic physical validation

Check reasonable values for:

- Friction.
- Restitution.
- Mass.
- Scale.
- Environment dimensions.

This should reject clearly invalid values rather than attempt to model complete physics.

### Layer 5 — Optional navigability

If time permits, basic waypoint/navigability validation can be added.

This is lower priority than structural, referential, bounds, and overlap validation.

---

# 7. Validation Result Format

All validation should return a predictable structure.

```json
{
  "valid": false,
  "errors": [
    {
      "path": "objects[3].position",
      "code": "OUT_OF_BOUNDS",
      "message": "x=62 exceeds environment width 50"
    }
  ],
  "warnings": [
    {
      "path": "objects[7]",
      "code": "OVERLAP",
      "message": "Overlaps shelf_002"
    }
  ]
}
```

Suggested error codes:

| Code                 | Meaning                                 |
| -------------------- | --------------------------------------- |
| `SCHEMA_INVALID`     | Zod/schema validation failed            |
| `UNKNOWN_ASSET`      | Object type is not in catalogue         |
| `DUPLICATE_ID`       | Object/waypoint ID is duplicated        |
| `OUT_OF_BOUNDS`      | Object exceeds environment boundaries   |
| `OVERLAP`            | Static objects overlap                  |
| `INVALID_SCALE`      | Scale is zero/negative/outside limits   |
| `INVALID_DIMENSIONS` | Environment dimensions are invalid      |
| `INVALID_PHYSICS`    | Physical value is outside allowed range |

Warnings should be distinguishable from blocking errors.

---

# 8. MongoDB Atlas Data Layer

## 8.1 Collections

The core responsibility is:

```text
environments
environment_versions
```

The project may have additional collections owned by other teammates.

## 8.2 `environments`

This represents the current/head state of an environment.

Example:

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

Important:

`environments` should point to the current head version rather than storing the full mutable specification as the source of truth.

## 8.3 `environment_versions`

Each saved specification becomes an immutable version.

Example:

```json
{
  "_id": "ObjectId",
  "environmentId": "ObjectId",
  "version": 4,
  "parentVersionId": "ObjectId",
  "schemaVersion": "1.0.0",
  "spec": {
    "...EnvironmentSpec...": true
  },
  "summaryText": "Warehouse 50x80m with six shelf aisles",
  "embedding": [],
  "changeNote": "Moved loading dock",
  "createdBy": "ObjectId",
  "createdAt": "ISODate"
}
```

---

# 9. Versioning Model

## 9.1 Core rule

**Versions are immutable.**

An edit must never overwrite the existing `spec`.

Instead:

```text
Version 1
   |
   +--> User edits
           |
           v
       Version 2
           |
           +--> User edits
                   |
                   v
               Version 3
```

Each new save:

1. Validates the new specification.
2. Determines the next version number.
3. Inserts a new `environment_versions` document.
4. Sets its `parentVersionId`.
5. Updates `environments.headVersionId`.
6. Increments `versionCount`.
7. Updates `updatedAt`.

## 9.2 Revert

Revert should preserve history.

Preferred approach:

```text
Version 1
Version 2
Version 3
Version 4

Revert to Version 2

Version 5
  spec = copy of Version 2
  parentVersionId = Version 4
  changeNote = "Reverted to version 2"
```

This means no historical record disappears.

---

# 10. MongoDB `$jsonSchema`

Application-level validation with Zod is the first layer.

MongoDB `$jsonSchema` provides a second safety net.

The database should reject malformed `environment_versions` documents even if an API bug bypasses application validation.

Example direction:

```js
db.createCollection("environment_versions", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "environmentId",
        "version",
        "schemaVersion",
        "spec",
        "createdAt",
      ],
      properties: {
        version: {
          bsonType: "int",
          minimum: 1,
        },
        schemaVersion: {
          bsonType: "string",
        },
        spec: {
          bsonType: "object",
          required: ["environment", "terrain", "objects"],
        },
      },
    },
  },
  validationLevel: "strict",
  validationAction: "error",
});
```

The MongoDB validator should reflect the important constraints from the shared schema without becoming unnecessarily difficult to maintain during the hackathon.

---

# 11. MongoDB Indexes

Initial indexes:

### `environments`

```text
{ ownerId: 1, updatedAt: -1 }
{ projectId: 1 }
{ tags: 1 }
```

### `environment_versions`

```text
{ environmentId: 1, version: -1 }
```

The `(environmentId, version)` combination should be unique.

The purpose is to make:

- Environment listing fast.
- Version history fast.
- Specific version retrieval fast.

---

# 12. API

The API is the interface between the data layer and the rest of the application.

## 12.1 Core endpoints

| Method | Endpoint                        | Purpose                                        |
| ------ | ------------------------------- | ---------------------------------------------- |
| `GET`  | `/environments`                 | List environments                              |
| `GET`  | `/environments/:id`             | Get environment/head version                   |
| `GET`  | `/environments/:id/versions`    | Get version history                            |
| `GET`  | `/environments/:id/versions/:n` | Get specific version                           |
| `PUT`  | `/environments/:id`             | Validate and save edited spec as a new version |
| `POST` | `/environments/:id/revert`      | Create a new version from an older version     |
| `GET`  | `/assets/catalogue`             | Return available asset types                   |

Vector search is an optional final endpoint.

---

# 13. Save Endpoint

## Request

```http
PUT /environments/:id
Content-Type: application/json
```

Conceptually:

```json
{
  "spec": {
    "...EnvironmentSpec...": true
  },
  "changeNote": "Moved shelf and added loading dock"
}
```

## Behaviour

```text
Request
  |
  v
Parse request
  |
  v
Zod validation
  |
  +--> invalid -> 400 VALIDATION_FAILED
  |
  v
Semantic validator
  |
  +--> invalid -> 400 VALIDATION_FAILED
  |
  v
Create immutable environment version
  |
  v
Update environment head
  |
  v
Return new version
```

A failed save must not create a new version.

---

# 14. List / History Endpoints

## List environments

```http
GET /environments
```

Should return lightweight environment metadata rather than loading every historical specification.

Example:

```json
[
  {
    "id": "env_123",
    "name": "Warehouse Environment",
    "type": "warehouse",
    "headVersion": 4,
    "versionCount": 4,
    "updatedAt": "2026-10-03T10:00:00Z"
  }
]
```

## Version history

```http
GET /environments/:id/versions
```

Should return version metadata:

```json
[
  {
    "version": 4,
    "changeNote": "Added loading dock",
    "createdAt": "...",
    "createdBy": "..."
  },
  {
    "version": 3,
    "changeNote": "Moved shelves",
    "createdAt": "...",
    "createdBy": "..."
  }
]
```

## Specific version

```http
GET /environments/:id/versions/:n
```

Returns the full stored `EnvironmentSpec` and version metadata.

---

# 15. Revert Endpoint

```http
POST /environments/:id/revert
```

Request:

```json
{
  "toVersion": 2
}
```

Behaviour:

```text
Find requested historical version
        |
        v
Copy its EnvironmentSpec
        |
        v
Validate copied spec
        |
        v
Create NEW version
        |
        v
Update environment head
```

The old versions remain untouched.

---

# 16. Vector Search — Optional

Vector search is the **lowest-priority part of this role**.

It should only be implemented after:

- Zod schema works.
- Catalogue works.
- Validator works.
- MongoDB works.
- Save/versioning works.
- History works.
- Revert works.
- Tests pass.

Potential endpoint:

```http
GET /environments/similar?text=warehouse%20with%20narrow%20aisles
```

The intended purpose is to find semantically similar previously saved environments using MongoDB Atlas Vector Search.

A version can contain:

```json
{
  "summaryText": "Warehouse 50x80m with six shelf aisles",
  "embedding": [ ... ]
}
```

The embedding model and exact vector dimensions remain a project decision.

**Vector search must not block the core demo.**

---

# 17. Integration Contracts

Other teammates should be able to treat this layer as a stable contract.

## Frontend / 3D editor

The frontend should be able to:

1. Receive an `EnvironmentSpec`.
2. Modify the spec.
3. Send the modified spec to the save endpoint.
4. Receive the new version.
5. Request history.
6. Request a previous version.
7. Revert through the API.

The frontend does not need to know how MongoDB stores the documents.

## LLM teammate

The LLM layer should:

1. Produce an `EnvironmentSpec`.
2. Use only asset types from the catalogue.
3. Send the result to validation.
4. Treat validation errors as structured feedback.

The validator remains the authority on correctness.

## Compiler / 3D teammate

The compiler should:

1. Consume validated `EnvironmentSpec`.
2. Look up object types from the agreed catalogue.
3. Use the footprint/dimensions defined by the catalogue.
4. Not need to implement its own independent environment validation.

## Robotics / simulation teammate

Simulation should reference a specific:

```text
environmentVersionId
```

This guarantees that a simulation can be associated with an exact environment state.

---

# 18. Testing Strategy

## 18.1 Schema tests

Test:

- Valid minimal specification.
- Missing required fields.
- Invalid environment type.
- Invalid terrain type.
- Negative dimensions.
- Invalid scale.
- Excessive object count.
- Invalid provenance.

## 18.2 Catalogue tests

Test:

- All catalogue entries contain required fields.
- Footprints are positive.
- Heights are positive.
- Object types are unique.
- Example specs can reference every supported asset.

## 18.3 Validator tests

At minimum:

### Valid

```text
Valid warehouse
  -> accepted
```

### Unknown object

```text
type = "fake_shelf"
  -> UNKNOWN_ASSET
```

### Out of bounds

```text
object position exceeds environment dimensions
  -> OUT_OF_BOUNDS
```

### Overlap

```text
two static objects occupy the same footprint
  -> OVERLAP
```

### Duplicate IDs

```text
two objects have id = "shelf_001"
  -> DUPLICATE_ID
```

### Invalid scale

```text
scale = [0, 1, 1]
  -> INVALID_SCALE
```

## 18.4 API tests

Test:

```text
Create environment
       |
       v
Save version 1
       |
       v
Edit
       |
       v
Save version 2
       |
       v
History contains 1 and 2
       |
       v
Revert to 1
       |
       v
Version 3 created
```

Also verify:

```text
Bad spec
   |
   v
Validation failure
   |
   v
No new version created
```

## 18.5 MongoDB integration

Verify:

- Documents are actually persisted.
- `$jsonSchema` rejects invalid database documents.
- Version uniqueness works.
- History queries work.
- Head version updates correctly.

---

# 19. Implementation Order

## Phase 1 — Schema and catalogue

- [ ] Create Zod `EnvironmentSpec`.
- [ ] Define supporting types.
- [ ] Define 10–15 asset catalogue entries.
- [ ] Add schema tests.
- [ ] Make catalogue available to other teammates.

**Milestone:** A valid `EnvironmentSpec` can be created and checked locally.

---

## Phase 2 — Validator

- [ ] Implement Zod structural validation.
- [ ] Implement known-asset validation.
- [ ] Implement duplicate-ID validation.
- [ ] Implement bounds checking.
- [ ] Implement static-object overlap checking.
- [ ] Implement basic physical checks.
- [ ] Standardise validation errors.
- [ ] Add validator unit tests.

**Milestone:** A deliberately bad spec is rejected with useful error messages.

---

## Phase 3 — MongoDB Atlas

- [ ] Create/configure Atlas cluster.
- [ ] Configure database.
- [ ] Create `environments`.
- [ ] Create `environment_versions`.
- [ ] Add indexes.
- [ ] Add `$jsonSchema`.
- [ ] Test database rejection of invalid documents.

**Milestone:** Valid environment versions can be stored safely.

---

## Phase 4 — Versioned API

- [ ] Implement environment listing.
- [ ] Implement environment retrieval.
- [ ] Implement version history.
- [ ] Implement specific-version retrieval.
- [ ] Implement save/new-version endpoint.
- [ ] Implement revert.
- [ ] Implement asset catalogue endpoint.
- [ ] Add integration tests.

**Milestone:** Frontend can edit → save → view history → revert.

---

## Phase 5 — Integration

- [ ] Give frontend teammate API contract.
- [ ] Give LLM teammate Zod/schema contract.
- [ ] Give compiler teammate catalogue format.
- [ ] Test an LLM-generated spec through the validator.
- [ ] Test a frontend-style edited spec through save/versioning.
- [ ] Confirm the compiler can consume catalogue entries.

**Milestone:** Other components can use the data layer without directly accessing MongoDB.

---

## Phase 6 — Vector Search (Only if time remains)

- [ ] Decide embedding model.
- [ ] Add embedding to version records.
- [ ] Configure Atlas Vector Search index.
- [ ] Implement similar-environment query.
- [ ] Test semantic retrieval.

**Milestone:** Similar environments can be retrieved from MongoDB.

---

# 20. Definition of Done

The core role is complete when all of the following are true:

### Schema

- [ ] `EnvironmentSpec` has a working Zod schema.
- [ ] Schema version is defined.
- [ ] Invalid structures are rejected.

### Catalogue

- [ ] 10–15 assets are defined.
- [ ] Every asset has a footprint and dimensions.
- [ ] Asset IDs/types are unique.
- [ ] Catalogue is available to the API/other components.

### Validator

- [ ] Unknown assets are rejected.
- [ ] Duplicate IDs are rejected.
- [ ] Out-of-bounds objects are rejected.
- [ ] Overlapping static objects are rejected.
- [ ] Invalid scales are rejected.
- [ ] Errors have useful paths/codes/messages.

### MongoDB

- [ ] Atlas cluster is configured.
- [ ] `environments` exists.
- [ ] `environment_versions` exists.
- [ ] Indexes exist.
- [ ] `$jsonSchema` validation is enabled.

### Versioning

- [ ] Saving creates a new immutable version.
- [ ] Existing versions are never overwritten.
- [ ] History can be listed.
- [ ] Individual versions can be retrieved.
- [ ] Revert creates a new version.
- [ ] Head version is updated correctly.

### API

- [ ] List works.
- [ ] Retrieve works.
- [ ] Save works.
- [ ] History works.
- [ ] Specific version retrieval works.
- [ ] Revert works.
- [ ] Catalogue endpoint works.

### Tests

- [ ] Valid specs pass.
- [ ] Invalid specs fail.
- [ ] Bad specs do not create versions.
- [ ] Version history survives edits/reverts.
- [ ] MongoDB rejects malformed documents.

### Optional

- [ ] Vector search works if time remains.

---

# 21. Risks and Decisions

| Risk                                          | Mitigation                                              |
| --------------------------------------------- | ------------------------------------------------------- |
| Schema changes during hackathon               | Keep `schemaVersion`; coordinate changes before merging |
| LLM generates unknown objects                 | Catalogue + referential validation                      |
| LLM generates impossible positions            | Bounds validator                                        |
| Objects overlap                               | Deterministic footprint/overlap validator               |
| Bad data bypasses API                         | MongoDB `$jsonSchema`                                   |
| Revert destroys history                       | Revert creates a new version                            |
| Frontend and backend disagree                 | Keep API/schema contract shared                         |
| Vector search consumes too much time          | Implement only after core versioning works              |
| Catalogue assets do not match compiler assets | Agree on exact asset type names early                   |
| Concurrent saves cause version conflicts      | Keep version creation atomic/ordered where practical    |

---

# 22. Team Coordination

Before changing the shared `EnvironmentSpec`, notify the team because the schema is a cross-component contract.

Changes that affect other teammates include:

- Renaming an `EnvironmentSpec` field.
- Changing object structure.
- Removing an asset type.
- Changing asset dimensions/footprints.
- Changing validation behaviour.
- Changing API request/response formats.

The following should remain stable whenever possible:

```text
EnvironmentSpec
Asset catalogue type names
Validation result format
Environment version model
API endpoints
```

---

# 23. Final Target Architecture for My Role

```text
                 LLM / Frontend
                       |
                       v
               +----------------+
               | EnvironmentSpec|
               +-------+--------+
                       |
                       v
               +----------------+
               |  Zod Schema    |
               +-------+--------+
                       |
                       v
               +----------------+
               |   Validator    |
               |----------------|
               | Structure      |
               | Asset types    |
               | IDs            |
               | Bounds         |
               | Overlap        |
               | Physics        |
               +-------+--------+
                       |
              valid    |    invalid
                |      |       |
                v      |       v
        +---------------+   Return errors
        | MongoDB Atlas |
        +-------+-------+
                |
        +-------+--------+
        |                |
        v                v
 environments    environment_versions
        |                |
        |         immutable history
        |                |
        +-------+--------+
                |
                v
        Frontend / Compiler /
        Simulation consumers
```

---

# 24. Hackathon Priority

The priority order for this role is:

```text
P0 — MUST WORK
├── Zod EnvironmentSpec
├── Asset catalogue
├── Validator
├── MongoDB Atlas
├── environments
├── environment_versions
├── Save/version endpoint
├── History
└── Revert

P1 — SHOULD WORK
├── Strong test coverage
├── $jsonSchema
├── Catalogue endpoint
└── Frontend/API integration

P2 — ONLY IF TIME
└── Vector search
```

The core success criterion is:

> **An edited environment can be validated, saved as a new immutable version, viewed in history, reverted without destroying history, and a deliberately bad `EnvironmentSpec` is rejected before it reaches the database.**
