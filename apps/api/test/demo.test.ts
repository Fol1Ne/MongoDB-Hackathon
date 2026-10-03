import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateAndParse } from "@twin/validator";
import { loadDemoScenes, seedDemoScenes } from "../src/demo";
import { EnvironmentRepository } from "../src/repository";
import { startTestApp } from "./helpers";

describe("demo scenes", () => {
  const scenes = loadDemoScenes();

  it("ships warehouse, factory, office and outdoor scenes", () => {
    expect(scenes.map((s) => s.file)).toEqual(["factory.json", "office.json", "outdoor.json", "warehouse.json"]);
    expect(new Set(scenes.map((s) => (s.spec as any).environment.type))).toEqual(new Set(["warehouse", "factory", "office", "outdoor"]));
  });

  it.each(scenes.map((s) => [s.file, s.spec] as const))("%s validates with no errors or warnings", (_file, spec) => {
    expect(validateAndParse(spec).result).toEqual({ valid: true, errors: [], warnings: [] });
  });
});

describe("seedDemoScenes", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => { t = await startTestApp(); }, 120_000);
  afterAll(async () => { await t?.stop(); });

  it("creates one environment per scene and is idempotent", async () => {
    const repo = new EnvironmentRepository(t.client, t.db);
    const first = await seedDemoScenes(repo);
    expect(first.map((r) => r.status)).toEqual(["created", "created", "created", "created"]);
    const second = await seedDemoScenes(repo);
    expect(second.map((r) => r.status)).toEqual(["exists", "exists", "exists", "exists"]);
    expect((await repo.list({}, { limit: 10, offset: 0 })).total).toBe(4);
  });
});
