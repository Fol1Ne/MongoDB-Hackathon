const CATEGORIES = {
  vehicle:   { L: 0.70, C: 0.160, h: 45,  note: "forklift, the object robots must avoid" },
  robotics:  { L: 0.60, C: 0.130, h: 258, note: "charging_station" },
  safety:    { L: 0.55, C: 0.170, h: 25,  note: "barrier" },
  logistics: { L: 0.85, C: 0.130, h: 92,  note: "pallet, crate, box, loading_dock" },
  factory:   { L: 0.66, C: 0.100, h: 192, note: "conveyor" },
  furniture: { L: 0.80, C: 0.090, h: 312, note: "workbench, table, chair" },
  storage:   { L: 0.74, C: 0.040, h: 62,  note: "industrial_shelf, storage_rack (the dominant mass, kept quiet)" },
  structure: { L: 0.88, C: 0.012, h: 85,  note: "warehouse_column, wall" },
};
const UI = { floor: "#f0eadd", stage: "#f5f1e8", ink: "#2a251d", accent: "#d8623a", accentFill: "#c4512b" };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinear({ L, C, h }) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const hex = (lin) => "#" + lin.map((v) => Math.round(clamp01(toSrgb(clamp01(v))) * 255).toString(16).padStart(2, "0")).join("");
function linearFromHex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
}
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const dE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const SIM = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (rgb, m) => m.map((row) => clamp01(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]));

const entries = Object.entries(CATEGORIES).map(([name, spec]) => {
  const lin = oklchToLinear(spec);
  return { name, spec, lin, hex: hex(lin), gamut: inGamut(lin) };
});

const MIN_DE = { normal: 0.085, deuteranopia: 0.05, protanopia: 0.05, tritanopia: 0.05 };
let failures = 0;
const report = [];

for (const e of entries) if (!e.gamut) { failures++; report.push(`FAIL ${e.name} is outside sRGB; lower chroma`); }

for (const [mode, matrix] of [["normal", null], ...Object.entries(SIM)]) {
  let worst = { d: Infinity, pair: "" };
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = matrix ? simulate(entries[i].lin, matrix) : entries[i].lin;
    const b = matrix ? simulate(entries[j].lin, matrix) : entries[j].lin;
    const d = dE(linearToOklab(a), linearToOklab(b));
    if (d < worst.d) worst = { d, pair: `${entries[i].name} / ${entries[j].name}` };
  }
  const ok = worst.d >= MIN_DE[mode];
  if (!ok) failures++;
  report.push(`${ok ? "pass" : "FAIL"} ${mode.padEnd(13)} min pair ${worst.pair.padEnd(22)} dE ${worst.d.toFixed(3)} (need ${MIN_DE[mode]})`);
}

const floor = linearFromHex(UI.floor);
const textOnStage = contrast(linearFromHex(UI.ink), linearFromHex(UI.stage));
const labelOnFill = contrast(linearFromHex(UI.accentFill), [1, 1, 1]);
const accentOnStage = contrast(linearFromHex(UI.accent), linearFromHex(UI.stage));
const checks = [
  [textOnStage >= 4.5, `ink on stage ${textOnStage.toFixed(2)}:1 (text needs 4.5)`],
  [labelOnFill >= 4.5, `white 13px label on accentFill ${labelOnFill.toFixed(2)}:1 (text needs 4.5)`],
  [accentOnStage >= 3, `accent graphics on stage ${accentOnStage.toFixed(2)}:1 (graphics need 3)`],
];
for (const [ok, msg] of checks) { if (!ok) failures++; report.push(`${ok ? "pass" : "FAIL"} ${msg}`); }

const JSON_ONLY = process.argv.includes("--json");
if (JSON_ONLY) {
  console.log(JSON.stringify(Object.fromEntries(entries.map((e) => [e.name, e.hex]))));
  process.exit(failures ? 1 : 0);
}
console.log("category   hex      L     C      h");
for (const e of entries) console.log(`${e.name.padEnd(10)} ${e.hex}  ${e.spec.L.toFixed(2)}  ${e.spec.C.toFixed(3)}  ${String(e.spec.h).padStart(3)}   floor contrast ${contrast(e.lin, floor).toFixed(2)}:1   ${e.spec.note}`);
console.log(report.join("\n"));
console.log(`\n${failures === 0 ? "palette ok" : failures + " problem(s)"}`);
process.exit(failures ? 1 : 0);
