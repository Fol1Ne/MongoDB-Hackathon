import type { Db } from "mongodb";
import { LIMITS } from "@twin/schema";

/**
 * Database-level STRUCTURAL safety net only. Geometry/business rules (overlap, bounds, catalogue)
 * live in @twin/validator and are intentionally not expressed here.
 */
const vec3 = { bsonType: "array", minItems: 3, maxItems: 3, items: { bsonType: "number" } };
const positive = { bsonType: "number", minimum: 0, exclusiveMinimum: true };

export const environmentVersionsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["environmentId", "version", "schemaVersion", "spec", "createdAt"],
    properties: {
      environmentId: { bsonType: "objectId" },
      version: { bsonType: "int", minimum: 1 },
      parentVersionId: { bsonType: ["objectId", "null"] },
      schemaVersion: { bsonType: "string" },
      summaryText: { bsonType: "string" },
      changeNote: { bsonType: ["string", "null"] },
      createdAt: { bsonType: "date" },
      spec: {
        bsonType: "object",
        required: ["schemaVersion", "environment", "terrain", "objects"],
        properties: {
          schemaVersion: { bsonType: "string" },
          environment: {
            bsonType: "object",
            required: ["name", "type", "dimensions"],
            properties: {
              name: { bsonType: "string" },
              type: { enum: ["warehouse", "factory", "office", "outdoor", "custom"] },
              dimensions: {
                bsonType: "object",
                required: ["width", "length", "height"],
                properties: { width: positive, length: positive, height: positive },
              },
            },
          },
          terrain: {
            bsonType: "object",
            required: ["type", "properties"],
            properties: {
              type: { enum: ["concrete", "asphalt", "grass", "gravel", "tile", "dirt", "custom"] },
              properties: {
                bsonType: "object",
                required: ["friction"],
                properties: { friction: { bsonType: "number", minimum: 0, maximum: LIMITS.maxFriction } },
              },
            },
          },
          objects: {
            bsonType: "array",
            maxItems: LIMITS.maxObjects,
            items: {
              bsonType: "object",
              required: ["id", "type", "position", "rotation", "scale"],
              properties: { id: { bsonType: "string" }, type: { bsonType: "string" }, position: vec3, rotation: vec3, scale: vec3 },
            },
          },
        },
      },
    },
  },
};

export const environmentsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["name", "type", "headVersionId", "versionCount", "createdAt", "updatedAt"],
    properties: {
      name: { bsonType: "string" },
      type: { enum: ["warehouse", "factory", "office", "outdoor", "custom"] },
      headVersionId: { bsonType: "objectId" },
      versionCount: { bsonType: "int", minimum: 1 },
      tags: { bsonType: "array", items: { bsonType: "string" } },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};

async function ensureCollection(db: Db, name: string, validator: object) {
  const existing = await db.listCollections({ name }).toArray();
  const opts = { validator, validationLevel: "strict", validationAction: "error" } as const;
  if (existing.length === 0) await db.createCollection(name, opts);
  else await db.command({ collMod: name, ...opts });
}

/** Idempotent: creates collections with validators (or updates them) and builds indexes. */
export async function ensureSchema(db: Db): Promise<void> {
  await ensureCollection(db, "environment_versions", environmentVersionsValidator);
  await ensureCollection(db, "environments", environmentsValidator);

  await db.collection("environment_versions").createIndex({ environmentId: 1, version: -1 }, { unique: true, name: "env_version_unique" });
  const envs = db.collection("environments");
  await envs.createIndex({ ownerId: 1, updatedAt: -1 }, { name: "owner_updated" });
  await envs.createIndex({ projectId: 1 }, { name: "project" });
  await envs.createIndex({ tags: 1 }, { name: "tags" });
  await envs.createIndex({ updatedAt: -1, _id: -1 }, { name: "updated_desc" });
}
