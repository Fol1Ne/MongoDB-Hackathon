export { SIM, SIM_VERSION, type SimConfig } from "./config";
export { ROBOTS, ROBOT_IDS, getRobot, isRobotId, type RobotId, type RobotProfile } from "./robots";
export { RUN_REASONS, type LegResult, type RunReason, type Sample, type SimResult } from "./types";
export { simulate } from "./simulate";
export { compareLatest, hotspots, summarize, type CompareInput, type CompareRow, type Hotspot, type RunSummary } from "./metrics";
