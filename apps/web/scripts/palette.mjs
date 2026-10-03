const CATEGORIES = {
  storage: "#5ac8fa",
  logistics: "#ffd166",
  factory: "#6ee7a8",
  furniture: "#a5b5d2",
  robotics: "#b794f6",
  vehicle: "#ffa94d",
  safety: "#ff7b9c",
  structure: "#70819f",
};
const UI = { stage: "#0a1020", panel: "#0b1326", floor: "#0d1932", ink: "#d6e4ff", muted: "#7388b0", accent: "#5ac8fa", accentInk: "#04121f" };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
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

const entries = Object.entries(CATEGORIES).map(([name, hex]) => ({ name, hex, lin: linearFromHex(hex) }));

const MIN_DE = { normal: 0.085, deuteranopia: 0.05, protanopia: 0.05, tritanopia: 0.05 };
let failures = 0;
const report = [];

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
const ratio = (fg, bg) => contrast(linearFromHex(fg), linearFromHex(bg));
const textOnStage = ratio(UI.ink, UI.stage);
const inkOnAccent = ratio(UI.accentInk, UI.accent);
const accentOnStage = ratio(UI.accent, UI.stage);
const mutedOnPanel = ratio(UI.muted, UI.panel);
const checks = [
  [textOnStage >= 4.5, `text on stage ${textOnStage.toFixed(2)}:1 (text needs 4.5)`],
  [inkOnAccent >= 4.5, `accent-ink on accent ${inkOnAccent.toFixed(2)}:1 (text needs 4.5)`],
  [accentOnStage >= 3, `accent graphics on stage ${accentOnStage.toFixed(2)}:1 (graphics need 3)`],
  [mutedOnPanel >= 4.5, `muted on panel ${mutedOnPanel.toFixed(2)}:1 (text needs 4.5)`],
  ...entries.map((e) => { const c = contrast(e.lin, floor); return [c >= 3, `${e.name.padEnd(10)} ${e.hex} on floor ${c.toFixed(2)}:1 (graphics need 3)`]; }),
];
for (const [ok, msg] of checks) { if (!ok) failures++; report.push(`${ok ? "pass" : "FAIL"} ${msg}`); }

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(Object.fromEntries(entries.map((e) => [e.name, e.hex]))));
  process.exit(failures ? 1 : 0);
}
console.log(report.join("\n"));
console.log(`\n${failures === 0 ? "palette ok" : failures + " problem(s)"}`);
process.exit(failures ? 1 : 0);
