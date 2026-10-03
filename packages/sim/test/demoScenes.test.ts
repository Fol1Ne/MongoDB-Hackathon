import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EnvironmentSpec } from "@twin/schema";
import { validateEnvironmentSpec } from "@twin/validator";
import { ROBOT_IDS, hotspots, simulate, summarize } from "../src";

// Locks the demo choreography (PLAN.md §20 step 7) against the scenes the team seeds on Atlas.
const load = (name: string): EnvironmentSpec =>
  JSON.parse(readFileSync(new URL(`../../../apps/api/demo-scenes/${name}.json`, import.meta.url), "utf8")) as EnvironmentSpec;

describe("demo scenes", () => {
  it("Warehouse Alpha v1: AMR-01 docks, but AGV-P2 can't reach wp_dock, which sits against dock_001", () => {
    const wh = load("warehouse");
    expect(simulate(wh, "amr_01")).toMatchObject({ success: true, reason: "completed" });
    const agv = simulate(wh, "agv_p2");
    expect(agv).toMatchObject({
      success: false, reason: "goal_unreachable",
      blocked: { leg: 0, from: "wp_start", to: "wp_dock", nearestObstacle: "dock_001" },
    });
    expect(hotspots(agv.samples).some((h) => h.x > 16 && h.x < 18)).toBe(true);
  });

  it("Warehouse Alpha v2: moving dock_001 1.5 m east lets both robots dock with no near-misses", () => {
    const wh = load("warehouse");
    wh.objects.find((o) => o.id === "dock_001")!.position = [21.5, 0, 0];
    expect(validateEnvironmentSpec(wh).valid).toBe(true);
    for (const id of ROBOT_IDS) {
      const r = simulate(wh, id);
      expect(r, id).toMatchObject({ success: true, reason: "completed" });
      expect(summarize(r.samples)!.nearMissSec, id).toBe(0);
    }
  });

  it.each(["factory", "outdoor"])("%s: both robots complete the route", (name) => {
    for (const id of ROBOT_IDS) expect(simulate(load(name), id), `${name}/${id}`).toMatchObject({ success: true, reason: "completed" });
  });

  it("office: AMR-01 completes, AGV-P2 is stopped by the tile floor's friction", () => {
    const office = load("office");
    expect(simulate(office, "amr_01")).toMatchObject({ success: true, reason: "completed" });
    expect(simulate(office, "agv_p2")).toMatchObject({ success: false, reason: "low_friction", samples: [] });
  });
});
