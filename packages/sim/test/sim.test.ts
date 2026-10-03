import { describe, expect, it } from "vitest";
import { ROBOTS, SIM, compareLatest, hotspots, simulate, summarize, type RunSummary, type Sample } from "../src";
import { drivenLength, gapScene, obj, scene } from "./helpers";

describe("simulate", () => {
  it("drives straight across an open floor and stops exactly on the last waypoint", () => {
    const r = simulate(scene(), "amr_01");
    expect(r).toMatchObject({ success: true, reason: "completed", blocked: null, waypoints: ["wp_a", "wp_b"] });
    expect(r.legs).toEqual([{ from: "wp_a", to: "wp_b", status: "reached", stopOffsetM: 0 }]);
    const first = r.samples[0]!, last = r.samples.at(-1)!;
    expect([first.x, first.z, first.speed]).toEqual([-5, -5, 0]);
    expect([last.x, last.z, last.speed]).toEqual([5, 5, 0]);
    const straight = Math.sqrt(200);
    expect(drivenLength(r.samples)).toBeGreaterThanOrEqual(straight - 1e-9);
    expect(drivenLength(r.samples)).toBeLessThan(straight * 1.01);
    expect(Math.max(...r.samples.map((s) => s.speed))).toBeLessThanOrEqual(ROBOTS.amr_01.maxSpeed + 1e-9);
    r.samples.forEach((s, i) => expect(s.t).toBe(i / SIM.sampleHz));
    expect(r.simulator).toMatchObject({ name: "twin-sim-2d", cellSize: 0.25, sampleHz: 10 });
  });

  it("squeezes AMR-01 through a 1.1 m gap (a near-miss hotspot) but blocks the wide AGV", () => {
    const amr = simulate(gapScene(), "amr_01");
    expect(amr).toMatchObject({ success: true, reason: "completed" });
    expect(hotspots(amr.samples).some((h) => Math.sqrt(h.x * h.x + h.z * h.z) < 1.5)).toBe(true);

    const agv = simulate(gapScene(), "agv_p2");
    expect(agv).toMatchObject({ success: false, reason: "blocked", blocked: { leg: 0, from: "wp_a", to: "wp_b" } });
    expect(["wall_left", "wall_right"]).toContain(agv.blocked!.nearestObstacle);
    expect(agv.legs[0]).toMatchObject({ status: "blocked" });
    expect(agv.samples.length).toBeGreaterThan(SIM.blockedDwellSec * SIM.sampleHz);
    expect(agv.samples.slice(-SIM.blockedDwellSec * SIM.sampleHz).every((s) => s.speed === 0)).toBe(true);
    expect(agv.samples.at(-1)!.z).toBeLessThan(0); // stopped on the near side of the wall
  });

  it("is deterministic", () => {
    expect(simulate(gapScene(), "amr_01")).toEqual(simulate(gapScene(), "amr_01"));
  });

  it("skips the route with a reason and no samples when it can't start", () => {
    expect(simulate(scene({ waypoints: [["wp_a", 0, 0]] }), "amr_01")).toMatchObject({ success: false, reason: "no_waypoints", samples: [] });
    const noNav = scene();
    delete noNav.navigation;
    expect(simulate(noNav, "amr_01")).toMatchObject({ success: false, reason: "no_waypoints", samples: [] });
    const boxedIn = scene({ objects: [obj("dock_a", "loading_dock", -5, -5)] }); // wp_a sits 1.5 m inside the dock
    expect(simulate(boxedIn, "amr_01")).toMatchObject({ success: false, reason: "start_blocked", samples: [] });
    expect(simulate(scene({ friction: 0.6 }), "agv_p2")).toMatchObject({ success: false, reason: "low_friction", samples: [] });
    expect(simulate(scene({ friction: 0.6 }), "amr_01").success).toBe(true);
  });

  it("stays fast on a 1000 × 1000 m floor with 2000 objects", () => {
    const crates = Array.from({ length: 2000 }, (_, k) => obj(`crate_${k}`, "crate", -450 + (k % 50) * 18, -450 + Math.floor(k / 50) * 22));
    const big = scene({ width: 1000, length: 1000, objects: crates, waypoints: [["wp_a", -480, -480], ["wp_b", 480, 480]] });
    const t0 = performance.now();
    const r = simulate(big, "amr_01");
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.success).toBe(true);
  });
});

