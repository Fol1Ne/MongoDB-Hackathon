import type { SimConfig } from "./config";
import { distance, rectDistance, type Point, type World } from "./world";

/**
 * Occupancy grid with an inflation costmap. A cell is free when its centre is at least R (robot radius + padding)
 * from every obstacle and wall; cells near obstacles cost more, so paths keep their distance when there is room.
 */
export class Grid {
  readonly nx: number;
  readonly nz: number;
  readonly clear: Float64Array;
  readonly free: Uint8Array;
  readonly mult: Float64Array;

  constructor(readonly world: World, readonly R: number, cfg: SimConfig, width: number, length: number, readonly h: number) {
    this.nx = Math.max(1, Math.ceil(width / h - 1e-9));
    this.nz = Math.max(1, Math.ceil(length / h - 1e-9));
    const n = this.nx * this.nz;
    this.clear = new Float64Array(n);
    this.free = new Uint8Array(n);
    this.mult = new Float64Array(n);
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        this.clear[iz * this.nx + ix] = Math.min(world.cap, world.wallDistance(this.cx(ix), this.cz(iz)));
      }
    }
    for (const o of world.obstacles) {
      const x0 = this.lo(o.minX - world.cap, world.halfW, this.nx), x1 = this.hi(o.maxX + world.cap, world.halfW, this.nx);
      const z0 = this.lo(o.minZ - world.cap, world.halfL, this.nz), z1 = this.hi(o.maxZ + world.cap, world.halfL, this.nz);
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const i = iz * this.nx + ix;
          const d = rectDistance(o, this.cx(ix), this.cz(iz));
          if (d < this.clear[i]!) this.clear[i] = d;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const c = this.clear[i]!;
      this.free[i] = c >= R ? 1 : 0;
      this.mult[i] = 1 + cfg.inflationCost * Math.max(0, 1 - (c - R) / cfg.inflationM);
    }
  }

  cx(ix: number) { return -this.world.halfW + (ix + 0.5) * this.h; }
  cz(iz: number) { return -this.world.halfL + (iz + 0.5) * this.h; }
  centre(i: number): Point { const ix = i % this.nx; return { x: this.cx(ix), z: this.cz((i - ix) / this.nx) }; }

  /** First cell whose centre is ≥ v (clamped). */
  private lo(v: number, half: number, n: number) { return Math.min(n - 1, Math.max(0, Math.ceil((v + half) / this.h - 0.5))); }
  /** Last cell whose centre is ≤ v (clamped). */
  private hi(v: number, half: number, n: number) { return Math.min(n - 1, Math.max(0, Math.floor((v + half) / this.h - 0.5))); }

  cellOf(x: number, z: number): number {
    const ix = Math.min(this.nx - 1, Math.max(0, Math.floor((x + this.world.halfW) / this.h)));
    const iz = Math.min(this.nz - 1, Math.max(0, Math.floor((z + this.world.halfL) / this.h)));
    return iz * this.nx + ix;
  }

  /** Free cells whose centres lie within `radius` of p, nearest first (ties by index). */
  freeCellsNear(p: Point, radius: number): number[] {
    const x0 = this.lo(p.x - radius, this.world.halfW, this.nx), x1 = this.hi(p.x + radius, this.world.halfW, this.nx);
    const z0 = this.lo(p.z - radius, this.world.halfL, this.nz), z1 = this.hi(p.z + radius, this.world.halfL, this.nz);
    const found: [number, number][] = [];
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const i = iz * this.nx + ix;
        const d = distance(p, { x: this.cx(ix), z: this.cz(iz) });
        if (this.free[i] && d <= radius) found.push([d, i]);
      }
    }
    return found.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
  }
}

