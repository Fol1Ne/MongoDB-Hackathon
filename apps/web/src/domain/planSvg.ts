import { DEFAULT_ASSET_MAP, type AssetMap, type EnvironmentSpec } from "../contract";
import { CATEGORY_HEX, COLORS, LOW_CONFIDENCE, type Category } from "../design/tokens";
import { categoryOf, footprintOf } from "./categories";

export type PlanStyle = "blueprint" | "colour";

export interface PlanOptions {
  style: PlanStyle;
  widthMm: number;
  heightMm: number;
  mode: "sheet" | "thumbnail";
  confidence?: Readonly<Record<string, number>> | null;
  assets?: AssetMap;
}

export interface PlanResult {
  svg: string;
  scaleDenominator: number | null;
  rotated: boolean;
  objectCount: number;
}

const STANDARD_SCALES = [50, 100, 125, 200, 250, 400, 500, 1000, 1250, 2000, 2500, 5000, 10000];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const f = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const PATTERNS: Record<Category, (ink: string) => string> = {
  storage: (ink) => `<path d="M0 1.6L1.6 0" stroke="${ink}" stroke-width="0.18"/>`,
  logistics: (ink) => `<circle cx="0.8" cy="0.8" r="0.22" fill="${ink}"/>`,
  factory: (ink) => `<path d="M0 0.8H1.6" stroke="${ink}" stroke-width="0.18"/>`,
  furniture: (ink) => `<path d="M0.8 0V1.6" stroke="${ink}" stroke-width="0.18"/>`,
  robotics: (ink) => `<path d="M0 0L1.6 1.6M0 1.6L1.6 0" stroke="${ink}" stroke-width="0.14"/>`,
  vehicle: (ink) => `<rect width="1.6" height="1.6" fill="${ink}" fill-opacity="0.32"/>`,
  safety: (ink) => `<path d="M0 0L1.6 1.6" stroke="${ink}" stroke-width="0.3"/>`,
  structure: (ink) => `<rect width="1.6" height="1.6" fill="${ink}" fill-opacity="0.75"/>`,
};

export function blueprintPatternDefs(ink: string = COLORS.blueprintInk): string {
  return Object.entries(PATTERNS)
    .map(([c, body]) => `<pattern id="bp-${c}" width="1.6" height="1.6" patternUnits="userSpaceOnUse">${body(ink)}</pattern>`)
    .join("");
}

