import { createHash } from "node:crypto";
import type { EnvironmentSpec } from "@twin/schema";

interface CacheEntry {
  spec: EnvironmentSpec;
  provider: string;
  ts: number;
}

const store = new Map<string, CacheEntry>();
const TTL_MS = parseInt(process.env["LLM_CACHE_TTL_SECONDS"] ?? "3600", 10) * 1000;

export function cacheKey(prompt: string): string {
  return createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex");
}

export function getCached(key: string): { spec: EnvironmentSpec; provider: string } | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(key);
    return null;
  }
  return { spec: entry.spec, provider: entry.provider };
}

export function setCached(key: string, spec: EnvironmentSpec, provider: string): void {
  store.set(key, { spec, provider, ts: Date.now() });
}