const sample = (x: number, z: number, minObstacleDist: number): Sample => ({ t: 0, x, z, heading: 0, speed: 0, minObstacleDist, leg: 0 });

describe("summarize (the JS reference for the MongoDB summary pipeline)", () => {
  it("integrates speed with the trapezoid rule, which equals the driven path length", () => {
    const s = simulate(gapScene(), "amr_01").samples;
    const sum = summarize(s)!;
    expect(Math.abs(sum.pathLengthM - drivenLength(s))).toBeLessThan(1e-9);
    expect(sum.durationSec).toBeCloseTo((s.length - 1) / SIM.sampleHz, 12);
    expect(sum).toMatchObject({ samples: s.length, collisions: 0 });
    expect(sum.avgSpeed).toBeCloseTo(sum.pathLengthM / sum.durationSec, 12);
    expect(sum.nearMissSec).toBeGreaterThan(0);
    expect(summarize([])).toBeNull();
  });
});

describe("hotspots", () => {
  it("bins near-misses into 1 m cells with floor semantics, most time first", () => {
    const hs = hotspots([sample(-0.5, -0.2, 0.1), sample(-0.4, -0.9, 0.2), sample(0.5, 0.5, 0.1), sample(3, 3, 0.9)]);
    expect(hs).toEqual([
      { x: -0.5, z: -0.5, seconds: 0.2, minObstacleDist: 0.1 },
      { x: 0.5, z: 0.5, seconds: 0.1, minObstacleDist: 0.1 },
    ]);
  });
});

describe("compareLatest (the JS reference for the compare pipeline)", () => {
  const sum = (pathLengthM: number, durationSec: number, minObstacleDist: number): RunSummary => ({
    durationSec, pathLengthM, avgSpeed: pathLengthM / durationSec, peakSpeed: 1, minObstacleDist, nearMissSec: 0, collisions: 0, samples: 10,
  });
  const runs = [
    { id: "a1", robotId: "agv_p2", version: 1, createdAt: "2026-10-03T12:00:00.000Z", success: false, reason: "goal_unreachable", summary: sum(20, 30, 0.05) },
    { id: "a2", robotId: "agv_p2", version: 2, createdAt: "2026-10-03T12:05:00.000Z", success: true, reason: "completed", summary: sum(56, 54, 0.53) },
    { id: "m1", robotId: "amr_01", version: 1, createdAt: "2026-10-03T12:00:00.000Z", success: true, reason: "completed", summary: sum(55, 43, 0.05) },
    { id: "m1b", robotId: "amr_01", version: 1, createdAt: "2026-10-03T12:01:00.000Z", success: true, reason: "completed", summary: sum(55.5, 43.5, 0.05) },
    { id: "m2", robotId: "amr_01", version: 2, createdAt: "2026-10-03T12:06:00.000Z", success: true, reason: "completed", summary: sum(56, 41, 0.66) },
    { id: "m3", robotId: "amr_01", version: 3, createdAt: "2026-10-03T12:07:00.000Z", success: false, reason: "blocked", summary: sum(10, 20, 0.01) },
  ] as const;

  it("keeps the latest run per version and robot, and labels each change", () => {
    const rows = compareLatest(runs);
    expect(rows.map((r) => [r.version, r.robotId, r.runId, r.change])).toEqual([
      [3, "amr_01", "m3", "regressed"],
      [2, "agv_p2", "a2", "fixed"],
      [2, "amr_01", "m2", "same"],
      [1, "agv_p2", "a1", "first"],
      [1, "amr_01", "m1b", "first"],
    ]);
  });

  it("only computes deltas when both runs succeeded", () => {
    const rows = compareLatest(runs);
    const m2 = rows.find((r) => r.runId === "m2")!;
    expect(m2.prevVersion).toBe(1);
    expect(m2.delta.pathLengthM).toBeCloseTo(0.5, 12);
    expect(m2.delta.durationSec).toBeCloseTo(-2.5, 12);
    expect(m2.delta.minObstacleDist).toBeCloseTo(0.61, 12);
    const none = { durationSec: null, pathLengthM: null, minObstacleDist: null };
    expect(rows.find((r) => r.runId === "a2")!.delta).toEqual(none);
    expect(rows.find((r) => r.runId === "m3")!.delta).toEqual(none);
    expect(rows.find((r) => r.runId === "a1")!).toMatchObject({ prevVersion: null, delta: none, durationSec: 30 });
  });
});
