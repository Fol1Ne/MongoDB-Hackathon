import { describe, expect, it } from "vitest";
import versions from "../contract/fixtures/warehouse.versions.json";
import invalid from "../contract/fixtures/warehouse.invalid.json";
import { EnvironmentSpecSchema } from "../contract";
import { copyFor } from "./errors";
import { createHttpClient } from "./http";
import { createMockClient, DEMO_ENV_ID } from "./mock";
import { browserOrMemoryPhotos, browserOrMemoryStore } from "./storage";
import { ERROR_CODES, type ApiError, type Phase, type PreparedPhoto } from "./types";

const fresh = (failCode: string | null = null) => createMockClient({ store: browserOrMemoryStore(), photoStore: browserOrMemoryPhotos(), latencyMs: 0, failCode });
const v3 = EnvironmentSpecSchema.parse(versions[2]!.spec);
const photo = (name: string): PreparedPhoto => ({ id: name, name, blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), width: 2048, height: 1536, bytes: 4, originalBytes: 3_000_000 });

describe("mock client", () => {
  it("seeds the demo warehouse with its three versions", async () => {
    const api = fresh();
    const list = await api.listEnvironments();
    expect(list.ok && list.data.map((e) => e.name)).toEqual(["Demo warehouse"]);
    const vs = await api.listVersions(DEMO_ENV_ID);
    expect(vs.ok && vs.data.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("saves a new version and rejects a stale base version", async () => {
    const api = fresh();
    const moved = structuredClone(v3);
    moved.objects.find((o) => o.id === "forklift_003")!.position = [17, 0, 18];
    const saved = await api.save(DEMO_ENV_ID, { spec: moved, changeNote: "Moved 1", baseVersion: 3 });
    expect(saved.ok && saved.data.version.version).toBe(4);
    const stale = await api.save(DEMO_ENV_ID, { spec: moved, changeNote: "again", baseVersion: 3 });
    expect(!stale.ok && stale.error.kind === "http" && stale.error.code).toBe("VERSION_CONFLICT");
  });

  it("refuses an invalid spec the way the real API does", async () => {
    const api = fresh();
    const r = await api.save(DEMO_ENV_ID, { spec: EnvironmentSpecSchema.parse(invalid), changeNote: "bad", baseVersion: 3 });
    expect(!r.ok && r.error.kind === "http" && r.error.details.map((d) => d.code)).toEqual(expect.arrayContaining(["UNKNOWN_ASSET_TYPE", "OUT_OF_BOUNDS"]));
  });

  it("restores an old version as a new head and refuses to restore the head", async () => {
    const api = fresh();
    const head = await api.revert(DEMO_ENV_ID, { toVersion: 3, baseVersion: 3 });
    expect(!head.ok && head.error.kind === "http" && head.error.code).toBe("ALREADY_AT_VERSION");
    const r = await api.revert(DEMO_ENV_ID, { toVersion: 1, baseVersion: 3 });
    expect(r.ok && [r.data.version.version, r.data.version.revertedFromVersion]).toEqual([4, 1]);
  });

  it("builds an environment from photos, keeps the photos, and reports each phase", async () => {
    const api = fresh();
    const phases: Phase[] = [];
    const r = await api.fromImages({ photos: [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")], hint: "Loading dock on the south wall", knownDimension: { kind: "door_height", meters: 2.1 } }, { onPhase: (p) => phases.push(p) });
    expect(phases).toEqual(["uploading", "analyzing", "estimating", "drafting", "validating", "saving"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.version.spec.provenance.source).toBe("image");
    expect(r.data.version.spec.provenance.prompt).toBe("3 photos. Loading dock on the south wall. Scale hint: door height 2.1 m");
    expect(Object.values(r.data.confidence ?? {}).filter((c) => c < 0.5).length).toBe(11);
    const stored = await api.photos(r.data.environment.id);
    expect(stored.ok && stored.data.map((p) => p.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("stops when cancelled and passes injected provider failures through", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await fresh().generate({ prompt: "A small warehouse" }, { signal: controller.signal });
    expect(!cancelled.ok && cancelled.error.kind).toBe("aborted");
    const busy = await fresh("PROVIDER_UNAVAILABLE").generate({ prompt: "A small warehouse" });
    expect(!busy.ok && busy.error.kind === "http" && busy.error.code).toBe("PROVIDER_UNAVAILABLE");
  });
});

describe("http client", () => {
  const written = (version: number) => ({
    environment: { id: "66f000000000000000000001", name: "Warehouse Environment", type: "warehouse", headVersionId: "x", versionCount: version, tags: [], projectId: null, ownerId: null, createdAt: "2026-10-03T12:00:00.000Z", updatedAt: "2026-10-03T12:00:00.000Z" },
    version: { id: "x", environmentId: "66f000000000000000000001", version, parentVersionId: null, schemaVersion: "1.0.0", summaryText: "s", changeNote: null, revertedFromVersion: null, createdAt: "2026-10-03T12:00:00.000Z", spec: v3 },
    warnings: [],
  });
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("parses the docs/api.md save response", async () => {
    const api = createHttpClient({ baseUrl: "/api/v1", fetch: async () => json(200, written(4)) });
    const r = await api.save("66f000000000000000000001" as never, { spec: v3, changeNote: "n", baseVersion: 3 });
    expect(r.ok && r.data.version.version).toBe(4);
  });

  it("maps the shared error body, validation details, and Retry-After", async () => {
    const api = createHttpClient({
      baseUrl: "/api/v1",
      fetch: async (url) => String(url).endsWith("/versions?limit=500")
        ? json(429, { error: { code: "RATE_LIMITED", message: "slow down" } }, { "retry-after": "7" })
        : json(400, { error: { code: "VALIDATION_FAILED", message: "Spec invalid", details: [{ path: "objects[3].position", code: "OUT_OF_BOUNDS", message: "x" }] } }),
    });
    const bad = await api.save("66f000000000000000000001" as never, { spec: v3, changeNote: "n", baseVersion: 3 });
    expect(!bad.ok && bad.error.kind === "http" && bad.error.details[0]?.code).toBe("OUT_OF_BOUNDS");
    const limited = await api.listVersions("66f000000000000000000001" as never);
    expect(!limited.ok && copyFor(limited.error).message).toBe("Try again in 7 seconds.");
  });

  it("builds locally and saves through POST /environments while the photo route is missing", async () => {
    const calls: string[] = [];
    const api = createHttpClient({
      baseUrl: "/api/v1",
      photoStore: browserOrMemoryPhotos(),
      fetch: async (url, init) => {
        calls.push(`${init?.method} ${url}`);
        return String(url).endsWith("/from-images") ? json(404, { error: { code: "NOT_FOUND", message: "Route not found" } }) : json(201, written(1));
      },
    });
    const r = await api.fromImages({ photos: [photo("a.jpg")], hint: "", knownDimension: null });
    expect(calls).toEqual(["POST /api/v1/environments/from-images", "POST /api/v1/environments"]);
    expect(r.ok && r.data.origin).toBe("local");
  });

  it("reports a malformed response as a schema error instead of crashing", async () => {
    const api = createHttpClient({ baseUrl: "/api/v1", fetch: async () => json(200, { items: [{ id: 3 }] }) });
    const r = await api.listEnvironments();
    expect(!r.ok && r.error.kind).toBe("schema");
  });
});

describe("error copy", () => {
  it("has a title for every server code", () => {
    for (const code of ERROR_CODES) {
      const e: ApiError = { kind: "http", status: 400, code, message: "", details: [], retryAfterSec: null };
      expect(copyFor(e).title.length).toBeGreaterThan(3);
    }
  });
});
