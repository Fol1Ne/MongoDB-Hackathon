import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAndParse } from "@twin/validator";
import { ASSET_CATALOGUE } from "@twin/catalogue";

type Vec3 = [number, number, number];
type Obj = { id: string; type: string; position: Vec3; rotation: Vec3; scale: Vec3; physics: { static: boolean; mass: number | null } };
type Opts = { y?: number; yaw?: number; scale?: Vec3; mass?: number };

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "contract", "fixtures");
mkdirSync(out, { recursive: true });
const HALF = Math.PI / 2;

function builder() {
  const objects: Obj[] = [];
  const count: Record<string, number> = {};
  const add = (type: string, x: number, z: number, o: Opts = {}) => {
    count[type] = (count[type] ?? 0) + 1;
    objects.push({
      id: `${type}_${String(count[type]).padStart(3, "0")}`, type,
      position: [x, o.y ?? 0, z], rotation: [0, o.yaw ?? 0, 0], scale: o.scale ?? [1, 1, 1],
      physics: o.mass ? { static: false, mass: o.mass } : { static: true, mass: null },
    });
  };
  return { objects, add };
}

function textWarehouse(): Obj[] {
  const { objects, add } = builder();
  for (const ax of [-21, -15.5, -10, -4.5, 1, 6.5]) for (const side of [-0.35, 0.35]) for (const z0 of [-36, -9.8]) for (let i = 0; i < 6; i++) add("industrial_shelf", ax + side, z0 + i * 3.7 + 1.85, { yaw: HALF, scale: [3, 1, 1] });
  for (let i = 0; i < 6; i++) add("storage_rack", -20 + i * 2.7, -39.2);
  for (const x of [-24.7, 24.7]) for (const z of [-30, -10, 10, 30]) add("warehouse_column", x, z);
  add("forklift", -12.75, 20, { yaw: 0.3, mass: 2500 });
  add("forklift", 3.75, 24, { yaw: HALF, mass: 2500 });
  add("forklift", 17, 14, { yaw: 0.8, mass: 2500 });
  for (const x of [-15, -5, 5, 15]) add("loading_dock", x, 37.5);
  for (const x of [-15, -5, 5, 15]) add("barrier", x, 34.6);
  let n = 0;
  for (const z of [28, 31]) for (const x of [-16, -12, -8, -4, 0, 4, 8, 12, 16]) {
    add("pallet", x, z);
    n++;
    if (n % 3 === 0) add("crate", x, z, { y: 0.15 });
    else if (n % 3 === 1) add("box", x, z, { y: 0.15 });
  }
  for (const x of [14, 18.5]) for (let i = 0; i < 4; i++) add("conveyor", x, -30 + i * 3, { yaw: HALF });
  for (const z of [-4, -1.5, 1, 3.5]) add("workbench", 21.4, z, { yaw: HALF });
  add("charging_station", 22.5, -36); add("charging_station", 22.5, -34);
  for (const x of [14, 18, 22]) add("wall", x, 16);
  add("table", 20, 25); add("table", 20, 28);
  for (const [x, z] of [[18.9, 25], [21.1, 25], [18.9, 28], [21.1, 28]] as const) add("chair", x, z);
  return objects;
}

function photoWarehouse(): Obj[] {
  const { objects, add } = builder();
  for (const ax of [-12, -6, 0, 6]) for (const side of [-0.35, 0.35]) for (let i = 0; i < 8; i++) add("industrial_shelf", ax + side, -24 + i * 3.7 + 1.85, { yaw: HALF, scale: [3, 1, 1] });
  for (let i = 0; i < 5; i++) add("storage_rack", -14 + i * 2.7, -27.2);
  for (const x of [-17.6, 17.6]) for (const z of [-20, 0, 20]) add("warehouse_column", x, z);
  for (const x of [-8, 0, 8]) add("loading_dock", x, 26.4);
  for (const x of [-8, 0, 8]) add("barrier", x, 23.8);
  for (const [i, x] of [-10, -6, -2, 2, 6, 10].entries()) {
    add("pallet", x, 18.5);
    if (i % 3 === 0) add("crate", x, 18.5, { y: 0.15 });
  }
  add("forklift", 3, 12, { yaw: HALF, mass: 2500 });
  add("charging_station", 15, -24); add("charging_station", 15, -22.5);
  for (const z of [-8, -5, -2]) add("conveyor", 13, z, { yaw: HALF });
  for (const z of [6, 8.5]) add("workbench", 16, z, { yaw: HALF });
  return objects;
}

