import { DEFAULT_ASSET_MAP, type AssetMap, type EnvironmentSpec } from "../contract";
import { CATEGORY_ORDER, type Category } from "../design/tokens";
import { categoryOf, footprintOf, labelOf } from "./categories";

export interface ScheduleRow {
  type: string;
  name: string;
  category: Category;
  count: number;
  footprint: [number, number];
  height: number;
  area: number;
}

export interface Schedule {
  rows: ScheduleRow[];
  totalCount: number;
  totalArea: number;
  floorArea: number;
  byCategory: Partial<Record<Category, number>>;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function buildSchedule(spec: EnvironmentSpec, assets: AssetMap = DEFAULT_ASSET_MAP): Schedule {
  const rows = new Map<string, ScheduleRow>();
  for (const o of spec.objects) {
    const f = footprintOf(o.type, assets);
    const row = rows.get(o.type) ?? { type: o.type, name: labelOf(o.type, assets), category: categoryOf(o.type, assets), count: 0, footprint: [f.width, f.depth], height: f.height, area: 0 };
    row.count++;
    row.area += f.width * o.scale[0] * f.depth * o.scale[2];
    rows.set(o.type, row);
  }
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, area: round2(r.area) }))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  const byCategory: Partial<Record<Category, number>> = {};
  for (const r of sorted) byCategory[r.category] = (byCategory[r.category] ?? 0) + r.count;
  const { width, length } = spec.environment.dimensions;
  return {
    rows: sorted,
    totalCount: spec.objects.length,
    totalArea: round2(sorted.reduce((s, r) => s + r.area, 0)),
    floorArea: round2(width * length),
    byCategory,
  };
}

export function scheduleCsv(s: Schedule): string {
  const head = "type,name,category,count,footprint_x_m,footprint_z_m,height_m,area_m2";
  const lines = s.rows.map((r) => [r.type, `"${r.name}"`, r.category, r.count, r.footprint[0], r.footprint[1], r.height, r.area].join(","));
  return [head, ...lines, `total,,,${s.totalCount},,,,${s.totalArea}`].join("\n") + "\n";
}
