import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateAndParse } from "@twin/validator";
import type { EnvironmentRepository } from "./repository";

const DEMO_DIR = fileURLToPath(new URL("../demo-scenes/", import.meta.url));

export interface DemoScene { file: string; spec: unknown }

/** Pre-built environments (warehouse, factory, office, outdoor): seed data, offline demo backup, LLM few-shot examples. */
export function loadDemoScenes(): DemoScene[] {
  return readdirSync(DEMO_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, spec: JSON.parse(readFileSync(DEMO_DIR + file, "utf8")) as unknown }));
}

export interface SeedResult { file: string; status: "created" | "exists"; id: string }

/** Creates each demo scene once (matched by environment name), through the same validation gate as the API. */
export async function seedDemoScenes(repo: EnvironmentRepository): Promise<SeedResult[]> {
  const out: SeedResult[] = [];
  for (const { file, spec: raw } of loadDemoScenes()) {
    const { result, spec } = validateAndParse(raw);
    if (!result.valid || !spec) throw new Error(`${file} is invalid: ${JSON.stringify(result.errors)}`);
    const existing = await repo.environments.findOne({ name: spec.environment.name });
    if (existing) {
      out.push({ file, status: "exists", id: String(existing._id) });
      continue;
    }
    const created = await repo.create(spec, { changeNote: "Seeded demo scene", tags: [spec.environment.type, "demo"] });
    out.push({ file, status: "created", id: String(created.environment._id) });
  }
  return out;
}