const PHOTO_CONFIDENCE: Record<string, number> = {
  industrial_shelf: 0.82, storage_rack: 0.74, warehouse_column: 0.9, loading_dock: 0.86, barrier: 0.58,
  pallet: 0.48, crate: 0.41, forklift: 0.44, charging_station: 0.36, conveyor: 0.66, workbench: 0.52,
};

function spec(name: string, dims: { width: number; length: number; height: number }, objects: Obj[], waypoints: { id: string; position: Vec3 }[], provenance: Record<string, unknown>) {
  return {
    schemaVersion: "1.0.0",
    environment: { name, type: "warehouse", dimensions: dims },
    terrain: { type: "concrete", properties: { friction: 0.8, restitution: 0.05 }, heightmap: null },
    objects,
    lighting: { preset: "warehouse_overhead", intensity: 1 },
    navigation: { waypoints },
    robotics: { simulation_enabled: true },
    provenance,
  };
}

const v1 = spec("Warehouse Environment", { width: 50, length: 80, height: 12 }, textWarehouse(), [
  { id: "wp_start", position: [3.75, 0, -37] }, { id: "wp_cross", position: [3.75, 0, -11.8] },
  { id: "wp_lane", position: [-18.25, 0, -11.8] }, { id: "wp_dock", position: [-18.25, 0, 33.5] },
], { source: "text", prompt: "A 50 by 80 metre warehouse with six shelf aisles and a loading dock.", model: "gemini-1.5-flash", generatedAt: "2026-10-03T12:00:00Z", confidence: null });
const v2 = structuredClone(v1);
for (const o of v2.objects) { if (o.id === "forklift_001") o.position = [-7.25, 0, -11.8]; if (o.id === "forklift_002") o.position = [3.75, 0, 8]; }
const v3 = structuredClone(v2);
v3.objects = v3.objects.filter((o) => !["pallet_004", "pallet_005", "pallet_006", "crate_002"].includes(o.id));
v3.objects.push({ id: "charging_station_003", type: "charging_station", position: [22.5, 0, -32], rotation: [0, 0, 0], scale: [1, 1, 1], physics: { static: true, mass: null } });

const photoObjects = photoWarehouse();
const photo = spec("Dock Street Warehouse", { width: 36, length: 56, height: 9 }, photoObjects, [
  { id: "wp_start", position: [3, 0, -26] }, { id: "wp_cross", position: [3, 0, 8] },
  { id: "wp_lane", position: [-8, 0, 8] }, { id: "wp_dock", position: [-8, 0, 22] },
], { source: "image", prompt: "3 photos. Hint: door height 2.1 m.", model: "gemini-1.5-flash (vision)", generatedAt: "2026-10-03T12:30:00Z", confidence: 0.62 });
const photoConfidence = Object.fromEntries(photoObjects.map((o) => [o.id, PHOTO_CONFIDENCE[o.type] ?? 0.7]));

const bad = structuredClone(v1);
bad.objects[3]!.position = [62, 0, 5];
bad.objects[7]!.type = "robotic_shelf_v9";

let failed = 0;
for (const [label, s] of [["v1", v1], ["v2", v2], ["v3", v3], ["photo", photo]] as const) {
  const { result } = validateAndParse(s);
  console.log(`${label}: valid=${result.valid} objects=${s.objects.length} errors=${result.errors.length} warnings=${result.warnings.length}`);
  for (const e of result.errors.slice(0, 6)) console.log(`  error ${e.code} ${e.path} ${e.message}`);
  if (!result.valid) failed++;
}
const badCodes = [...new Set(validateAndParse(bad).result.errors.map((e) => e.code))];
console.log(`bad: codes=${badCodes.join(",")}`);
if (!badCodes.includes("UNKNOWN_ASSET_TYPE") || !badCodes.includes("OUT_OF_BOUNDS")) failed++;
if (failed) { console.error(`${failed} fixture(s) misbehaved; nothing written`); process.exit(1); }

const t = (n: number) => `2026-10-03T12:${String(n).padStart(2, "0")}:00.000Z`;
const meta = (version: number, s: unknown, note: string) => ({ version, changeNote: note, createdAt: t(version * 10), spec: s });
const write = (file: string, data: unknown) => writeFileSync(join(out, file), JSON.stringify(data, null, 2) + "\n");
write("warehouse.versions.json", [meta(1, v1, "Generated from prompt"), meta(2, v2, "Re-routed two forklifts through the cross aisle"), meta(3, v3, "Cleared dock staging, added charging bay")]);
write("warehouse.invalid.json", bad);
write("photo.warehouse.json", { spec: photo, confidence: photoConfidence });
write("catalogue.json", { assets: ASSET_CATALOGUE });
console.log(`wrote 4 fixtures to ${out}`);
