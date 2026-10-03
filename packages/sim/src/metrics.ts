import { SIM } from "./config";
import type { RobotId } from "./robots";
import type { RunReason, Sample } from "./types";

// JS references for the MongoDB aggregation pipelines (apps/api/src/runPipelines.ts). The API computes these numbers in
// MongoDB; tests check the two agree, and the offline web mock uses these directly.

export interface RunSummary {
  durationSec: number; pathLengthM: number; avgSpeed: number; peakSpeed: number;
  minObstacleDist: number; nearMissSec: number; collisions: number; samples: number;
}

export interface Hotspot { x: number; z: number; seconds: number; minObstacleDist: number }

const ms = (t: number) => Math.round(t * 1000); // the API stores ts = startedAt + Math.round(t * 1000) ms

/** Mirrors the summary pipeline: $integral (trapezoid rule) of speed over time, plus $group statistics. */
export function summarize(samples: readonly Sample[], o: { nearMissM?: number; dtSec?: number } = {}): RunSummary | null {
  const first = samples[0];
  if (!first) return null;
  const nearMissM = o.nearMissM ?? SIM.nearMissM;
  const dtSec = o.dtSec ?? 1 / SIM.sampleHz;
  let pathLengthM = 0, peakSpeed = -Infinity, minObstacleDist = Infinity, nearMiss = 0, collisions = 0;
  samples.forEach((s, i) => {
    if (i > 0) {
      const prev = samples[i - 1]!;
      pathLengthM += ((ms(s.t) - ms(prev.t)) / 1000) * ((prev.speed + s.speed) / 2);
    }
    peakSpeed = Math.max(peakSpeed, s.speed);
    minObstacleDist = Math.min(minObstacleDist, s.minObstacleDist);
    if (s.minObstacleDist < nearMissM) nearMiss++;
    if (s.minObstacleDist < 0) collisions++;
  });
  const durationSec = (ms(samples[samples.length - 1]!.t) - ms(first.t)) / 1000;
  return {
    durationSec, pathLengthM, avgSpeed: durationSec > 0 ? pathLengthM / durationSec : 0, peakSpeed,
    minObstacleDist, nearMissSec: nearMiss * dtSec, collisions, samples: samples.length,
  };
}

/** Mirrors the hotspot facet: near-miss samples binned into square cells, most time first. */
export function hotspots(
  samples: readonly Sample[],
  o: { nearMissM?: number; cellM?: number; dtSec?: number; max?: number } = {},
): Hotspot[] {
  const nearMissM = o.nearMissM ?? SIM.nearMissM, cellM = o.cellM ?? SIM.hotspotCellM;
  const dtSec = o.dtSec ?? 1 / SIM.sampleHz, max = o.max ?? SIM.maxHotspots;
  const cells = new Map<string, { gx: number; gz: number; n: number; min: number }>();
  for (const s of samples) {
    if (!(s.minObstacleDist < nearMissM)) continue;
    const gx = Math.floor(s.x / cellM), gz = Math.floor(s.z / cellM);
    const key = `${gx},${gz}`;
    const cell = cells.get(key);
    if (cell) { cell.n++; cell.min = Math.min(cell.min, s.minObstacleDist); }
    else cells.set(key, { gx, gz, n: 1, min: s.minObstacleDist });
  }
  return [...cells.values()]
    .map((c) => ({ x: (c.gx + 0.5) * cellM, z: (c.gz + 0.5) * cellM, seconds: c.n * dtSec, minObstacleDist: c.min }))
    .sort((a, b) => b.seconds - a.seconds || a.minObstacleDist - b.minObstacleDist || a.x - b.x || a.z - b.z)
    .slice(0, max);
}

export interface CompareInput {
  id: string; robotId: RobotId; version: number; createdAt: string;
  success: boolean; reason: RunReason; summary: RunSummary | null;
}

export interface CompareRow {
  runId: string; robotId: RobotId; version: number; createdAt: string; success: boolean; reason: RunReason;
  durationSec: number | null; pathLengthM: number | null; minObstacleDist: number | null; nearMissSec: number | null;
  prevVersion: number | null;
  change: "first" | "same" | "fixed" | "regressed";
  /** Current minus previous version; only when both runs succeeded (a blocked run's partial path isn't comparable) */
  delta: { durationSec: number | null; pathLengthM: number | null; minObstacleDist: number | null };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Mirrors the compare pipeline: the latest run per (robot, version), each compared with the robot's previous version. */
export function compareLatest(runs: readonly CompareInput[]): CompareRow[] {
  const latest = new Map<string, CompareInput>();
  for (const r of [...runs].sort((a, b) => cmp(b.createdAt, a.createdAt) || cmp(b.id, a.id))) {
    const key = `${r.robotId}|${r.version}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const byRobot = new Map<RobotId, CompareInput[]>();
  for (const r of latest.values()) byRobot.set(r.robotId, [...(byRobot.get(r.robotId) ?? []), r]);
  const rows: CompareRow[] = [];
  for (const list of byRobot.values()) {
    list.sort((a, b) => a.version - b.version);
    list.forEach((r, i) => {
      const prev = i > 0 ? list[i - 1]! : null;
      const both = prev !== null && prev.success && r.success && prev.summary !== null && r.summary !== null;
      const delta = (k: "durationSec" | "pathLengthM" | "minObstacleDist") => (both ? r.summary![k] - prev!.summary![k] : null);
      rows.push({
        runId: r.id, robotId: r.robotId, version: r.version, createdAt: r.createdAt, success: r.success, reason: r.reason,
        durationSec: r.summary?.durationSec ?? null, pathLengthM: r.summary?.pathLengthM ?? null,
        minObstacleDist: r.summary?.minObstacleDist ?? null, nearMissSec: r.summary?.nearMissSec ?? null,
        prevVersion: prev?.version ?? null,
        change: !prev ? "first" : prev.success && !r.success ? "regressed" : !prev.success && r.success ? "fixed" : "same",
        delta: { durationSec: delta("durationSec"), pathLengthM: delta("pathLengthM"), minObstacleDist: delta("minObstacleDist") },
      });
    });
  }
  return rows.sort((a, b) => b.version - a.version || cmp(a.robotId, b.robotId));
}
