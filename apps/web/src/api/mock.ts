import { ASSET_CATALOGUE, validateAndParse, type EnvironmentSpec, type ValidationError } from "../contract";
import { DEMO_VERSIONS, localPhotoSpec, localTextSpec } from "./local";
import { browserOrMemoryPhotos, browserOrMemoryStore, type KeyValue, type PhotoStore } from "./storage";
import {
  fail,
  isApiErrorCode,
  ok,
  type ApiClient,
  type ApiError,
  type CallOptions,
  type Confidence,
  type Created,
  type EnvId,
  type EnvironmentDto,
  type Phase,
  type Result,
  type VersionDto,
  type Written,
} from "./types";

interface Record_ {
  environment: EnvironmentDto;
  versions: VersionDto[];
  confidence: Confidence | null;
}
type Db = Record<string, Record_>;

const KEY = "twin.mock.v1";
export const DEMO_ENV_ID = "65f000000000000000000001" as EnvId;

export interface MockOptions {
  store?: KeyValue;
  photoStore?: PhotoStore;
  latencyMs?: number;
  failCode?: string | null;
  now?: () => Date;
}

const hex24 = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");

function summary(spec: EnvironmentSpec): string {
  const { name, type, dimensions: d } = spec.environment;
  return `${name}: ${type} ${d.width}x${d.length}x${d.height}m, ${spec.terrain.type} floor, ${spec.objects.length} objects`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const t = setTimeout(() => resolve(true), ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(false); }, { once: true });
  });
}

function httpError(code: string, message: string, details: ValidationError[] = []): ApiError {
  const status = code === "NOT_FOUND" ? 404 : code === "VERSION_CONFLICT" || code === "ALREADY_AT_VERSION" ? 409 : code === "RATE_LIMITED" ? 429 : code === "PROVIDER_UNAVAILABLE" ? 503 : 400;
  return { kind: "http", status, code: isApiErrorCode(code) ? code : "INTERNAL", message, details, retryAfterSec: code === "RATE_LIMITED" ? 10 : null };
}

