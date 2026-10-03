import { EnvironmentSpec, EnvironmentSpecSchema } from './schema';
import { ASSET_MAP, KNOWN_TYPES } from '../catalogue/assets';

export interface ValidationError {
  path: string;
  code: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export function validate(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Layer 1: Structural (Zod)
  const parsed = EnvironmentSpecSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        path: issue.path.join('.') || 'root',
        code: 'SCHEMA_INVALID',
        message: issue.message,
      });
    }
    return { valid: false, errors, warnings };
  }

  const spec = parsed.data as EnvironmentSpec;
  const { width, length } = spec.environment.dimensions;

  // Layer 2: Referential — known asset types, unique IDs
  const seenIds = new Set<string>();
  const seenWpIds = new Set<string>();

  for (let i = 0; i < spec.objects.length; i++) {
    const obj = spec.objects[i];

    if (!KNOWN_TYPES.has(obj.type)) {
      errors.push({
        path: `objects[${i}].type`,
        code: 'UNKNOWN_ASSET',
        message: `"${obj.type}" does not exist in the asset catalogue`,
      });
    }

    if (seenIds.has(obj.id)) {
      errors.push({
        path: `objects[${i}].id`,
        code: 'DUPLICATE_ID',
        message: `Object ID "${obj.id}" is duplicated`,
      });
    }
    seenIds.add(obj.id);
  }

  if (spec.navigation?.waypoints) {
    for (let i = 0; i < spec.navigation.waypoints.length; i++) {
      const wp = spec.navigation.waypoints[i];
      if (seenWpIds.has(wp.id)) {
        errors.push({
          path: `navigation.waypoints[${i}].id`,
          code: 'DUPLICATE_ID',
          message: `Waypoint ID "${wp.id}" is duplicated`,
        });
      }
      seenWpIds.add(wp.id);
    }
  }

  if (errors.length > 0) return { valid: false, errors, warnings };

  // Layer 3: Geometric — bounds and overlap
  const halfW = width / 2;
  const halfL = length / 2;

  // Store footprints for overlap detection: [x, z, hw, hd]
  type FootprintEntry = { id: string; x: number; z: number; hw: number; hd: number };
  const footprints: FootprintEntry[] = [];

  for (let i = 0; i < spec.objects.length; i++) {
    const obj = spec.objects[i];
    const [x, y, z] = obj.position;
    const [sx, , sz] = obj.scale;

    if (x < -halfW || x > halfW) {
      errors.push({
        path: `objects[${i}].position`,
        code: 'OUT_OF_BOUNDS',
        message: `x=${x} exceeds environment width bounds [${-halfW}, ${halfW}]`,
      });
    }
    if (z < -halfL || z > halfL) {
      errors.push({
        path: `objects[${i}].position`,
        code: 'OUT_OF_BOUNDS',
        message: `z=${z} exceeds environment length bounds [${-halfL}, ${halfL}]`,
      });
    }
    if (y < 0) {
      errors.push({
        path: `objects[${i}].position`,
        code: 'OUT_OF_BOUNDS',
        message: `y=${y} is below ground (y must be >= 0)`,
      });
    }

    const asset = ASSET_MAP.get(obj.type);
    if (asset) {
      const hw = (asset.footprint[0] * sx) / 2;
      const hd = (asset.footprint[1] * sz) / 2;
      footprints.push({ id: obj.id, x, z, hw, hd });
    }
  }

  if (errors.length > 0) return { valid: false, errors, warnings };

  // Overlap check (AABB, static objects only) — reported as warnings not errors
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i];
      const b = footprints[j];
      const overlapX = Math.abs(a.x - b.x) < a.hw + b.hw;
      const overlapZ = Math.abs(a.z - b.z) < a.hd + b.hd;
      if (overlapX && overlapZ) {
        warnings.push({
          path: `objects`,
          code: 'OVERLAP',
          message: `"${a.id}" overlaps "${b.id}"`,
        });
      }
    }
  }

  // Layer 4: Physical ranges
  const { friction, restitution } = spec.terrain.properties;
  if (friction < 0 || friction > 2) {
    errors.push({
      path: 'terrain.properties.friction',
      code: 'INVALID_PHYSICS',
      message: `friction=${friction} must be between 0 and 2`,
    });
  }
  if (restitution !== undefined && (restitution < 0 || restitution > 1)) {
    errors.push({
      path: 'terrain.properties.restitution',
      code: 'INVALID_PHYSICS',
      message: `restitution=${restitution} must be between 0 and 1`,
    });
  }

  for (let i = 0; i < spec.objects.length; i++) {
    const obj = spec.objects[i];
    const [sx, sy, sz] = obj.scale;
    if (sx <= 0 || sy <= 0 || sz <= 0) {
      errors.push({
        path: `objects[${i}].scale`,
        code: 'INVALID_SCALE',
        message: `scale values must all be positive, got [${sx}, ${sy}, ${sz}]`,
      });
    }
    if (obj.physics?.mass !== null && obj.physics?.mass !== undefined && obj.physics.mass < 0) {
      errors.push({
        path: `objects[${i}].physics.mass`,
        code: 'INVALID_PHYSICS',
        message: `mass must be non-negative`,
      });
    }
  }

  const valid = errors.length === 0;
  return { valid, errors, warnings };
}
