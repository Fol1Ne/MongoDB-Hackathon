export const ROBOT_IDS = ["amr_01", "agv_p2"] as const;
export type RobotId = (typeof ROBOT_IDS)[number];

export interface RobotProfile {
  id: RobotId; name: string; kind: string;
  /** Footprint radius, metres */
  radius: number;
  /** Objects whose underside is above this height don't block the robot */
  height: number;
  maxSpeed: number;
  /** rad/s, for turning in place */
  maxTurnRate: number;
  /** The robot won't drive on floors with less friction than this */
  minFriction: number;
}

export const ROBOTS: Readonly<Record<RobotId, RobotProfile>> = Object.freeze({
  // PLAN.md §15.1
  amr_01: { id: "amr_01", name: "AMR-01", kind: "Autonomous mobile robot", radius: 0.35, height: 1.0, maxSpeed: 1.5, maxTurnRate: 2.0, minFriction: 0.5 },
  agv_p2: { id: "agv_p2", name: "AGV-P2", kind: "Pallet AGV, 1.4 × 1.0 m", radius: 0.85, height: 1.2, maxSpeed: 1.2, maxTurnRate: 1.0, minFriction: 0.7 },
});

export const isRobotId = (v: unknown): v is RobotId => typeof v === "string" && (ROBOT_IDS as readonly string[]).includes(v);
export const getRobot = (id: string): RobotProfile | undefined => (isRobotId(id) ? ROBOTS[id] : undefined);
