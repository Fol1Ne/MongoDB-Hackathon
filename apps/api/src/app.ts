import Fastify, { type FastifyInstance } from "fastify";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import { z } from "zod";
import { ASSET_CATALOGUE } from "@twin/catalogue";
import { validateAndParse } from "@twin/validator";
import { EnvironmentTypeSchema, type EnvironmentSpec } from "@twin/schema";
import { AppError, badRequest, conflict, validationFailed } from "./errors";
import { EnvironmentRepository, type EnvironmentDoc, type VersionDoc } from "./repository";
import { registerGenerateRoutes } from "./generate";
import type { SimilarHit } from "./similar";

const oid = (v: string, what = "id") => {
  if (!ObjectId.isValid(v) || String(new ObjectId(v)) !== v.toLowerCase()) throw badRequest(`Invalid ${what}`);
  return new ObjectId(v);
};
const hex = z.string().refine((v) => ObjectId.isValid(v) && v.length === 24, "must be a 24-char hex ObjectId");
const note = z.string().max(500).nullable().optional();
const base = z.number().int().min(1).optional();

const CreateBody = z.object({ spec: z.unknown(), changeNote: note, tags: z.array(z.string().min(1).max(64)).max(32).optional(), ownerId: hex.optional(), projectId: hex.optional() }).strict();
const SaveBody = z.object({ spec: z.unknown(), changeNote: note, baseVersion: base }).strict();
const RevertBody = z.object({ toVersion: z.number().int().min(1), changeNote: note, baseVersion: base }).strict();
const Paging = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) });
const ListQuery = Paging.extend({ type: z.string().optional(), tag: z.string().optional(), ownerId: hex.optional(), projectId: hex.optional() });
const VersionsQuery = Paging.extend({ order: z.enum(["asc", "desc"]).default("asc") });
const SimilarQuery = z
  .object({
    text: z.string().min(3).max(500).optional(),
    environmentId: hex.optional(),
    type: EnvironmentTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  })
  .refine((q) => q.text !== undefined || q.environmentId !== undefined, "Provide text or environmentId");

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw badRequest("Invalid request", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}

/** Zod -> semantic validation gate. The only way a spec reaches the repository. */
function requireValid(input: unknown) {
  const { result, spec } = validateAndParse(input);
  if (!result.valid || !spec) throw validationFailed(result.errors, result.warnings);
  return { spec, warnings: result.warnings };
}

const envDto = (e: EnvironmentDoc) => ({
  id: String(e._id), name: e.name, type: e.type, headVersionId: String(e.headVersionId), versionCount: e.versionCount,
  tags: e.tags, projectId: e.projectId ? String(e.projectId) : null, ownerId: e.ownerId ? String(e.ownerId) : null,
  createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
});
const versionMeta = (v: Omit<VersionDoc, "spec"> & { spec?: EnvironmentSpec }) => ({
  id: String(v._id), environmentId: String(v.environmentId), version: v.version,
  parentVersionId: v.parentVersionId ? String(v.parentVersionId) : null, schemaVersion: v.schemaVersion,
  summaryText: v.summaryText, changeNote: v.changeNote, revertedFromVersion: v.revertedFromVersion ?? null,
  createdAt: v.createdAt.toISOString(),
});
const versionDto = (v: VersionDoc) => ({ ...versionMeta(v), spec: v.spec });
const similarDto = (h: SimilarHit) => ({
  environmentId: String(h.environmentId), versionId: String(h._id), version: h.version,
  name: h.name, type: h.type, summaryText: h.summaryText, score: h.score,
});

