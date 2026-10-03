import { describe, expect, it } from "vitest";
import { ASSET_CATALOGUE } from "@twin/catalogue";
import { validateAndParse, validateEnvironmentSpec } from "../src";
import { clone, makeSpec } from "./fixtures";

const codes = (r: ReturnType<typeof validateEnvironmentSpec>) => r.errors.map((e) => e.code);
const obj = (id: string, type: string, pos: [number, number, number], extra: object = {}) => ({
  id, type, position: pos, rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number],
  physics: { static: true, mass: null }, ...extra,
});

describe("catalogue", () => {
  it("has 10-15 unique assets with required fields", () => {
    expect(ASSET_CATALOGUE.length).toBeGreaterThanOrEqual(10);
    expect(ASSET_CATALOGUE.length).toBeLessThanOrEqual(15);
    expect(new Set(ASSET_CATALOGUE.map((a) => a.type)).size).toBe(ASSET_CATALOGUE.length);
    for (const a of ASSET_CATALOGUE) {
      expect(a.name && a.footprint.length === 2 && a.height > 0 && a.collision && Array.isArray(a.tags)).toBeTruthy();
    }
  });
  it("accepts every known asset", () => {
    for (const a of ASSET_CATALOGUE) {
      const spec = makeSpec({ objects: [obj("a", a.type, [0, 0, 0])] });
      expect(validateEnvironmentSpec(spec).valid, a.type).toBe(true);
    }
  });
  it("rejects unknown asset", () => {
    const spec = makeSpec({ objects: [obj("a", "teleporter", [0, 0, 0])] });
    const r = validateEnvironmentSpec(spec);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: "UNKNOWN_ASSET_TYPE", path: "objects[0].type" });
  });
});

