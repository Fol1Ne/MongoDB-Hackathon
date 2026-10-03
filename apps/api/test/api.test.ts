import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { clone, makeSpec } from "../../../packages/validator/test/fixtures";
import { startTestApp } from "./helpers";

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => { t = await startTestApp(); }, 120_000);
afterAll(async () => { await t?.stop(); });

const call = async (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => {
  const res = await t.app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) });
  return { status: res.statusCode, body: res.json() };
};
const withShelfAt = (z: number) => {
  const s = clone(makeSpec());
  s.objects[1]!.position = [10, 0, z];
  return s;
};

describe("versioning, history, revert", () => {
  it("creates v1, edits to v2 and v3, lists history in order", async () => {
    const created = await call("POST", "/api/v1/environments", { spec: makeSpec(), changeNote: "initial" });
    expect(created.status).toBe(201);
    const id = created.body.environment.id as string;
    expect(created.body.version.version).toBe(1);
    expect(created.body.version.parentVersionId).toBeNull();

    const v2 = await call("PUT", `/api/v1/environments/${id}`, { spec: withShelfAt(25), changeNote: "move shelf" });
    expect(v2.status).toBe(200);
    expect(v2.body.version.version).toBe(2);
    expect(v2.body.version.parentVersionId).toBe(created.body.version.id);

    const v3 = await call("PUT", `/api/v1/environments/${id}`, { spec: withShelfAt(30) });
    expect(v3.body.version.version).toBe(3);
    expect(v3.body.environment.versionCount).toBe(3);

    const head = await call("GET", `/api/v1/environments/${id}`);
    expect(head.body.environment.headVersionId).toBe(v3.body.version.id);
    expect(head.body.version.spec.objects[1].position[2]).toBe(30);

    const hist = await call("GET", `/api/v1/environments/${id}/versions`);
    expect(hist.body.items.map((v: any) => v.version)).toEqual([1, 2, 3]);
    expect(hist.body.items[0].spec).toBeUndefined();
    const desc = await call("GET", `/api/v1/environments/${id}/versions?order=desc`);
    expect(desc.body.items.map((v: any) => v.version)).toEqual([3, 2, 1]);

    const one = await call("GET", `/api/v1/environments/${id}/versions/1`);
    expect(one.body.version.spec.objects[1].position[2]).toBe(20); // v1 untouched by later edits
  });

  it("ACCEPTANCE: create, v2, v3, revert to v1 -> v4, history intact, invalid edit rejected", async () => {
    const id = (await call("POST", "/api/v1/environments", { spec: makeSpec() })).body.environment.id as string;
    await call("PUT", `/api/v1/environments/${id}`, { spec: withShelfAt(25) });
    await call("PUT", `/api/v1/environments/${id}`, { spec: withShelfAt(30) });
    const before = await call("GET", `/api/v1/environments/${id}/versions/1`);

    const rev = await call("POST", `/api/v1/environments/${id}/revert`, { toVersion: 1 });
    expect(rev.status).toBe(201);
    expect(rev.body.version.version).toBe(4);
    expect(rev.body.version.revertedFromVersion).toBe(1);
    const hist3 = await call("GET", `/api/v1/environments/${id}/versions`);
    expect(hist3.body.items[2].id).toBe(rev.body.version.parentVersionId); // parent is v3
    expect(rev.body.version.spec).toEqual(before.body.version.spec);

    const hist = await call("GET", `/api/v1/environments/${id}/versions`);
    expect(hist.body.items.map((v: any) => v.version)).toEqual([1, 2, 3, 4]);
    const head = await call("GET", `/api/v1/environments/${id}`);
    expect(head.body.environment.headVersionId).toBe(rev.body.version.id);
    expect((await call("GET", `/api/v1/environments/${id}/versions/1`)).body).toEqual(before.body);

    const bad = clone(makeSpec());
    bad.objects[1]!.position = [10, 0, 15.2]; // overlaps shelf_001
    const rejected = await call("PUT", `/api/v1/environments/${id}`, { spec: bad });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("VALIDATION_FAILED");
    expect(rejected.body.error.details[0]).toMatchObject({ code: "OVERLAP", path: "objects[1]" });

    const after = await call("GET", `/api/v1/environments/${id}/versions`);
    expect(after.body.items.map((v: any) => v.version)).toEqual([1, 2, 3, 4]);
    expect((await call("GET", `/api/v1/environments/${id}`)).body.environment.versionCount).toBe(4);
    expect(await t.db.collection("environment_versions").countDocuments({ environmentId: new ObjectId(id) })).toBe(4);
  });

  it("rejects invalid creates without writing anything", async () => {
    const n = await t.db.collection("environments").countDocuments();
    const bad = clone(makeSpec()) as any;
    bad.environment.dimensions.width = -1;
    const r = await call("POST", "/api/v1/environments", { spec: bad });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].code).toBe("INVALID_DIMENSIONS");
    expect(await t.db.collection("environments").countDocuments()).toBe(n);
  });

  it("returns 404 / 400 / 409 appropriately", async () => {
    const ghost = new ObjectId().toString();
    expect((await call("GET", `/api/v1/environments/${ghost}`)).status).toBe(404);
    expect((await call("PUT", `/api/v1/environments/${ghost}`, { spec: makeSpec() })).body.error.code).toBe("NOT_FOUND");
    expect((await call("GET", `/api/v1/environments/not-an-id`)).status).toBe(400);

    const id = (await call("POST", "/api/v1/environments", { spec: makeSpec() })).body.environment.id as string;
    expect((await call("GET", `/api/v1/environments/${id}/versions/9`)).status).toBe(404);
    expect((await call("POST", `/api/v1/environments/${id}/revert`, { toVersion: 7 })).status).toBe(404);
    expect((await call("POST", `/api/v1/environments/${id}/revert`, { toVersion: 1 })).body.error.code).toBe("ALREADY_AT_VERSION");
    await call("PUT", `/api/v1/environments/${id}`, { spec: withShelfAt(25) });
    const stale = await call("PUT", `/api/v1/environments/${id}`, { spec: withShelfAt(30), baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect((await call("GET", `/api/v1/environments/${id}/versions`)).body.items).toHaveLength(2);
  });

  it("serialises concurrent saves into distinct sequential versions", async () => {
    const id = (await call("POST", "/api/v1/environments", { spec: makeSpec() })).body.environment.id as string;
    const results = await Promise.all([25, 26, 27, 28].map((z) => call("PUT", `/api/v1/environments/${id}`, { spec: withShelfAt(z) })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const hist = await call("GET", `/api/v1/environments/${id}/versions`);
    expect(hist.body.items.map((v: any) => v.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it("lists environments, newest first, with filters", async () => {
    const r = await call("GET", "/api/v1/environments?limit=2");
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeLessThanOrEqual(2);
    expect(r.body.total).toBeGreaterThan(0);
    const filtered = await call("GET", "/api/v1/environments?type=office");
    expect(filtered.body.items).toHaveLength(0);
  });

  it("validate endpoint is stateless; catalogue endpoint works", async () => {
    const bad = clone(makeSpec()) as any;
    bad.objects[0].type = "nope";
    const v = await call("POST", "/api/v1/environments/validate", { spec: bad });
    expect(v.body.valid).toBe(false);
    expect((await call("GET", "/api/v1/assets/catalogue")).body.assets.length).toBeGreaterThanOrEqual(10);
  });
});

describe("MongoDB $jsonSchema safety net", () => {
  it("rejects structurally invalid versions even if the app layer is bypassed", async () => {
    const col = t.db.collection("environment_versions");
    const good = makeSpec();
    const mk = (over: object) => ({ environmentId: new ObjectId(), version: 1, schemaVersion: "1.0.0", spec: good, createdAt: new Date(), ...over });
    // version is a double/int? 1 serialises as int32 by the driver, so the good doc passes:
    await expect(col.insertOne(mk({}) as any)).resolves.toBeTruthy();
    await expect(col.insertOne(mk({ version: 0 }) as any)).rejects.toMatchObject({ code: 121 });
    await expect(col.insertOne(mk({ spec: { ...good, environment: { ...good.environment, type: "spaceship" } } }) as any)).rejects.toMatchObject({ code: 121 });
    await expect(col.insertOne(mk({ spec: { ...good, objects: "nope" } }) as any)).rejects.toMatchObject({ code: 121 });
    await expect(col.insertOne({ environmentId: new ObjectId(), version: 1 } as any)).rejects.toMatchObject({ code: 121 });
  });
  it("is configured strict/error and the unique version index exists", async () => {
    const [info] = await t.db.listCollections({ name: "environment_versions" }).toArray();
    expect((info as any).options).toMatchObject({ validationLevel: "strict", validationAction: "error" });
    const idx = await t.db.collection("environment_versions").indexes();
    expect(idx.find((i) => i.name === "env_version_unique")).toMatchObject({ unique: true, key: { environmentId: 1, version: -1 } });
  });
});
