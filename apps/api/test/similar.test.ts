import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoServerError, ObjectId } from "mongodb";
import { buildSimilarPipeline } from "../src/similar";
import { isSearchUnavailable } from "../src/repository";
import { startTestApp } from "./helpers";

describe("buildSimilarPipeline", () => {
  it("lets Atlas embed the query text, pre-filters, and excludes the source environment", () => {
    const id = new ObjectId();
    const [first] = buildSimilarPipeline({ text: "warehouse with a dock", type: "warehouse", excludeEnvironmentId: id, limit: 3 });
    expect(first).toEqual({
      $vectorSearch: {
        index: "env_summary_autoembed", path: "summaryText", query: { text: "warehouse with a dock" },
        numCandidates: 200, limit: 200, filter: { "spec.environment.type": "warehouse", environmentId: { $ne: id } },
      },
    });
  });

  it("keeps only current head versions, so old versions can't crowd out other environments", () => {
    const pipeline = buildSimilarPipeline({ text: "x", limit: 2 });
    expect(pipeline.map((stage) => Object.keys(stage)[0]))
      .toEqual(["$vectorSearch", "$addFields", "$lookup", "$match", "$project", "$sort", "$limit"]);
    expect(pipeline[1]).toEqual({ $addFields: { score: { $meta: "vectorSearchScore" } } });
    expect(pipeline[2]).toMatchObject({ $lookup: { from: "environments", localField: "_id", foreignField: "headVersionId" } });
    expect(pipeline[0]?.$vectorSearch.filter).toBeUndefined();
    expect(pipeline.at(-1)).toEqual({ $limit: 2 });
  });

  it("scales candidates with the requested limit", () => {
    expect(buildSimilarPipeline({ text: "x", limit: 20 })[0]?.$vectorSearch).toMatchObject({ numCandidates: 800, limit: 800 });
  });
});

describe("isSearchUnavailable", () => {
  const err = (fields: object) => new MongoServerError(fields as any);

  it.each([
    ["$vectorSearch outside Atlas", { errmsg: "$vectorSearch is only allowed on MongoDB Atlas", code: 6047401 }],
    ["search not enabled", { errmsg: "Using $search requires Atlas", code: 31082, codeName: "SearchNotEnabled" }],
    ["the M0 embedding rate limit", { errmsg: "PlanExecutor error :: caused by :: Embedding provider rate limit exceeded, retry later", code: 8 }],
  ])("treats %s as unavailable (503)", (_name, fields) => {
    expect(isSearchUnavailable(err(fields))).toBe(true);
  });

  it.each([
    ["a malformed pipeline", { errmsg: "Unrecognized pipeline stage name: '$vectorSerch'", code: 40324 }],
    ["a bad value", { errmsg: "limit must be positive", code: 2, codeName: "BadValue" }],
  ])("lets %s through as a real error (500)", (_name, fields) => {
    expect(isSearchUnavailable(err(fields))).toBe(false);
  });

  it("ignores non-server errors", () => {
    expect(isSearchUnavailable(new Error("boom"))).toBe(false);
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
