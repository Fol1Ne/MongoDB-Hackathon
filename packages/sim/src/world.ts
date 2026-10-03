import type { AssetDefinition, EnvironmentSpec } from "@twin/schema";
import { DEFAULT_ASSET_MAP, type AssetMap } from "@twin/catalogue";
import { computeBox } from "@twin/validator";

export interface Point { x: number; z: number }
export interface Obstacle { id: string; minX: number; maxX: number; minZ: number; maxZ: number }

const UNKNOWN_ASSET: AssetDefinition = { type: "unknown", name: "Unknown asset", footprint: [1, 1], height: 1, collision: "box", tags: [] };

/** Distance from a point to an axis-aligned rectangle; 0 inside it. */
export function rectDistance(o: Obstacle, x: number, z: number): number {
  const dx = x < o.minX ? o.minX - x : x > o.maxX ? x - o.maxX : 0;
  const dz = z < o.minZ ? o.minZ - z : z > o.maxZ ? z - o.maxZ : 0;
  return dx === 0 && dz === 0 ? 0 : Math.sqrt(dx * dx + dz * dz);
}

export const distance = (a: Point, b: Point) => Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);

/**
 * The robot's 2D world: the footprints (`computeBox`) of objects that reach into [0, robotHeight), plus the floor's walls.
 * `near()` is exact below `cap` and returns `cap` above it, using a bucket grid so scenes with thousands of objects stay fast.
 * Every planning threshold is below `cap`, so planning decisions match exact clearance.
 */
export class World {
  readonly halfW: number;
  readonly halfL: number;
  readonly obstacles: Obstacle[] = [];
  private readonly bucketM: number;
  private readonly nbx: number;
  private readonly nbz: number;
  private readonly buckets: Obstacle[][];

  constructor(spec: EnvironmentSpec, robotHeight: number, readonly cap: number, assets: AssetMap = DEFAULT_ASSET_MAP) {
    const { width, length } = spec.environment.dimensions;
    this.halfW = width / 2;
    this.halfL = length / 2;
    spec.objects.forEach((o, i) => {
      const b = computeBox(o, assets.get(o.type) ?? UNKNOWN_ASSET, i);
      if (b.minY >= robotHeight || b.maxY <= 0) return; // the robot passes under or over it
      this.obstacles.push({ id: o.id, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    });
    this.bucketM = Math.max(2, cap);
    this.nbx = Math.max(1, Math.ceil(width / this.bucketM));
    this.nbz = Math.max(1, Math.ceil(length / this.bucketM));
    this.buckets = Array.from({ length: this.nbx * this.nbz }, () => []);
    for (const o of this.obstacles) {
      const x0 = this.bucket(o.minX - cap, this.halfW, this.nbx), x1 = this.bucket(o.maxX + cap, this.halfW, this.nbx);
      const z0 = this.bucket(o.minZ - cap, this.halfL, this.nbz), z1 = this.bucket(o.maxZ + cap, this.halfL, this.nbz);
      for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) this.buckets[bz * this.nbx + bx]!.push(o);
    }
  }

  private bucket(v: number, half: number, n: number): number {
    return Math.min(n - 1, Math.max(0, Math.floor((v + half) / this.bucketM)));
  }

  wallDistance(x: number, z: number): number {
    return Math.max(0, Math.min(x + this.halfW, this.halfW - x, z + this.halfL, this.halfL - z));
  }

  /** Clearance, exact when below `cap`, otherwise `cap`. */
  near(x: number, z: number): number {
    let c = Math.min(this.cap, this.wallDistance(x, z));
    if (c === 0) return 0;
    const bucket = this.buckets[this.bucket(z, this.halfL, this.nbz) * this.nbx + this.bucket(x, this.halfW, this.nbx)]!;
    for (const o of bucket) {
      const d = rectDistance(o, x, z);
      if (d < c) {
        c = d;
        if (c === 0) return 0;
      }
    }
    return c;
  }

  /** Exact distance to the nearest obstacle or wall; 0 inside an obstacle or off the floor. */
  clearance(x: number, z: number): number {
    const c = this.near(x, z);
    if (c < this.cap) return c;
    let best = this.wallDistance(x, z);
    for (const o of this.obstacles) best = Math.min(best, rectDistance(o, x, z));
    return best;
  }

  /** The obstacle closest to a point, or null when a floor wall is closer than every obstacle. */
  nearestObstacle(x: number, z: number): string | null {
    let best: string | null = null;
    let bestD = this.wallDistance(x, z);
    for (const o of this.obstacles) {
      const d = rectDistance(o, x, z);
      if (d < bestD) { bestD = d; best = o.id; }
    }
    return best;
  }
}
