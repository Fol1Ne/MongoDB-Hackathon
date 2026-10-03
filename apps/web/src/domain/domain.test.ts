import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSET_CATALOGUE, EnvironmentSpecSchema, type EnvironmentSpec } from "../contract";
import versions from "../contract/fixtures/warehouse.versions.json";
import photo from "../contract/fixtures/photo.warehouse.json";
import { CATEGORY_HEX } from "../design/tokens";
import { analyze } from "./analysis";
import { categoryOf } from "./categories";
import { buildPlanSvg } from "./planSvg";
import { buildSchedule, scheduleCsv } from "./schedule";
import { changeNote, diffSpecs, nextId, specHash } from "./specOps";

const v1 = EnvironmentSpecSchema.parse(versions[0]!.spec);
const v3 = EnvironmentSpecSchema.parse(versions[2]!.spec);
const photoSpec = EnvironmentSpecSchema.parse(photo.spec);

describe("categories", () => {
  it("maps every catalogue type to the category of its first tag", () => {
    const map = Object.fromEntries(ASSET_CATALOGUE.map((a) => [a.type, categoryOf(a.type)]));
    expect(map).toEqual({
      industrial_shelf: "storage", storage_rack: "storage", pallet: "logistics", crate: "logistics", box: "logistics",
      workbench: "furniture", table: "furniture", chair: "furniture", warehouse_column: "structure", barrier: "safety",
      charging_station: "robotics", loading_dock: "logistics", forklift: "vehicle", conveyor: "factory", wall: "structure",
    });
    expect(categoryOf("robotic_shelf_v9")).toBe("structure");
  });

  it("uses exactly the colours the palette script generates and checks", () => {
    const script = fileURLToPath(new URL("../../scripts/palette.mjs", import.meta.url));
    const generated = JSON.parse(execFileSync("node", [script, "--json"], { encoding: "utf8" }));
    expect(CATEGORY_HEX).toEqual(generated);
  });
});

describe("analysis", () => {
  it("finds no issues in the fixtures", () => {
    expect(analyze(v3).byId.size).toBe(0);
    expect(analyze(photoSpec).valid).toBe(true);
  });

  it("marks both objects of a static overlap", () => {
    const s: EnvironmentSpec = structuredClone(v3);
    const a = s.objects.find((o) => o.id === "industrial_shelf_001")!;
    const b = s.objects.find((o) => o.id === "industrial_shelf_002")!;
    b.position = [...a.position];
    const r = analyze(s);
    expect(r.byId.get("industrial_shelf_001")?.errors.map((e) => e.code)).toContain("OVERLAP");
    expect(r.byId.get("industrial_shelf_002")?.errors.map((e) => e.code)).toContain("OVERLAP");
  });

  it("allows a crate stacked on a pallet", () => {
    const crate = v3.objects.find((o) => o.type === "crate")!;
    expect(crate.position[1]).toBe(0.15);
    expect(analyze(v3).byId.get(crate.id)).toBeUndefined();
  });
});

describe("spec operations", () => {
  it("numbers new ids after the highest existing one", () => {
    expect(nextId(v3, "forklift")).toBe("forklift_004");
    expect(nextId(v3, "charging_station")).toBe("charging_station_004");
    expect(nextId(v3, "chair")).toBe("chair_005");
    expect(nextId(v3, "storage_rack")).toBe("storage_rack_007");
  });

  it("diffs version 1 against version 3", () => {
    const d = diffSpecs(v1, v3);
    expect(d.added).toEqual(["charging_station_003"]);
    expect(d.removed.sort()).toEqual(["crate_002", "pallet_004", "pallet_005", "pallet_006"]);
    expect(d.moved.sort()).toEqual(["forklift_001", "forklift_002"]);
    expect(changeNote(d, false)).toBe("Moved 2, added 1, removed 4");
  });

  it("hashes a spec stably and changes the hash on any edit", async () => {
    const a = await specHash(v3);
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(await specHash(structuredClone(v3))).toBe(a);
    const moved = structuredClone(v3);
    moved.objects[0]!.position = [0, 0, 0];
    expect(await specHash(moved)).not.toBe(a);
  });
});

describe("schedule", () => {
  it("totals the warehouse", () => {
    const s = buildSchedule(v3);
    expect(s.rows).toHaveLength(15);
    expect(s.totalCount).toBe(219);
    expect(s.totalArea).toBe(436.47);
    expect(s.floorArea).toBe(4000);
    expect(s.rows[0]!.category).toBe("storage");
    expect(scheduleCsv(s).trim().split("\n")).toHaveLength(17);
  });
});

describe("plan drawing", () => {
  it("draws every object at a standard scale on an A4 landscape sheet", () => {
    const r = buildPlanSvg(v3, { style: "blueprint", mode: "sheet", widthMm: 277, heightMm: 150 });
    expect(r.objectCount).toBe(219);
    expect(r.svg.match(/class="obj"/g)).toHaveLength(219);
    expect(r.rotated).toBe(true);
    expect(r.scaleDenominator).toBe(500);
    expect(r.svg).toContain(">START<");
    expect(r.svg).toContain("SCALE 1:500");
    expect(r.svg).toContain("80 m");
  });

  it("dashes low-confidence objects from a photo scan", () => {
    const r = buildPlanSvg(photoSpec, { style: "colour", mode: "thumbnail", widthMm: 100, heightMm: 70, confidence: photo.confidence });
    const low = Object.values(photo.confidence).filter((c) => c < 0.5).length;
    expect(r.svg.match(/stroke-dasharray="0.6 0.4"/g)).toHaveLength(low);
    expect(r.svg).not.toContain("SCALE");
  });
});
