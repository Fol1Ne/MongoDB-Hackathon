import { describe, expect, it } from "vitest";
import versions from "../contract/fixtures/warehouse.versions.json";
import { EnvironmentSpecSchema } from "../contract";
import { analyze } from "../domain/analysis";
import { nextId } from "../domain/specOps";
import { runCommand } from "./commands";
import { saveView } from "./studio";

const v3 = EnvironmentSpecSchema.parse(versions[2]!.spec);
const crate = v3.objects.find((o) => o.type === "crate")!;

describe("commands", () => {
  it("moves on the floor, keeps the base height, and stays valid under the strict schema", () => {
    const next = runCommand(v3, "transform", { id: crate.id, x: -15.25, z: 28.5, yaw: Math.PI * 3 });
    const moved = next.objects.find((o) => o.id === crate.id)!;
    expect(moved.position).toEqual([-15.25, 0.15, 28.5]);
    expect(moved.rotation).toEqual([0, 3.142, 0]);
    expect(Object.keys(moved).sort()).toEqual(Object.keys(crate).sort());
    expect(EnvironmentSpecSchema.safeParse(next).success).toBe(true);
  });

  it("shares untouched objects between versions so history stays small", () => {
    const next = runCommand(v3, "transform", { id: "forklift_001", x: 0, z: 0, yaw: 0 });
    expect(next.objects[0]).toBe(v3.objects[0]);
    expect(next).not.toBe(v3);
  });

  it("adds, duplicates, and removes objects with valid ids", () => {
    const added = runCommand(v3, "add", { id: "forklift_004", type: "forklift", x: 10, z: -2 });
    const newId = nextId(added, "crate");
    expect(newId).toBe("crate_007");
    const dup = runCommand(added, "duplicate", { id: crate.id, newId });
    const copy = dup.objects.find((o) => o.id === newId)!;
    expect(copy.position).toEqual([crate.position[0] + 1.5, 0.15, crate.position[2] + 1.5]);
    const removed = runCommand(dup, "remove", { id: "forklift_004" });
    expect(removed.objects.length).toBe(v3.objects.length + 1);
    expect(EnvironmentSpecSchema.safeParse(removed).success).toBe(true);
  });

  it("clamps scale to the schema limits", () => {
    const big = runCommand(v3, "setScale", { id: crate.id, axis: 0, value: 40 });
    expect(big.objects.find((o) => o.id === crate.id)!.scale[0]).toBe(10);
  });

  it("reports out-of-bounds objects after the floor shrinks", () => {
    const small = runCommand(v3, "setEnvironment", { width: 40 });
    expect(analyze(small).errors.filter((e) => e.code === "OUT_OF_BOUNDS").length).toBeGreaterThan(0);
  });
});

describe("save state", () => {
  const base = { spec: v3, savedSpec: v3, analysis: analyze(v3), saveStatus: { kind: "idle" as const }, baseVersion: 3, headVersion: 3 };

  it("reads Saved when nothing changed and Save version after an edit", () => {
    expect(saveView(base).label).toBe("Saved");
    const edited = runCommand(v3, "transform", { id: "forklift_001", x: 1, z: 1, yaw: 0 });
    expect(saveView({ ...base, spec: edited, analysis: analyze(edited) }).label).toBe("Save version");
  });

  it("blocks saving while errors exist, with one error per overlapping pair", () => {
    const a = v3.objects.find((o) => o.id === "industrial_shelf_001")!;
    const overlapped = runCommand(v3, "transform", { id: "industrial_shelf_002", x: a.position[0], z: a.position[2], yaw: a.rotation[1] });
    expect(saveView({ ...base, spec: overlapped, analysis: analyze(overlapped) })).toEqual({ kind: "blocked", errors: 1, label: "Fix 1 error to save" });
  });

  it("offers a restore when an older version is open and unchanged", () => {
    expect(saveView({ ...base, baseVersion: 1 }).label).toBe("Restore as v4");
  });
});
