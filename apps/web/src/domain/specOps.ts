import type { EnvironmentSpec } from "../contract";

export function nextId(spec: EnvironmentSpec, type: string): string {
  let n = 0;
  const prefix = `${type}_`;
  for (const o of spec.objects) {
    if (!o.id.startsWith(prefix)) continue;
    const tail = Number(o.id.slice(prefix.length));
    if (Number.isInteger(tail)) n = Math.max(n, tail);
  }
  return `${prefix}${String(n + 1).padStart(3, "0")}`;
}

export interface SpecDiff {
  added: string[];
  removed: string[];
  moved: string[];
}

export function diffSpecs(a: EnvironmentSpec, b: EnvironmentSpec): SpecDiff {
  const before = new Map(a.objects.map((o) => [o.id, o]));
  const added: string[] = [];
  const moved: string[] = [];
  for (const o of b.objects) {
    const p = before.get(o.id);
    if (!p) added.push(o.id);
    else if (p.position.some((v, i) => Math.abs(v - o.position[i]!) > 1e-6) || p.rotation.some((v, i) => Math.abs(v - o.rotation[i]!) > 1e-6)) moved.push(o.id);
    before.delete(o.id);
  }
  return { added, removed: [...before.keys()], moved };
}

export function changeNote(d: SpecDiff, environmentChanged: boolean): string {
  const parts = [
    d.moved.length && `Moved ${d.moved.length}`,
    d.added.length && `added ${d.added.length}`,
    d.removed.length && `removed ${d.removed.length}`,
    environmentChanged && "edited the environment",
  ].filter((p): p is string => Boolean(p));
  if (!parts.length) return "No changes";
  const text = parts.join(", ");
  return text[0]!.toUpperCase() + text.slice(1);
}

export async function specHash(spec: EnvironmentSpec): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}

export const sameSpec = (a: EnvironmentSpec | null, b: EnvironmentSpec | null) => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