describe("schema", () => {
  it("accepts the plan example spec", () => {
    const r = validateEnvironmentSpec(makeSpec());
    expect(r).toEqual({ valid: true, errors: [], warnings: [] });
  });
  it.each([
    ["width", 0], ["length", -5], ["height", 0],
  ])("rejects non-positive %s", (k, v) => {
    const s = clone(makeSpec());
    (s.environment.dimensions as Record<string, number>)[k] = v;
    expect(codes(validateEnvironmentSpec(s))).toContain("INVALID_DIMENSIONS");
  });
  it("rejects invalid environment type", () => {
    const s = clone(makeSpec()) as any;
    s.environment.type = "spaceship";
    expect(validateEnvironmentSpec(s).errors[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "environment.type" });
  });
  it("rejects missing required fields", () => {
    const s = clone(makeSpec()) as any;
    delete s.terrain;
    delete s.robotics;
    const r = validateEnvironmentSpec(s);
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["terrain", "robotics"]));
  });
  it("rejects non-objects and unknown keys (never strips silently)", () => {
    expect(validateEnvironmentSpec("nope").valid).toBe(false);
    const s = clone(makeSpec()) as any;
    s.surprise = 1;
    expect(validateEnvironmentSpec(s).valid).toBe(false);
  });
  it("maps physical/scale ranges to specific codes", () => {
    const s = clone(makeSpec()) as any;
    s.terrain.properties.friction = 3;
    s.terrain.properties.restitution = 2;
    s.objects[0].scale = [0, 1, 1];
    s.objects[1].physics = { static: false, mass: -1 };
    expect(codes(validateEnvironmentSpec(s)).sort()).toEqual(["INVALID_FRICTION", "INVALID_MASS", "INVALID_RESTITUTION", "INVALID_SCALE"]);
  });
  it("requires mass for non-static objects", () => {
    const s = makeSpec({ objects: [obj("f", "forklift", [0, 0, 0], { physics: { static: false, mass: null } })] });
    expect(validateEnvironmentSpec(s).errors[0]).toMatchObject({ code: "INVALID_MASS", path: "objects[0].physics.mass" });
  });
  it("does not mutate input", () => {
    const s = makeSpec(); const before = JSON.stringify(s);
    validateAndParse(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("unique ids", () => {
  it("rejects duplicate object ids", () => {
    const s = makeSpec({ objects: [obj("x", "crate", [0, 0, 0]), obj("x", "crate", [5, 0, 0])] });
    expect(validateEnvironmentSpec(s).errors).toEqual([expect.objectContaining({ code: "DUPLICATE_OBJECT_ID", path: "objects[1].id" })]);
  });
  it("rejects duplicate waypoint ids", () => {
    const s = makeSpec({ navigation: { waypoints: [{ id: "w", position: [0, 0, 0] }, { id: "w", position: [1, 0, 0] }] } });
    expect(validateEnvironmentSpec(s).errors).toEqual([expect.objectContaining({ code: "DUPLICATE_WAYPOINT_ID" })]);
  });
});

describe("bounds", () => {
  it("accepts object fully inside, including touching the edge", () => {
    // shelf 1.2 wide -> centre at 24.4 touches x=25 exactly
    const s = makeSpec({ objects: [obj("s", "industrial_shelf", [24.4, 0, 0])] });
    expect(validateEnvironmentSpec(s).valid).toBe(true);
  });
  it("rejects object extending outside (footprint-aware)", () => {
    const s = makeSpec({ objects: [obj("s", "industrial_shelf", [24.5, 0, 0])] });
    expect(validateEnvironmentSpec(s).errors[0]).toMatchObject({ code: "OUT_OF_BOUNDS", path: "objects[0].position" });
  });
  it("rejects centre far outside", () => {
    const s = makeSpec({ objects: [obj("s", "crate", [62, 0, 0])] });
    expect(validateEnvironmentSpec(s).errors[0]!.message).toMatch(/x extent/);
  });
  it("accounts for scale and yaw", () => {
    const wide = makeSpec({ objects: [obj("s", "industrial_shelf", [24, 0, 0], { scale: [2, 1, 1] })] });
    expect(codes(validateEnvironmentSpec(wide))).toContain("OUT_OF_BOUNDS");
    const yawed = makeSpec({ objects: [obj("s", "wall", [0, 0, 39.5], { rotation: [0, Math.PI / 2, 0] })] });
    expect(codes(validateEnvironmentSpec(yawed))).toContain("OUT_OF_BOUNDS"); // 4m wall rotated spans z +-2
  });
  it("rejects objects taller than the room or below ground; and waypoints outside", () => {
    const s = makeSpec({
      environment: { name: "n", type: "office", dimensions: { width: 10, length: 10, height: 2 } },
      objects: [obj("c", "warehouse_column", [0, 0, 0])],
      navigation: { waypoints: [{ id: "w", position: [9, 0, 0] }] },
    });
    expect(validateEnvironmentSpec(s).errors.map((e) => e.path)).toEqual(["objects[0].position", "navigation.waypoints[0].position"]);
  });
});

describe("overlap", () => {
  it("accepts non-overlapping and merely touching static objects", () => {
    const s = makeSpec({ objects: [obj("a", "industrial_shelf", [0, 0, 0]), obj("b", "industrial_shelf", [1.2, 0, 0]), obj("c", "industrial_shelf", [0, 0, 5])] });
    expect(validateEnvironmentSpec(s).valid).toBe(true);
  });
  it("rejects overlapping static objects as an error", () => {
    const s = makeSpec({ objects: [obj("a", "industrial_shelf", [0, 0, 0]), obj("b", "industrial_shelf", [0.5, 0, 0.2])] });
    const r = validateEnvironmentSpec(s);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: "OVERLAP", path: "objects[1]", message: expect.stringContaining("a") });
  });
  it("allows stacking (footprints overlap, vertical spans do not)", () => {
    const s = makeSpec({ objects: [obj("p", "pallet", [0, 0, 0]), obj("c", "crate", [0, 0.15, 0])] });
    expect(validateEnvironmentSpec(s).valid).toBe(true);
  });
  it("downgrades to a warning when an object is dynamic", () => {
    const s = makeSpec({ objects: [obj("a", "industrial_shelf", [0, 0, 0]), obj("f", "forklift", [0, 0, 0], { physics: { static: false, mass: 3000 } })] });
    const r = validateEnvironmentSpec(s);
    expect(r.valid).toBe(true);
    expect(r.warnings[0]).toMatchObject({ code: "OVERLAP" });
  });
  it("warns about waypoints inside static obstacles", () => {
    const s = makeSpec({ objects: [obj("a", "industrial_shelf", [0, 0, 0])], navigation: { waypoints: [{ id: "w", position: [0, 0, 0] }] } });
    const r = validateEnvironmentSpec(s);
    expect(r.valid).toBe(true);
    expect(r.warnings[0]!.code).toBe("WAYPOINT_IN_OBSTACLE");
  });
  it("handles 2000 objects quickly", () => {
    const objs = Array.from({ length: 2000 }, (_, i) => obj(`b${i}`, "box", [(i % 50) - 24.5, 0, Math.floor(i / 50) - 20]));
    const t = Date.now();
    expect(validateEnvironmentSpec(makeSpec({ objects: objs })).valid).toBe(true);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
