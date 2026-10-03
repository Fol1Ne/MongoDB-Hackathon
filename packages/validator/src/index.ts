import type { ZodIssue } from "zod";
import {
  EnvironmentSpecSchema,
  type AssetDefinition,
  type EnvironmentSpec,
  type ValidationCode,
  type ValidationError,
  type ValidationResult,
  type ValidationWarning,
} from "@twin/schema";
import { buildAssetMap, type AssetMap } from "@twin/catalogue";

export interface ValidateOptions {
  /** Defaults to the built-in catalogue. */
  catalogue?: readonly AssetDefinition[];
}

export interface ParsedValidation {
  result: ValidationResult;
  /** Parsed spec; non-null only when result.valid is true. Never modified from the input. */
  spec: EnvironmentSpec | null;
}

const EPS = 1e-6;
const RANGE_ISSUES = new Set(["too_small", "too_big", "not_finite"]);

/** Zod issue path -> "objects[3].position[0]" */
export function formatPath(path: (string | number)[]): string {
  let out = "";
  for (const seg of path) out += typeof seg === "number" ? `[${seg}]` : out ? `.${seg}` : seg;
  return out;
}

function codeForIssue(issue: ZodIssue): ValidationCode {
  if (!RANGE_ISSUES.has(issue.code)) return "SCHEMA_INVALID";
  const p = issue.path;
  if (p[0] === "environment" && p[1] === "dimensions") return "INVALID_DIMENSIONS";
  if (p[0] === "terrain" && p[1] === "properties" && p[2] === "friction") return "INVALID_FRICTION";
  if (p[0] === "terrain" && p[1] === "properties" && p[2] === "restitution") return "INVALID_RESTITUTION";
  if (p[0] === "objects" && p[2] === "scale") return "INVALID_SCALE";
  if (p[0] === "objects" && p[2] === "physics" && p[3] === "mass") return "INVALID_MASS";
  return "SCHEMA_INVALID";
}

interface Box {
  index: number;
  id: string;
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  minY: number; maxY: number;
  isStatic: boolean;
}

/**
 * v1 footprint: axis-aligned rectangle centred on position (x,z).
 * Extents = catalogue footprint * scale (X*sx, Z*sz). Yaw (rotation[1]) is accounted for by taking the
 * axis-aligned bounding rectangle of the rotated footprint (conservative). Pitch/roll are ignored.
 * Vertical span = [position.y, position.y + height * sy].
 */
export function computeBox(
  obj: EnvironmentSpec["objects"][number],
  asset: AssetDefinition,
  index: number,
): Box {
  const hx = (asset.footprint[0] * obj.scale[0]) / 2;
  const hz = (asset.footprint[1] * obj.scale[2]) / 2;
  const yaw = obj.rotation[1];
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = c * hx + s * hz;
  const ez = s * hx + c * hz;
  const [x, y, z] = obj.position;
  return {
    index, id: obj.id,
    minX: x - ex, maxX: x + ex,
    minZ: z - ez, maxZ: z + ez,
    minY: y, maxY: y + asset.height * obj.scale[1],
    isStatic: obj.physics?.static ?? true, // no physics block => treated as static
  };
}

const f = (n: number) => Number(n.toFixed(3));

