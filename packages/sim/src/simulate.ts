import type { EnvironmentSpec } from "@twin/schema";
import { SIM, SIM_VERSION, type SimConfig } from "./config";
import { sampleMotion, type DriveLeg } from "./motion";
import { Grid, planLeg } from "./planner";
import { ROBOTS, type RobotId, type RobotProfile } from "./robots";
import type { LegResult, RunReason, SimResult } from "./types";
import { World, distance, type Point } from "./world";

const fmt = (n: number) => n.toFixed(2);

/**
 * twin-sim-2d: drives a robot along the spec's waypoints, in order, on a 2D occupancy grid. Deterministic and
 * browser-safe; a fast pre-check before a full Isaac Sim run, with telemetry in PLAN.md §11.4's shape.
 */
export function simulate(spec: EnvironmentSpec, robotOrId: RobotId | RobotProfile, opts: Partial<SimConfig> = {}): SimResult {
  const robot = typeof robotOrId === "string" ? ROBOTS[robotOrId] : robotOrId;
  if (!robot) throw new Error(`Unknown robot "${String(robotOrId)}"`);
  const cfg: SimConfig = { ...SIM, ...opts };
  const { width, length } = spec.environment.dimensions;
  const cellSize = Math.max(cfg.cellSizeM, Math.max(width, length) / cfg.maxCellsPerAxis);
  const wps = spec.navigation?.waypoints ?? [];
  const base = {
    robotId: robot.id,
    waypoints: wps.map((w) => w.id),
    simulator: { name: "twin-sim-2d" as const, version: SIM_VERSION, cellSize, sampleHz: cfg.sampleHz },
  };
  const skipped = (from: number): LegResult[] =>
    wps.slice(from + 1).map((w, i) => ({ from: wps[from + i]!.id, to: w.id, status: "skipped", stopOffsetM: null }));
  const fail = (reason: RunReason, message: string): SimResult =>
    ({ ...base, success: false, reason, message, blocked: null, legs: skipped(0), path: [], samples: [] });

  if (wps.length < 2) return fail("no_waypoints", "Add at least 2 waypoints to simulate a route");
  const friction = spec.terrain.properties.friction;
  if (friction < robot.minFriction) {
    return fail("low_friction", `Floor friction ${friction} is below ${robot.name}'s minimum of ${robot.minFriction}`);
  }

  const R = robot.radius + cfg.paddingM;
  const world = new World(spec, robot.height, R + Math.max(cfg.inflationM, cfg.slowdownM) + 2 * cellSize);
  const grid = new Grid(world, R, cfg, width, length, cellSize);
  const at = (i: number): Point => ({ x: wps[i]!.position[0], z: wps[i]!.position[2] });

  const start = at(0);
  const startCell = grid.free[grid.cellOf(start.x, start.z)] ? null : grid.freeCellsNear(start, cfg.goalToleranceM)[0];
  if (startCell === undefined) return fail("start_blocked", `${wps[0]!.id} is too close to an obstacle for ${robot.name} to start there`);
  let pos = startCell === null ? start : grid.centre(startCell);

  const drive: DriveLeg[] = [];
  const legs: LegResult[] = [];
  const path: [number, number][] = [[pos.x, pos.z]];
  let blocked: SimResult["blocked"] = null;
  let reason: RunReason = "completed";
  let message = `Reached all ${wps.length} waypoints`;
  for (let i = 0; i + 1 < wps.length; i++) {
    const from = wps[i]!.id, to = wps[i + 1]!.id, target = at(i + 1);
    const plan = planLeg(grid, pos, target, cfg);
    drive.push({ leg: i, points: plan.points });
    for (const p of plan.points.slice(1)) {
      const prev = path[path.length - 1]!;
      if (prev[0] !== p.x || prev[1] !== p.z) path.push([p.x, p.z]);
    }
    pos = plan.points[plan.points.length - 1]!;
    const stopOffsetM = distance(pos, target);
    if (plan.reached) {
      legs.push({ from, to, status: "reached", stopOffsetM });
      continue;
    }
    legs.push({ from, to, status: "blocked", stopOffsetM }, ...skipped(i + 1));
    if (plan.goalEmpty) {
      reason = "goal_unreachable";
      const culprit = world.nearestObstacle(target.x, target.z);
      blocked = { leg: i, from, to, at: [pos.x, pos.z], nearestObstacle: culprit };
      message = `Can't reach ${to}: it sits ${fmt(world.clearance(target.x, target.z))} m from ${culprit ?? "the wall"}, ` +
        `and ${robot.name} needs ${fmt(R)} m`;
    } else {
      reason = "blocked";
      const culprit = world.nearestObstacle(pos.x, pos.z);
      blocked = { leg: i, from, to, at: [pos.x, pos.z], nearestObstacle: culprit };
      message = `Blocked between ${from} and ${to}: no gap is wide enough for ${robot.name}` +
        (culprit ? `; stopped ${fmt(stopOffsetM)} m short, next to ${culprit}` : "");
    }
    break;
  }
  const samples = sampleMotion(drive, {
    world, R, radius: robot.radius, maxSpeed: robot.maxSpeed, maxTurnRate: robot.maxTurnRate, cfg, blocked: blocked !== null,
  });
  return { ...base, success: blocked === null, reason, message, blocked, legs, path, samples };
}
