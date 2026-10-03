import { Int32, MongoServerError, ObjectId, type Collection, type Db, type MongoClient } from "mongodb";
import type { EnvironmentSpec } from "@twin/schema";
import { AppError, conflict, notFound } from "./errors";
import { VECTOR_INDEX } from "./db/vectorIndex";
import { buildSimilarPipeline, type SimilarHit, type SimilarQuery } from "./similar";

/**
 * Errors meaning "vector search isn't available here or right now" (a 503), as opposed to real bugs such as a
 * malformed pipeline, which must surface as 500s: $vectorSearch outside Atlas (6047401), search not enabled
 * (31082 SearchNotEnabled), and Atlas's embedding-provider rate limit (M0: 3 queries/min without a payment method).
 */
export function isSearchUnavailable(e: unknown): e is MongoServerError {
  if (!(e instanceof MongoServerError)) return false;
  return e.code === 6047401 || e.code === 31082 || e.codeName === "SearchNotEnabled" || /rate limit exceeded/i.test(e.message);
}

const searchUnavailable = (reason: string, codeName?: string) =>
  new AppError(503, "SEARCH_UNAVAILABLE", "Vector search is not available right now", [{ reason, ...(codeName && { codeName }) }]);

export interface EnvironmentDoc {
  _id: ObjectId;
  projectId?: ObjectId;
  ownerId?: ObjectId;
  name: string;
  type: EnvironmentSpec["environment"]["type"];
  headVersionId: ObjectId;
  versionCount: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
export interface VersionDoc {
  _id: ObjectId;
  environmentId: ObjectId;
  version: number;
  parentVersionId: ObjectId | null;
  schemaVersion: string;
  spec: EnvironmentSpec;
  summaryText: string;
  changeNote: string | null;
  revertedFromVersion?: number;
  createdBy?: ObjectId;
  createdAt: Date;
}

export interface WriteMeta {
  changeNote?: string | null;
  createdBy?: ObjectId;
  /** Optimistic concurrency: reject with 409 unless this equals the current head version. */
  baseVersion?: number;
}

/** Deterministic text used for display and (later) embeddings. */
export function summarizeSpec(spec: EnvironmentSpec): string {
  const { name, dimensions } = spec.environment;
  const counts = new Map<string, number>();
  for (const o of spec.objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  const parts = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${n} ${t}`);
  return `${name}: ${spec.environment.type} ${dimensions.width}x${dimensions.length}x${dimensions.height}m, ${spec.terrain.type} floor, ${spec.objects.length} objects${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

export class EnvironmentRepository {
  readonly environments: Collection<EnvironmentDoc>;
  readonly versions: Collection<VersionDoc>;

  constructor(private client: MongoClient, db: Db) {
    this.environments = db.collection<EnvironmentDoc>("environments");
    this.versions = db.collection<VersionDoc>("environment_versions");
  }

  /** Inserts environment + version 1 in one transaction. `spec` MUST already be validated. */
  async create(spec: EnvironmentSpec, opts: WriteMeta & { tags?: string[]; ownerId?: ObjectId; projectId?: ObjectId } = {}) {
    const now = new Date();
    const envId = new ObjectId();
    const versionId = new ObjectId();
    const version: VersionDoc = {
      _id: versionId, environmentId: envId, version: new Int32(1) as unknown as number, parentVersionId: null,
      schemaVersion: spec.schemaVersion, spec, summaryText: summarizeSpec(spec),
      changeNote: opts.changeNote ?? null, ...(opts.createdBy && { createdBy: opts.createdBy }), createdAt: now,
    };
    const env: EnvironmentDoc = {
      _id: envId, ...(opts.projectId && { projectId: opts.projectId }), ...(opts.ownerId && { ownerId: opts.ownerId }),
      name: spec.environment.name, type: spec.environment.type, headVersionId: versionId,
      versionCount: new Int32(1) as unknown as number, tags: opts.tags ?? [spec.environment.type], createdAt: now, updatedAt: now,
    };
    await this.runTx(async (session) => {
      await this.versions.insertOne(version, { session });
      await this.environments.insertOne(env, { session });
    });
    return { environment: { ...env, versionCount: 1 }, version: { ...version, version: 1 } };
  }

  /** Appends an immutable version. `spec` MUST already be validated. */
  async saveVersion(envId: ObjectId, spec: EnvironmentSpec, meta: WriteMeta & { revertedFromVersion?: number } = {}) {
    return this.runTx(async (session) => {
      const env = await this.environments.findOne({ _id: envId }, { session });
      if (!env) throw notFound("Environment");
      if (meta.baseVersion !== undefined && meta.baseVersion !== env.versionCount) {
        throw conflict("VERSION_CONFLICT", `baseVersion ${meta.baseVersion} is stale; current head is version ${env.versionCount}`);
      }
      const next = env.versionCount + 1;
      const now = new Date();
      const version: VersionDoc = {
        _id: new ObjectId(), environmentId: envId, version: new Int32(next) as unknown as number,
        parentVersionId: env.headVersionId, schemaVersion: spec.schemaVersion, spec, summaryText: summarizeSpec(spec),
        changeNote: meta.changeNote ?? null,
        ...(meta.revertedFromVersion !== undefined && { revertedFromVersion: meta.revertedFromVersion }),
        ...(meta.createdBy && { createdBy: meta.createdBy }), createdAt: now,
      };
      await this.versions.insertOne(version, { session });
      const res = await this.environments.updateOne(
        { _id: envId, versionCount: env.versionCount },
        { $set: { headVersionId: version._id, name: spec.environment.name, type: spec.environment.type, updatedAt: now }, $inc: { versionCount: 1 } },
        { session },
      );
      if (res.matchedCount !== 1) throw conflict("VERSION_CONFLICT", "Environment was modified concurrently");
      return { environment: { ...env, headVersionId: version._id, versionCount: next, name: spec.environment.name, type: spec.environment.type, updatedAt: now }, version: { ...version, version: next } };
    });
  }

  async getEnvironment(id: ObjectId) {
    const env = await this.environments.findOne({ _id: id });
    if (!env) throw notFound("Environment");
    return env;
  }

  async getHead(id: ObjectId) {
    const env = await this.getEnvironment(id);
    const version = await this.versions.findOne({ _id: env.headVersionId });
    if (!version) throw new AppError(500, "INTERNAL", "Head version missing");
    return { environment: env, version };
  }

  async getVersion(id: ObjectId, n: number) {
    const v = await this.versions.findOne({ environmentId: id, version: n });
    if (!v) throw notFound(`Version ${n}`);
    return v;
  }

  async listVersions(id: ObjectId, o: { order: "asc" | "desc"; limit: number; offset: number }) {
    await this.getEnvironment(id);
    return this.versions
      .find({ environmentId: id }, { projection: { spec: 0 } })
      .sort({ version: o.order === "asc" ? 1 : -1 })
      .skip(o.offset).limit(o.limit).toArray();
  }

  async list(filter: { type?: string; tag?: string; ownerId?: ObjectId; projectId?: ObjectId }, o: { limit: number; offset: number }) {
    const q: Record<string, unknown> = {};
    if (filter.type) q.type = filter.type;
    if (filter.tag) q.tags = filter.tag;
    if (filter.ownerId) q.ownerId = filter.ownerId;
    if (filter.projectId) q.projectId = filter.projectId;
    const [items, total] = await Promise.all([
      this.environments.find(q).sort({ updatedAt: -1, _id: -1 }).skip(o.offset).limit(o.limit).toArray(),
      this.environments.countDocuments(q),
    ]);
    return { items, total };
  }

  /** Atlas Vector Search; a 503 where it isn't available (local mongod, index missing or building, M0 rate limit). */
  async similar(q: SimilarQuery): Promise<SimilarHit[]> {
    let hits: SimilarHit[];
    try {
      hits = await this.versions.aggregate<SimilarHit>(buildSimilarPipeline(q)).toArray();
    } catch (e) {
      if (isSearchUnavailable(e)) throw searchUnavailable(e.message, e.codeName);
      throw e;
    }
    if (hits.length === 0) {
      // Atlas answers [] rather than an error while the index is missing or still building; don't pass that off
      // as "nothing similar".
      const name = q.index ?? VECTOR_INDEX;
      const [index] = (await this.versions.listSearchIndexes(name).toArray()) as Array<{ status?: string; queryable?: boolean }>;
      if (!index?.queryable) throw searchUnavailable(`Vector index '${name}' is ${index ? `not queryable yet (${index.status})` : "missing"}; run npm run db:vector`);
    }
    return hits;
  }

  private async runTx<T>(fn: (session: import("mongodb").ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() => fn(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }) as T;
    } catch (e: any) {
      if (e?.code === 11000) throw conflict("VERSION_CONFLICT", "Concurrent write detected; retry");
      throw e;
    } finally {
      await session.endSession();
    }
  }
}