export function buildApp(deps: { client: MongoClient; db: Db }): FastifyInstance {
  const repo = new EnvironmentRepository(deps.client, deps.db);
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details, warnings: err.warnings } });
    }
    if (err.validation || err.statusCode === 400 || err.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: err.message, details: [] } });
    }
    app.log.error(err);
    // MongoDB $jsonSchema rejection (code 121) means something slipped past the app layer; never expose internals.
    return reply.status(500).send({ error: { code: err?.code === 121 ? "DB_VALIDATION_FAILED" : "INTERNAL", message: "Internal error", details: [] } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "Route not found", details: [] } }));

  app.get("/health", async () => ({ ok: true }));

  app.register(async (api) => {
    api.get("/assets/catalogue", async () => ({ assets: ASSET_CATALOGUE }));

    // LLM generation endpoint (Person 1)
    await registerGenerateRoutes(api, repo);

    // Stateless validation for live editor feedback / LLM repair loop. Writes nothing.
    api.post("/environments/validate", async (req) => {
      const { result } = validateAndParse((req.body as { spec?: unknown } | undefined)?.spec);
      return result;
    });

    api.post("/environments", async (req, reply) => {
      const body = parse(CreateBody, req.body);
      const { spec, warnings } = requireValid(body.spec);
      const out = await repo.create(spec, {
        changeNote: body.changeNote, tags: body.tags,
        ...(body.ownerId && { ownerId: oid(body.ownerId, "ownerId") }), ...(body.projectId && { projectId: oid(body.projectId, "projectId") }),
      });
      return reply.status(201).send({ environment: envDto(out.environment), version: versionDto(out.version), warnings });
    });

    api.get("/environments", async (req) => {
      const q = parse(ListQuery, req.query);
      const { items, total } = await repo.list(
        { type: q.type, tag: q.tag, ...(q.ownerId && { ownerId: oid(q.ownerId) }), ...(q.projectId && { projectId: oid(q.projectId) }) },
        { limit: q.limit, offset: q.offset },
      );
      return { items: items.map(envDto), total, limit: q.limit, offset: q.offset };
    });

    // Find similar environments (PLAN.md §12.3): by text, or by an environment whose head summary becomes the query.
    api.get("/environments/similar", async (req) => {
      const q = parse(SimilarQuery, req.query);
      const exclude = q.environmentId ? oid(q.environmentId) : undefined;
      const text = q.text ?? (exclude ? (await repo.getHead(exclude)).version.summaryText : "");
      const items = await repo.similar({ text, type: q.type, excludeEnvironmentId: exclude, limit: q.limit });
      return { items: items.map(similarDto) };
    });

    api.get<{ Params: { id: string } }>("/environments/:id", async (req) => {
      const { environment, version } = await repo.getHead(oid(req.params.id));
      return { environment: envDto(environment), version: versionDto(version) };
    });

    api.put<{ Params: { id: string } }>("/environments/:id", async (req) => {
      const id = oid(req.params.id);
      const body = parse(SaveBody, req.body);
      const { spec, warnings } = requireValid(body.spec); // validation BEFORE any DB write
      const out = await repo.saveVersion(id, spec, { changeNote: body.changeNote, baseVersion: body.baseVersion });
      return { environment: envDto(out.environment), version: versionDto(out.version), warnings };
    });

    api.get<{ Params: { id: string } }>("/environments/:id/versions", async (req) => {
      const q = parse(VersionsQuery, req.query);
      const items = await repo.listVersions(oid(req.params.id), q);
      return { items: items.map(versionMeta), limit: q.limit, offset: q.offset, order: q.order };
    });

    api.get<{ Params: { id: string; version: string } }>("/environments/:id/versions/:version", async (req) => {
      const n = Number(req.params.version);
      if (!Number.isInteger(n) || n < 1) throw badRequest("Invalid version");
      return { version: versionDto(await repo.getVersion(oid(req.params.id), n)) };
    });

    api.post<{ Params: { id: string } }>("/environments/:id/revert", async (req, reply) => {
      const id = oid(req.params.id);
      const body = parse(RevertBody, req.body);
      const env = await repo.getEnvironment(id);
      if (body.toVersion === env.versionCount) throw conflict("ALREADY_AT_VERSION", `Version ${body.toVersion} is already the head`);
      const target = await repo.getVersion(id, body.toVersion);
      // Re-validate the old spec: the catalogue/rules may have changed since it was saved.
      const { spec, warnings } = requireValid(target.spec);
      const out = await repo.saveVersion(id, spec, {
        changeNote: body.changeNote ?? `Revert to version ${body.toVersion}`, baseVersion: body.baseVersion, revertedFromVersion: body.toVersion,
      });
      return reply.status(201).send({ environment: envDto(out.environment), version: versionDto(out.version), warnings });
    });
  }, { prefix: "/api/v1" });

  return app;
}
