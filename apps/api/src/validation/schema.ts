import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const PositiveNumber = z.number().positive();
const NonNegativeNumber = z.number().min(0);

const DimensionsSchema = z.object({
  width: PositiveNumber,
  length: PositiveNumber,
  height: PositiveNumber,
});

const EnvironmentTypeEnum = z.enum(['warehouse', 'factory', 'office', 'outdoor', 'custom']);
const TerrainTypeEnum = z.enum(['concrete', 'asphalt', 'grass', 'gravel', 'tile', 'dirt', 'custom']);

const EnvironmentObjectSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: z.tuple([z.number(), NonNegativeNumber, z.number()]),
  rotation: z.tuple([z.number(), z.number(), z.number()]),
  scale: z.tuple([PositiveNumber, PositiveNumber, PositiveNumber]),
  physics: z
    .object({
      static: z.boolean(),
      mass: z.number().nullable(),
    })
    .optional(),
  tags: z.array(z.string()).optional(),
});

const WaypointSchema = z.object({
  id: z.string().min(1),
  position: z.tuple([z.number(), NonNegativeNumber, z.number()]),
});

export const EnvironmentSpecSchema = z.object({
  schemaVersion: z.string(),

  environment: z.object({
    name: z.string().min(1),
    type: EnvironmentTypeEnum,
    dimensions: DimensionsSchema,
  }),

  terrain: z.object({
    type: TerrainTypeEnum,
    properties: z.object({
      friction: z.number().min(0).max(2),
      restitution: z.number().min(0).max(1).optional(),
    }),
    heightmap: z.unknown().nullable().optional(),
  }),

  objects: z.array(EnvironmentObjectSchema).max(500),

  lighting: z
    .object({
      preset: z.string().optional(),
      intensity: z.number().min(0).optional(),
    })
    .optional(),

  navigation: z
    .object({
      waypoints: z.array(WaypointSchema).optional(),
    })
    .optional(),

  robotics: z.object({
    simulation_enabled: z.boolean(),
  }),

  provenance: z.object({
    source: z.string(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    generatedAt: z.string().optional(),
    confidence: z.number().nullable().optional(),
  }),
});

export type EnvironmentSpec = z.infer<typeof EnvironmentSpecSchema>;
export type EnvironmentObject = z.infer<typeof EnvironmentObjectSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const environmentSpecJsonSchema = zodToJsonSchema(EnvironmentSpecSchema as any, {
  name: 'EnvironmentSpec',
  $refStrategy: 'none',
});