export function createMockClient(opts: MockOptions = {}): ApiClient {
  const store = opts.store ?? browserOrMemoryStore();
  const photoStore = opts.photoStore ?? browserOrMemoryPhotos();
  const latency = opts.latencyMs ?? 1;
  const now = opts.now ?? (() => new Date());

  const load = (): Db => {
    const db = store.get<Db>(KEY);
    if (db && Object.keys(db).length) return db;
    const seeded: Db = {};
    const created = "2026-10-03T12:10:00.000Z";
    const versions: VersionDto[] = DEMO_VERSIONS.map((v, i) => ({
      id: `65f0000000000000000000${String(v.version + 10)}`, environmentId: DEMO_ENV_ID, version: v.version,
      parentVersionId: i ? `65f0000000000000000000${String(v.version + 9)}` : null, summaryText: summary(v.spec),
      changeNote: v.changeNote, revertedFromVersion: null, createdAt: v.createdAt, spec: v.spec,
    }));
    seeded[DEMO_ENV_ID] = {
      environment: { id: DEMO_ENV_ID, name: "Demo warehouse", type: "warehouse", headVersionId: versions.at(-1)!.id, versionCount: versions.length, tags: ["warehouse", "demo"], createdAt: created, updatedAt: versions.at(-1)!.createdAt },
      versions, confidence: null,
    };
    store.set(KEY, seeded);
    return seeded;
  };
  const save = (db: Db) => store.set(KEY, db);
  const find = (db: Db, id: EnvId) => db[id];

  const append = (db: Db, id: EnvId, spec: EnvironmentSpec, note: string, revertedFrom: number | null): Written => {
    const rec = db[id]!;
    const head = rec.versions.at(-1)!;
    const v: VersionDto = { id: hex24(), environmentId: id, version: head.version + 1, parentVersionId: head.id, summaryText: summary(spec), changeNote: note, revertedFromVersion: revertedFrom, createdAt: now().toISOString(), spec };
    rec.versions.push(v);
    rec.environment = { ...rec.environment, name: spec.environment.name, headVersionId: v.id, versionCount: rec.versions.length, updatedAt: v.createdAt };
    save(db);
    return { environment: rec.environment, version: v };
  };

  const create = (spec: EnvironmentSpec, note: string, confidence: Confidence | null): Created => {
    const db = load();
    const id = hex24() as EnvId;
    const at = now().toISOString();
    const version: VersionDto = { id: hex24(), environmentId: id, version: 1, parentVersionId: null, summaryText: summary(spec), changeNote: note, revertedFromVersion: null, createdAt: at, spec };
    const environment: EnvironmentDto = { id, name: spec.environment.name, type: spec.environment.type, headVersionId: version.id, versionCount: 1, tags: [spec.environment.type], createdAt: at, updatedAt: at };
    db[id] = { environment, versions: [version], confidence };
    save(db);
    return { environment, version, confidence, origin: "local" };
  };

  const injected = (): ApiError | null => (opts.failCode ? httpError(opts.failCode, `Injected ${opts.failCode}`) : null);

  async function run(phases: readonly Phase[], weights: readonly number[], o: CallOptions | undefined): Promise<ApiError | null> {
    for (let i = 0; i < phases.length; i++) {
      o?.onPhase?.(phases[i]!);
      if (!(await sleep(latency * weights[i]!, o?.signal))) return { kind: "aborted" };
      const err = i === phases.length - 2 ? injected() : null;
      if (err) return err;
    }
    return null;
  }

  return {
    mode: "mock",
    async catalogue() {
      return ok([...ASSET_CATALOGUE]);
    },
    async listEnvironments() {
      const db = load();
      return ok(Object.values(db).map((r) => r.environment).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async getHead(id) {
      const rec = find(load(), id);
      if (!rec) return fail(httpError("NOT_FOUND", "Environment not found"));
      return ok({ environment: rec.environment, version: rec.versions.at(-1)!, confidence: rec.confidence });
    },
    async listVersions(id) {
      const rec = find(load(), id);
      if (!rec) return fail(httpError("NOT_FOUND", "Environment not found"));
      return ok(rec.versions.map(({ spec: _spec, ...meta }) => meta));
    },
    async getVersion(id, n) {
      const v = find(load(), id)?.versions.find((x) => x.version === n);
      return v ? ok(v) : fail(httpError("NOT_FOUND", "Version not found"));
    },
    async save(id, input): Promise<Result<Written>> {
      await sleep(latency * 300);
      const db = load();
      const rec = find(db, id);
      if (!rec) return fail(httpError("NOT_FOUND", "Environment not found"));
      if (opts.failCode === "VERSION_CONFLICT" || input.baseVersion !== rec.versions.at(-1)!.version) return fail(httpError("VERSION_CONFLICT", "baseVersion is stale"));
      const { result, spec } = validateAndParse(input.spec);
      if (!result.valid || !spec) return fail(httpError("VALIDATION_FAILED", "Spec invalid", result.errors));
      return ok(append(db, id, spec, input.changeNote, null));
    },
    async revert(id, input) {
      await sleep(latency * 300);
      const db = load();
      const rec = find(db, id);
      if (!rec) return fail(httpError("NOT_FOUND", "Environment not found"));
      const head = rec.versions.at(-1)!;
      if (input.baseVersion !== head.version) return fail(httpError("VERSION_CONFLICT", "baseVersion is stale"));
      if (input.toVersion === head.version) return fail(httpError("ALREADY_AT_VERSION", `Version ${input.toVersion} is already the head`));
      const target = rec.versions.find((v) => v.version === input.toVersion);
      if (!target) return fail(httpError("NOT_FOUND", "Version not found"));
      return ok(append(db, id, structuredClone(target.spec), `Restored version ${input.toVersion}`, input.toVersion));
    },
    async generate(input, o) {
      const err = await run(["drafting", "validating", "saving"], [2200, 900, 500], o);
      if (err) return fail(err);
      return ok(create(localTextSpec(input.prompt), "Generated from prompt", null));
    },
    async fromImages(input, o) {
      if (!input.photos.length) return fail({ kind: "photo", message: "Add at least one photo." });
      const err = await run(["uploading", "analyzing", "estimating", "drafting", "validating", "saving"], [700, 1600, 1100, 1200, 700, 400], o);
      if (err) return fail(err);
      const { spec, confidence } = localPhotoSpec(input.photos.length, input.hint, input.knownDimension);
      const created = create(spec, `Built from ${input.photos.length} photo${input.photos.length === 1 ? "" : "s"}`, confidence);
      await photoStore.put(created.environment.id, input.photos.map(({ name, blob, width, height }) => ({ name, blob, width, height })));
      return ok(created);
    },
    async photos(id) {
      return ok(await photoStore.get(id));
    },
  };
}