/** Binary min-heap of (f, h, cell) entries, ordered by f, then h, then cell index (deterministic ties). */
class MinHeap {
  private readonly f: number[] = [];
  private readonly h: number[] = [];
  private readonly c: number[] = [];
  get size() { return this.c.length; }
  private less(a: number, b: number) {
    const fa = this.f[a]!, fb = this.f[b]!;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a]!, hb = this.h[b]!;
    if (ha !== hb) return ha < hb;
    return this.c[a]! < this.c[b]!;
  }
  private swap(a: number, b: number) {
    [this.f[a], this.f[b]] = [this.f[b]!, this.f[a]!];
    [this.h[a], this.h[b]] = [this.h[b]!, this.h[a]!];
    [this.c[a], this.c[b]] = [this.c[b]!, this.c[a]!];
  }
  push(f: number, h: number, cell: number) {
    this.f.push(f); this.h.push(h); this.c.push(cell);
    for (let i = this.c.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.c[0]!;
    this.swap(0, this.c.length - 1);
    this.f.pop(); this.h.pop(); this.c.pop();
    for (let i = 0, n = this.c.length; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

const STEPS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * 8-connected A* without corner cutting. Edge cost is the step length times the mean inflation cost of the two cells.
 * When the search runs out of cells, returns the path to the explored cell nearest `target`.
 */
export function astar(grid: Grid, start: number, isGoal: Uint8Array, target: Point, hTol: number): { cells: number[]; reached: boolean } {
  const { nx, nz, h, free, mult } = grid;
  const n = nx * nz;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heuristic = (i: number) => Math.max(0, distance(grid.centre(i), target) - hTol);
  const trace = (end: number) => {
    const cells: number[] = [];
    for (let c = end; c !== -1; c = came[c]!) cells.push(c);
    return cells.reverse();
  };
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(heuristic(start), heuristic(start), start);
  while (heap.size > 0) {
    const i = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (isGoal[i]) return { cells: trace(i), reached: true };
    const ix = i % nx, iz = (i - ix) / nx;
    for (const [dx, dz] of STEPS) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (!free[j] || closed[j]) continue;
      const diagonal = dx !== 0 && dz !== 0;
      if (diagonal && (!free[iz * nx + jx] || !free[jz * nx + ix])) continue;
      const cost = g[i]! + (diagonal ? Math.SQRT2 : 1) * h * (mult[i]! + mult[j]!) / 2;
      if (cost < g[j]!) {
        g[j] = cost;
        came[j] = i;
        const hj = heuristic(j);
        heap.push(cost + hj, hj, j);
      }
    }
  }
  let best = start, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (!closed[i]) continue;
    const d = distance(grid.centre(i), target);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { cells: trace(best), reached: false };
}

/** True when the clearance sampled every h/4 along p→q never drops below `threshold`. */
function lineClear(grid: Grid, p: Point, q: Point, threshold: number): boolean {
  const dx = q.x - p.x, dz = q.z - p.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const step = grid.h / 4;
  for (let s = 1, n = Math.floor(len / step); s <= n; s++) {
    const t = (s * step) / len;
    if (grid.world.near(p.x + dx * t, p.z + dz * t) < threshold) return false;
  }
  return true;
}

/**
 * Greedy line-of-sight smoothing. From each anchor, take the farthest point reachable by a straight shortcut that never
 * gets closer to obstacles than min(R + inflation, the clearance of the cells it replaces).
 */
export function smooth(points: Point[], clearances: number[], grid: Grid, cfg: SimConfig): Point[] {
  if (points.length <= 2) return points.slice();
  const out: Point[] = [points[0]!];
  const limit = grid.R + cfg.inflationM;
  for (let a = 0; a < points.length - 1;) {
    let k = a + 1;
    let replaced = Infinity;
    for (let j = a + 2; j < points.length; j++) {
      replaced = Math.min(replaced, clearances[j - 1]!);
      if (!lineClear(grid, points[a]!, points[j]!, Math.min(limit, replaced))) break;
      k = j;
    }
    out.push(points[k]!);
    a = k;
  }
  return out;
}

/** Move from `from` toward `to` in small steps while the clearance stays ≥ R; snap onto `to` if it is clear. */
export function creep(world: World, from: Point, to: Point, R: number, stepM: number): Point {
  const d = distance(from, to);
  if (d === 0) return from;
  const ux = (to.x - from.x) / d, uz = (to.z - from.z) / d;
  let cur = from;
  for (let s = 1, n = Math.floor(d / stepM); s <= n; s++) {
    const p = { x: from.x + ux * s * stepM, z: from.z + uz * s * stepM };
    if (world.near(p.x, p.z) < R) return cur;
    cur = p;
  }
  return world.near(to.x, to.z) >= R ? { x: to.x, z: to.z } : cur;
}

export interface LegPlan {
  /** Driven polyline, starting at the robot's position */
  points: Point[];
  reached: boolean;
  /** No free cell could ever count as arriving (the waypoint is too tight for this robot) */
  goalEmpty: boolean;
}

/**
 * Plans one leg. The goal is the waypoint's own cell when the waypoint is clear for the robot; otherwise any free cell
 * within the goal tolerance. The robot then drives onto the waypoint (clear) or creeps toward it (not clear, or blocked).
 */
export function planLeg(grid: Grid, from: Point, to: Point, cfg: SimConfig): LegPlan {
  const { nx, nz, world, R } = grid;
  const isGoal = new Uint8Array(nx * nz);
  let goals = 0;
  let exact = world.near(to.x, to.z) >= R;
  if (exact) {
    const c = grid.cellOf(to.x, to.z);
    if (grid.free[c]) {
      isGoal[c] = 1;
      goals = 1;
    } else {
      const cx = c % nx, cz = (c - cx) / nx;
      for (const [dx, dz] of STEPS) {
        const jx = cx + dx, jz = cz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (grid.free[j]) { isGoal[j] = 1; goals++; }
      }
    }
    if (goals === 0) exact = false;
  }
  if (!exact) {
    for (const c of grid.freeCellsNear(to, cfg.goalToleranceM)) { isGoal[c] = 1; goals++; }
  }
  const search = astar(grid, grid.cellOf(from.x, from.z), isGoal, to, exact ? 0 : cfg.goalToleranceM);
  const tail = search.cells.slice(1);
  // A clear waypoint is the final point before smoothing, so the shortcut pass can skip the goal cell's centre
  // instead of driving past the waypoint and back.
  const onTarget = search.reached && exact;
  const points = smooth(
    [from, ...tail.map((c) => grid.centre(c)), ...(onTarget ? [{ x: to.x, z: to.z }] : [])],
    [world.near(from.x, from.z), ...tail.map((c) => grid.clear[c]!), ...(onTarget ? [world.near(to.x, to.z)] : [])],
    grid,
    cfg,
  );
  if (!onTarget) {
    const last = points[points.length - 1]!;
    const end = creep(world, last, to, R, cfg.creepStepM);
    if (end !== last) points.push(end);
  }
  return { points, reached: search.reached, goalEmpty: goals === 0 };
}
