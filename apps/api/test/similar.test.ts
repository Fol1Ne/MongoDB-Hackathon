import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { buildSimilarPipeline } from "../src/similar";
import { startTestApp } from "./helpers";

describe("buildSimilarPipeline", () => {
  it("lets Atlas embed the query text, pre-filters, and excludes the source environment", () => {
    const id = new ObjectId();
    const [first] = buildSimilarPipeline({ text: "warehouse with a dock", type: "warehouse", excludeEnvironmentId: id, limit: 3 });
    expect(first).toEqual({
      $vectorSearch: {
        index: "env_summary_autoembed", path: "summaryText", query: { text: "warehouse with a dock" },
        numCandidates: 100, limit: 15, filter: { "spec.environment.type": "warehouse", environmentId: { $ne: id } },
      },
    });
  });

  it("keeps the best version per environment and caps the results", () => {
    const pipeline = buildSimilarPipeline({ text: "x", limit: 2 });
    expect(pipeline.map((stage) => Object.keys(stage)[0]))
      .toEqual(["$vectorSearch", "$project", "$sort", "$group", "$replaceWith", "$sort", "$limit"]);
    expect(pipeline[0]?.$vectorSearch.filter).toBeUndefined();
    expect(pipeline.at(-1)).toEqual({ $limit: 2 });
  });
});

describe("GET /api/v1/environments/similar", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => { t = await startTestApp(); }, 120_000);
  afterAll(async () => { await t?.stop(); });

  it("returns 503 SEARCH_UNAVAILABLE instead of a 500 where vector search isn't available", async () => {
    // Local mongod has no Atlas Vector Search. A 503 (not a 400 "Invalid id") also proves the static
    // route wins over /environments/:id.
    const res = await t.app.inject({ method: "GET", url: "/api/v1/environments/similar?text=warehouse%20with%20shelves" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("SEARCH_UNAVAILABLE");
  });

  it("requires text or environmentId", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/v1/environments/similar" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });

  it("404s for an unknown environmentId", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/v1/environments/similar?environmentId=${new ObjectId().toHexString()}` });
    expect(res.statusCode).toBe(404);
  });
});
