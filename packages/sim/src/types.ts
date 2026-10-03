import type { RobotId } from "./robots";

/** One telemetry sample (PLAN.md §11.4 field names). */
export interface Sample {
  /** Seconds since the run started */
  t: number;
  x: number;
  z: number;
  /** three.js rotation.y; 0 faces +X */
  heading: number;
  /** Distance moved since the previous sample ÷ dt, m/s */
  speed: number;
  /** Gap between the robot's body and the nearest obstacle or wall, metres */
  minObstacleDist: number;
  /** Index of the route leg being driven */
  leg: number;
}

export const RUN_REASONS = ["completed", "blocked", "goal_unreachable", "start_blocked", "low_friction", "no_waypoints"] as const;
export type RunReason = (typeof RUN_REASONS)[number];

export interface LegResult { from: string; to: string; status: "reached" | "blocked" | "skipped"; stopOffsetM: number | null }

export interface SimResult {
  robotId: RobotId;
  success: boolean;
  reason: RunReason;
  message: string;
  blocked: { leg: number; from: string; to: string; at: [number, number]; nearestObstacle: string | null } | null;
  waypoints: string[];
  legs: LegResult[];
  /** The driven polyline, [x, z] vertices */
  path: [number, number][];
  samples: Sample[];
  simulator: { name: "twin-sim-2d"; version: string; cellSize: number; sampleHz: number };
}
