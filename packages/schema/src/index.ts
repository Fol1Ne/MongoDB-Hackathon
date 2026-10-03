import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = "1.0.0" as const;

/** Hard limits shared by Zod, the validator and the MongoDB $jsonSchema. */
export const LIMITS = {
  maxObjects: 2000,
  maxWaypoints: 500,
  maxDimension: 1000, // metres (width / length)
  maxHeight: 100, // metres
  minScale: 0.1,
  maxScale: 10,
  maxMass: 100_000, // kg
  maxFriction: 2,
} as const;

const finite = z.number().finite();
export const Vec3Schema = z.tuple([finite, finite, finite]);
const PositiveScaleSchema = z.number().finite().min(LIMITS.minScale).max(LIMITS.maxScale);

export const EnvironmentTypeSchema = z.enum(["warehouse", "factory", "office", "outdoor", "custom"]);
export const TerrainTypeSchema = z.enum(["concrete", "asphalt", "grass", "gravel", "tile", "dirt", "custom"]);
export const CollisionShapeSchema = z.enum(["box", "cylinder", "mesh"]);

/** Ids become USD prim names in the compiler, so they must be identifiers: no '-', '.', or leading digit. */
export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const IdSchema = z
  .string()
  .regex(ID_PATTERN, "id must start with a letter or _ and contain only letters, digits and _ (max 64)")
  .describe("Unique id, used as a USD prim name: a letter or _ followed by letters, digits or _ (max 64); no '-' or '.'");

export const ObjectPhysicsSchema = z
  .object({
    static: z.boolean(),
    mass: z.number().finite().positive().max(LIMITS.maxMass).nullable(),
    collisionShape: CollisionShapeSchema.optional(),
  })
  .strict();

export const EnvironmentObjectSchema = z
  .object({
    id: IdSchema,
    type: z.string().min(1),
    position: Vec3Schema.describe("[x, y, z] metres: centre of the footprint at the object's base (y = bottom)"),
    rotation: Vec3Schema.describe("[rx, ry, rz] Euler XYZ in radians (not degrees), within ±2π"),
    scale: z.tuple([PositiveScaleSchema, PositiveScaleSchema, PositiveScaleSchema]),
    physics: ObjectPhysicsSchema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  })
  .strict();

export const WaypointSchema = z.object({ id: IdSchema, position: Vec3Schema.describe("[x, y, z] metres") }).strict();

export const EnvironmentSpecSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    environment: z
      .object({
        name: z.string().min(1).max(200),
        type: EnvironmentTypeSchema,
        dimensions: z
          .object({
            width: z.number().finite().positive().max(LIMITS.maxDimension),
            length: z.number().finite().positive().max(LIMITS.maxDimension),
            height: z.number().finite().positive().max(LIMITS.maxHeight),
          })
          .strict(),
      })
      .strict(),
    terrain: z
      .object({
        type: TerrainTypeSchema,
        properties: z
          .object({
            friction: z.number().finite().min(0).max(LIMITS.maxFriction),
            restitution: z.number().finite().min(0).max(1).optional(),
          })
          .strict(),
        heightmap: z
          .object({ assetId: z.string().min(1), maxHeight: z.number().finite().positive().optional() })
          .strict()
          .nullable()
          .optional(),
      })
      .strict(),
    objects: z.array(EnvironmentObjectSchema).max(LIMITS.maxObjects),
    lighting: z
      .object({ preset: z.string().min(1), intensity: z.number().finite().min(0).max(10) })
      .strict()
      .optional(),
    navigation: z.object({ waypoints: z.array(WaypointSchema).max(LIMITS.maxWaypoints) }).strict().optional(),
    robotics: z.object({ simulation_enabled: z.boolean() }).strict(),
    provenance: z
      .object({
        source: z.enum(["text", "image", "manual", "import"]),
        prompt: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        generatedAt: z.string().datetime(),
        confidence: z.number().min(0).max(1).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export type EnvironmentSpec = z.infer<typeof EnvironmentSpecSchema>;
export type EnvironmentObject = z.infer<typeof EnvironmentObjectSchema>;
export type Waypoint = z.infer<typeof WaypointSchema>;
export type Vec3 = z.infer<typeof Vec3Schema>;

/** Asset catalogue entry. footprint = [extent along X, extent along Z] in metres at scale 1. */
export const AssetDefinitionSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  footprint: z.tuple([z.number().positive(), z.number().positive()]),
  height: z.number().positive(),
  collision: CollisionShapeSchema,
  tags: z.array(z.string()),
  usdAsset: z.string().optional(),
});
export type AssetDefinition = z.infer<typeof AssetDefinitionSchema>;

export const VALIDATION_CODES = [
  "SCHEMA_INVALID",
  "UNKNOWN_ASSET_TYPE",
  "DUPLICATE_OBJECT_ID",
  "DUPLICATE_WAYPOINT_ID",
  "OUT_OF_BOUNDS",
  "OVERLAP",
  "INVALID_SCALE",
  "INVALID_DIMENSIONS",
  "INVALID_FRICTION",
  "INVALID_RESTITUTION",
  "INVALID_MASS",
  "WAYPOINT_IN_OBSTACLE",
  "SUSPICIOUS_ROTATION",
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export interface ValidationError {
  path: string;
  code: ValidationCode;
  message: string;
}
export type ValidationWarning = ValidationError;
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