export function buildPlanSvg(spec: EnvironmentSpec, opts: PlanOptions): PlanResult {
  const assets = opts.assets ?? DEFAULT_ASSET_MAP;
  const sheet = opts.mode === "sheet";
  const blueprint = opts.style === "blueprint";
  const ink = blueprint ? COLORS.blueprintInk : COLORS.ink;
  const { width: W, length: L } = spec.environment.dimensions;
  const margin = sheet ? 18 : 2;
  const availU = opts.widthMm - margin * 2;
  const availV = opts.heightMm - margin * 2;

  const fitStraight = Math.min(availU / W, availV / L);
  const fitTurned = Math.min(availU / L, availV / W);
  const rotated = fitTurned > fitStraight * 1.02;
  const fit = rotated ? fitTurned : fitStraight;
  const denominator = sheet ? (STANDARD_SCALES.find((d) => 1000 / d <= fit) ?? STANDARD_SCALES.at(-1)!) : null;
  const k = denominator ? 1000 / denominator : fit;

  const extentU = rotated ? L : W;
  const extentV = rotated ? W : L;
  const offU = margin + (availU - extentU * k) / 2;
  const offV = margin + (availV - extentV * k) / 2;
  const map = (x: number, z: number): [number, number] =>
    rotated ? [offU + (z + L / 2) * k, offV + (W / 2 - x) * k] : [offU + (x + W / 2) * k, offV + (z + L / 2) * k];
  const angleOf = (yaw: number) => (-yaw * 180) / Math.PI - (rotated ? 90 : 0);

  const parts: string[] = [];
  const size = sheet ? `width="${f(opts.widthMm)}mm" height="${f(opts.heightMm)}mm"` : `width="100%"`;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${f(opts.widthMm)} ${f(opts.heightMm)}" font-family="'JetBrains Mono Variable', ui-monospace, monospace" class="plan plan-${opts.style}">`);
  if (blueprint && sheet) parts.push(`<defs>${blueprintPatternDefs(ink)}</defs>`);

  const [fx0, fy0] = [offU, offV];
  const fw = extentU * k;
  const fh = extentV * k;
  const floorFill = blueprint ? "#f4f8fd" : COLORS.floor;
  parts.push(`<rect class="floor" x="${f(fx0)}" y="${f(fy0)}" width="${f(fw)}" height="${f(fh)}" fill="${floorFill}" stroke="${ink}" stroke-width="${sheet ? 0.5 : 0.3}"/>`);

  if (sheet) {
    const step = Math.max(extentU, extentV) > 120 ? 20 : 10;
    const gridStroke = blueprint ? ink : COLORS.floorMajor;
    for (let d = 0, i = 1; d <= extentU + 1e-6; d += step, i++) {
      const u = fx0 + d * k;
      parts.push(`<line x1="${f(u)}" y1="${f(fy0)}" x2="${f(u)}" y2="${f(fy0 + fh)}" stroke="${gridStroke}" stroke-opacity="${blueprint ? 0.25 : 1}" stroke-width="0.18" stroke-dasharray="1.2 1"/>`);
      parts.push(`<circle cx="${f(u)}" cy="${f(fy0 - 7)}" r="2.6" fill="none" stroke="${ink}" stroke-width="0.25"/><text x="${f(u)}" y="${f(fy0 - 6.1)}" font-size="2.4" text-anchor="middle" fill="${ink}">${i}</text>`);
    }
    for (let d = 0, j = 0; d <= extentV + 1e-6; d += step, j++) {
      const v = fy0 + d * k;
      parts.push(`<line x1="${f(fx0)}" y1="${f(v)}" x2="${f(fx0 + fw)}" y2="${f(v)}" stroke="${gridStroke}" stroke-opacity="${blueprint ? 0.25 : 1}" stroke-width="0.18" stroke-dasharray="1.2 1"/>`);
      parts.push(`<circle cx="${f(fx0 - 7)}" cy="${f(v)}" r="2.6" fill="none" stroke="${ink}" stroke-width="0.25"/><text x="${f(fx0 - 7)}" y="${f(v + 0.9)}" font-size="2.4" text-anchor="middle" fill="${ink}">${LETTERS[j % LETTERS.length]}</text>`);
    }
  }

  let dock = 0;
  for (const o of spec.objects) {
    const fp = footprintOf(o.type, assets);
    const w = fp.width * o.scale[0] * k;
    const d = fp.depth * o.scale[2] * k;
    const [u, v] = map(o.position[0], o.position[2]);
    const category = categoryOf(o.type, assets);
    const fill = blueprint ? (sheet ? `url(#bp-${category})` : "#dce8f5") : CATEGORY_HEX[category];
    const conf = opts.confidence?.[o.id];
    const low = conf !== undefined && conf < LOW_CONFIDENCE;
    const stroke = low && !blueprint ? COLORS.warn : ink;
    const dash = low ? ` stroke-dasharray="${sheet ? "0.9 0.6" : "0.6 0.4"}"` : "";
    const sw = sheet ? (low ? 0.32 : 0.22) : 0.12;
    parts.push(`<g transform="translate(${f(u)} ${f(v)}) rotate(${f(angleOf(o.rotation[1]))})"><rect class="obj" data-id="${esc(o.id)}" x="${f(-w / 2)}" y="${f(-d / 2)}" width="${f(w)}" height="${f(d)}" fill="${fill}" stroke="${stroke}" stroke-opacity="${blueprint ? 1 : 0.6}" stroke-width="${sw}"${dash}/></g>`);
    if (sheet && o.type === "loading_dock") {
      dock++;
      parts.push(`<text x="${f(u)}" y="${f(v + 0.9)}" font-size="2.3" font-weight="600" text-anchor="middle" fill="${ink}" paint-order="stroke" stroke="${blueprint ? "#fff" : COLORS.floor}" stroke-width="0.8">D${dock}</text>`);
    }
  }

  const wps = spec.navigation?.waypoints ?? [];
  if (wps.length > 1) {
    const pathInk = blueprint ? ink : COLORS.accent;
    const pts = wps.map((w) => map(w.position[0], w.position[2]).map(f).join(",")).join(" ");
    parts.push(`<polyline points="${pts}" fill="none" stroke="${pathInk}" stroke-width="${sheet ? 0.4 : 0.25}" stroke-dasharray="${sheet ? "1.6 1" : "1 0.7"}"/>`);
    wps.forEach((w, i) => {
      const [u, v] = map(w.position[0], w.position[2]);
      parts.push(`<circle cx="${f(u)}" cy="${f(v)}" r="${sheet ? 1.1 : 0.6}" fill="${pathInk}"/>`);
      if (sheet && (i === 0 || i === wps.length - 1)) {
        parts.push(`<text x="${f(u + 2)}" y="${f(v - 1.6)}" font-size="2.6" font-weight="700" fill="${pathInk}" paint-order="stroke" stroke="${blueprint ? "#fff" : COLORS.floor}" stroke-width="0.8">${i === 0 ? "START" : "DOCK"}</text>`);
      }
    });
  }

  if (sheet) {
    const dimV = fy0 + fh + 8;
    const dimU = fx0 + fw + 8;
    const tick = (x: number, y: number) => `<path d="M${f(x - 1)} ${f(y + 1)}L${f(x + 1)} ${f(y - 1)}" stroke="${ink}" stroke-width="0.3"/>`;
    parts.push(`<line x1="${f(fx0)}" y1="${f(dimV)}" x2="${f(fx0 + fw)}" y2="${f(dimV)}" stroke="${ink}" stroke-width="0.25"/>${tick(fx0, dimV)}${tick(fx0 + fw, dimV)}`);
    parts.push(`<line x1="${f(fx0)}" y1="${f(fy0 + fh + 2)}" x2="${f(fx0)}" y2="${f(dimV + 1.5)}" stroke="${ink}" stroke-width="0.18"/><line x1="${f(fx0 + fw)}" y1="${f(fy0 + fh + 2)}" x2="${f(fx0 + fw)}" y2="${f(dimV + 1.5)}" stroke="${ink}" stroke-width="0.18"/>`);
    parts.push(`<text x="${f(fx0 + fw / 2)}" y="${f(dimV - 1.2)}" font-size="2.8" text-anchor="middle" fill="${ink}">${f(extentU)} m</text>`);
    parts.push(`<line x1="${f(dimU)}" y1="${f(fy0)}" x2="${f(dimU)}" y2="${f(fy0 + fh)}" stroke="${ink}" stroke-width="0.25"/>${tick(dimU, fy0)}${tick(dimU, fy0 + fh)}`);
    parts.push(`<line x1="${f(fx0 + fw + 2)}" y1="${f(fy0)}" x2="${f(dimU + 1.5)}" y2="${f(fy0)}" stroke="${ink}" stroke-width="0.18"/><line x1="${f(fx0 + fw + 2)}" y1="${f(fy0 + fh)}" x2="${f(dimU + 1.5)}" y2="${f(fy0 + fh)}" stroke="${ink}" stroke-width="0.18"/>`);
    parts.push(`<text x="${f(dimU + 1.2)}" y="${f(fy0 + fh / 2)}" font-size="2.8" text-anchor="middle" fill="${ink}" transform="rotate(90 ${f(dimU + 1.2)} ${f(fy0 + fh / 2)})">${f(extentV)} m</text>`);

    const barY = opts.heightMm - 6;
    const seg = [0, 5, 10, 20];
    const barX = margin;
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i]! * k;
      const b = seg[i + 1]! * k;
      parts.push(`<rect x="${f(barX + a)}" y="${f(barY - 1.2)}" width="${f(b - a)}" height="1.2" fill="${i % 2 ? "#fff" : ink}" stroke="${ink}" stroke-width="0.2"/>`);
    }
    for (const s of seg) parts.push(`<text x="${f(barX + s * k)}" y="${f(barY + 2.6)}" font-size="2.2" text-anchor="middle" fill="${ink}">${s}</text>`);
    parts.push(`<text x="${f(barX + seg.at(-1)! * k + 3)}" y="${f(barY)}" font-size="2.4" fill="${ink}">m   SCALE 1:${denominator}</text>`);

    const ax = opts.widthMm - margin - 2;
    const ay = margin - 8;
    const [horiz, vert] = rotated ? ["Z", "X"] : ["X", "Z"];
    const vertDir = rotated ? -1 : 1;
    parts.push(`<g stroke="${ink}" stroke-width="0.3" fill="none"><path d="M${f(ax - 12)} ${f(ay)}H${f(ax - 4)}M${f(ax - 6)} ${f(ay - 1.2)}L${f(ax - 4)} ${f(ay)}L${f(ax - 6)} ${f(ay + 1.2)}"/><path d="M${f(ax - 12)} ${f(ay)}V${f(ay + vertDir * 8)}M${f(ax - 13.2)} ${f(ay + vertDir * 6)}L${f(ax - 12)} ${f(ay + vertDir * 8)}L${f(ax - 10.8)} ${f(ay + vertDir * 6)}"/></g>`);
    parts.push(`<text x="${f(ax - 2.6)}" y="${f(ay + 0.9)}" font-size="2.4" fill="${ink}">${horiz}</text><text x="${f(ax - 12)}" y="${f(ay + vertDir * 10.6 + (vertDir < 0 ? 0 : 1))}" font-size="2.4" text-anchor="middle" fill="${ink}">${vert}</text>`);
  }

  parts.push("</svg>");
  return { svg: parts.join(""), scaleDenominator: denominator, rotated, objectCount: spec.objects.length };
}
