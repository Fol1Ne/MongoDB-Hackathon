import type { SimConfig } from "./config";
import type { Sample } from "./types";
import type { Point, World } from "./world";

export interface DriveLeg { leg: number; points: Point[] }

const TWO_PI = 2 * Math.PI;
/** Normalises an angle to (−π, π]. */
function wrap(a: number): number {
  let r = a % TWO_PI;
  if (r <= -Math.PI) r += TWO_PI;
  else if (r > Math.PI) r -= TWO_PI;
  return r;
}
const headingOf = (dx: number, dz: number) => Math.atan2(-dz, dx); // three.js rotation.y of a +X-facing body

/**
 * Samples the drive at a fixed rate: turn in place, then drive each segment at a speed that drops near obstacles,
 * stopping on every vertex. Speed is distance moved ÷ dt, and the first and last samples are at rest, so the
 * trapezoid integral of speed (MongoDB's $integral) equals the driven path length exactly.
 */
export function sampleMotion(
  legs: DriveLeg[],
  o: { world: World; R: number; radius: number; maxSpeed: number; maxTurnRate: number; cfg: SimConfig; blocked: boolean },
): Sample[] {
  const { world, cfg } = o;
  const samples: Sample[] = [];
  const start = legs[0]?.points[0];
  if (!start) return samples;
  const dt = 1 / cfg.sampleHz;
  let x = start.x, z = start.z, leg = legs[0]!.leg;
  let heading = 0;
  outer: for (const l of legs) {
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1]!, b = l.points[i]!;
      if (a.x !== b.x || a.z !== b.z) { heading = headingOf(b.x - a.x, b.z - a.z); break outer; }
    }
  }
  const push = (speed: number) =>
    samples.push({ t: samples.length / cfg.sampleHz, x, z, heading, speed, minObstacleDist: world.clearance(x, z) - o.radius, leg });

  push(0);
  for (const l of legs) {
    leg = l.leg;
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1]!, b = l.points[i]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-9) continue;
      const target = headingOf(dx, dz);
      const maxTurn = o.maxTurnRate * dt;
      for (let diff = wrap(target - heading); Math.abs(diff) > 1e-9; diff = wrap(target - heading)) {
        heading = Math.abs(diff) <= maxTurn ? target : wrap(heading + Math.sign(diff) * maxTurn);
        push(0);
      }
      heading = target;
      for (let travelled = 0; len - travelled > 1e-9;) {
        const factor = Math.min(1, Math.max(cfg.minSpeedFactor, (world.near(x, z) - o.R) / cfg.slowdownM));
        const d = Math.min(o.maxSpeed * factor * dt, len - travelled);
        travelled += d;
        if (len - travelled <= 1e-9) { x = b.x; z = b.z; }
        else { x = a.x + dx * (travelled / len); z = a.z + dz * (travelled / len); }
        push(d / dt);
      }
    }
  }
  const rest = o.blocked ? Math.round(cfg.blockedDwellSec * cfg.sampleHz) : 1;
  for (let k = 0; k < rest; k++) push(0);
  return samples;
}