export function validateAndParse(input: unknown, opts: ValidateOptions = {}): ParsedValidation {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Structural
  const parsed = EnvironmentSpecSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: formatPath(issue.path), code: codeForIssue(issue), message: issue.message });
    }
    return { result: { valid: false, errors, warnings }, spec: null };
  }
  const spec = parsed.data;
  const assets: AssetMap = buildAssetMap(opts.catalogue);

  // 2. Referential
  const firstObj = new Map<string, number>();
  spec.objects.forEach((o, i) => {
    if (!assets.has(o.type)) {
      errors.push({ path: `objects[${i}].type`, code: "UNKNOWN_ASSET_TYPE", message: `Unknown asset type '${o.type}'` });
    }
    const prev = firstObj.get(o.id);
    if (prev !== undefined) {
      errors.push({ path: `objects[${i}].id`, code: "DUPLICATE_OBJECT_ID", message: `Duplicate object id '${o.id}' (first used at objects[${prev}])` });
    } else firstObj.set(o.id, i);
  });
  const waypoints = spec.navigation?.waypoints ?? [];
  const firstWp = new Map<string, number>();
  waypoints.forEach((w, i) => {
    const prev = firstWp.get(w.id);
    if (prev !== undefined) {
      errors.push({ path: `navigation.waypoints[${i}].id`, code: "DUPLICATE_WAYPOINT_ID", message: `Duplicate waypoint id '${w.id}' (first used at navigation.waypoints[${prev}])` });
    } else firstWp.set(w.id, i);
  });

  // 3. Geometric + 4. Physical
  const { width, length, height } = spec.environment.dimensions;
  const halfW = width / 2;
  const halfL = length / 2;
  const boxes: Box[] = [];

  spec.objects.forEach((o, i) => {
    const asset = assets.get(o.type);
    if (!asset) return; // already reported
    const b = computeBox(o, asset, i);
    boxes.push(b);

    if (b.minX < -halfW - EPS || b.maxX > halfW + EPS) {
      const x = o.position[0];
      errors.push({ path: `objects[${i}].position`, code: "OUT_OF_BOUNDS",
        message: `x extent [${f(b.minX)}, ${f(b.maxX)}] (x=${f(x)}) exceeds width ${width} (allowed ±${halfW})` });
    }
    if (b.minZ < -halfL - EPS || b.maxZ > halfL + EPS) {
      const z = o.position[2];
      errors.push({ path: `objects[${i}].position`, code: "OUT_OF_BOUNDS",
        message: `z extent [${f(b.minZ)}, ${f(b.maxZ)}] (z=${f(z)}) exceeds length ${length} (allowed ±${halfL})` });
    }
    if (b.minY < -EPS || b.maxY > height + EPS) {
      errors.push({ path: `objects[${i}].position`, code: "OUT_OF_BOUNDS",
        message: `y extent [${f(b.minY)}, ${f(b.maxY)}] outside environment height [0, ${height}]` });
    }

    if (o.physics && !o.physics.static && o.physics.mass === null) {
      errors.push({ path: `objects[${i}].physics.mass`, code: "INVALID_MASS", message: "Non-static objects require a positive mass" });
    }
  });

  waypoints.forEach((w, i) => {
    const [x, y, z] = w.position;
    if (Math.abs(x) > halfW + EPS || Math.abs(z) > halfL + EPS || y < -EPS || y > height + EPS) {
      errors.push({ path: `navigation.waypoints[${i}].position`, code: "OUT_OF_BOUNDS",
        message: `Waypoint (${f(x)}, ${f(y)}, ${f(z)}) is outside the environment` });
    }
  });

  // Overlap: sweep along X. Both static => error; otherwise warning.
  const sorted = [...boxes].sort((a, b) => a.minX - b.minX || a.index - b.index);
  const pairs: Array<[Box, Box]> = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.minX >= a.maxX - EPS) break;
      const overlap =
        Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > EPS &&
        Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > EPS;
      if (overlap) pairs.push(a.index < b.index ? [a, b] : [b, a]);
    }
  }
  pairs.sort((p, q) => p[1].index - q[1].index || p[0].index - q[0].index);
  for (const [earlier, later] of pairs) {
    const entry = { path: `objects[${later.index}]`, code: "OVERLAP" as const,
      message: `Overlaps ${earlier.id} (objects[${earlier.index}])` };
    if (earlier.isStatic && later.isStatic) errors.push(entry);
    else warnings.push({ ...entry, message: `${entry.message}; at least one object is dynamic` });
  }

  // Waypoints inside static obstacles (warning only)
  waypoints.forEach((w, i) => {
    const [x, y, z] = w.position;
    for (const b of boxes) {
      if (b.isStatic && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y >= b.minY - EPS && y < b.maxY) {
        warnings.push({ path: `navigation.waypoints[${i}].position`, code: "WAYPOINT_IN_OBSTACLE", message: `Waypoint ${w.id} lies inside ${b.id}` });
        break;
      }
    }
  });

  const valid = errors.length === 0;
  return { result: { valid, errors, warnings }, spec: valid ? spec : null };
}

export function validateEnvironmentSpec(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  return validateAndParse(input, opts).result;
}

export type { ValidationResult, ValidationError, ValidationWarning };
