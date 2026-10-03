import { z } from "zod";
import { AssetDefinitionSchema, EnvironmentSpecSchema, VALIDATION_CODES, type EnvironmentSpec } from "@twin/schema";
import { localPhotoSpec, localTextSpec } from "./local";
import { browserOrMemoryPhotos, type PhotoStore } from "./storage";
import {
  fail,
  isApiErrorCode,
  ok,
  type ApiClient,
  type ApiError,
  type Confidence,
  type Created,
  type EnvId,
  type EnvironmentDto,
  type Result,
  type VersionDto,
  type VersionMeta,
  type Written,
} from "./types";

const EnvironmentDtoSchema = z.object({
  id: z.string(), name: z.string(), type: z.enum(["warehouse", "factory", "office", "outdoor", "custom"]), headVersionId: z.string(),
  versionCount: z.number().int(), tags: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(),
});
const VersionMetaSchema = z.object({
  id: z.string(), environmentId: z.string(), version: z.number().int(), parentVersionId: z.string().nullable(),
  summaryText: z.string(), changeNote: z.string().nullable(), revertedFromVersion: z.number().int().nullable().optional(), createdAt: z.string(),
});
const VersionDtoSchema = VersionMetaSchema.extend({ spec: EnvironmentSpecSchema });
const WrittenSchema = z.object({ environment: EnvironmentDtoSchema, version: VersionDtoSchema });
const IssueSchema = z.object({ path: z.string(), code: z.enum(VALIDATION_CODES), message: z.string() });
const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.array(z.unknown()).optional() }) });
const GenerateSchema = z.object({ environmentId: z.string(), versionId: z.string().optional(), spec: EnvironmentSpecSchema, confidence: z.record(z.number()).nullable().optional() });

type Fetch = typeof fetch;

export interface HttpOptions {
  baseUrl: string;
  fetch?: Fetch;
  photoStore?: PhotoStore;
  timeoutMs?: number;
  generateTimeoutMs?: number;
}

const asEnv = (e: z.infer<typeof EnvironmentDtoSchema>): EnvironmentDto => ({ ...e, id: e.id as EnvId });
const asMeta = (v: z.infer<typeof VersionMetaSchema>): VersionMeta => ({ ...v, revertedFromVersion: v.revertedFromVersion ?? null });
const asVersion = (v: z.infer<typeof VersionDtoSchema>): VersionDto => ({ ...asMeta(v), spec: v.spec });
const asWritten = (w: z.infer<typeof WrittenSchema>): Written => ({ environment: asEnv(w.environment), version: asVersion(w.version) });

export function createHttpClient(opts: HttpOptions): ApiClient {
  const doFetch: Fetch = opts.fetch ?? ((...a) => fetch(...a));
  const photoStore = opts.photoStore ?? browserOrMemoryPhotos();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const generateTimeoutMs = opts.generateTimeoutMs ?? 60_000;

  async function call<S extends z.ZodTypeAny>(method: string, path: string, schema: S, body?: BodyInit | object, o: { signal?: AbortSignal; timeout?: number } = {}): Promise<Result<z.infer<S>>> {
    const timeout = o.timeout ?? timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), timeout);
    o.signal?.addEventListener("abort", () => controller.abort("user"), { once: true });
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers: body && !isForm ? { "content-type": "application/json" } : undefined,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (controller.signal.aborted) return fail(controller.signal.reason === "timeout" ? { kind: "timeout", afterMs: timeout } : { kind: "aborted" });
      return fail({ kind: "network", message: e instanceof Error ? e.message : String(e) });
    }
    clearTimeout(timer);
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = ErrorBodySchema.safeParse(json);
      const code = parsed.success && isApiErrorCode(parsed.data.error.code) ? parsed.data.error.code : res.status === 404 ? "NOT_FOUND" : "INTERNAL";
      const details = parsed.success ? (parsed.data.error.details ?? []).flatMap((d) => { const issue = IssueSchema.safeParse(d); return issue.success ? [issue.data] : []; }) : [];
      const retryAfter = Number(res.headers.get("retry-after"));
      const error: ApiError = {
        kind: "http", status: res.status, code, message: parsed.success ? parsed.data.error.message : res.statusText,
        details, retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      };
      return fail(error);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return fail({ kind: "schema", where: `${method} ${path}`, issues: parsed.error.issues.map((i: z.ZodIssue) => `${i.path.join(".")} ${i.message}`) });
    return ok(parsed.data);
  }

  const routeMissing = (r: Result<unknown>) => !r.ok && r.error.kind === "http" && r.error.status === 404;

  async function createLocally(spec: EnvironmentSpec, note: string, confidence: Confidence | null): Promise<Result<Created>> {
    const r = await call("POST", "/environments", WrittenSchema, { spec, changeNote: note });
    return r.ok ? ok({ ...asWritten(r.data), confidence, origin: "local" }) : r;
  }

  async function afterServerGenerate(environmentId: string, confidence: Confidence | null): Promise<Result<Created>> {
    const head = await call("GET", `/environments/${environmentId}`, WrittenSchema);
    return head.ok ? ok({ ...asWritten(head.data), confidence, origin: "server" }) : head;
  }

  return {
    mode: "http",
    async catalogue() {
      const r = await call("GET", "/assets/catalogue", z.object({ assets: z.array(AssetDefinitionSchema) }));
      return r.ok ? ok(r.data.assets) : r;
    },
    async listEnvironments() {
      const r = await call("GET", "/environments?limit=100", z.object({ items: z.array(EnvironmentDtoSchema) }));
      return r.ok ? ok(r.data.items.map(asEnv)) : r;
    },
    async getHead(id) {
      const r = await call("GET", `/environments/${id}`, WrittenSchema);
      return r.ok ? ok({ ...asWritten(r.data), confidence: null }) : r;
    },
    async listVersions(id) {
      const r = await call("GET", `/environments/${id}/versions?limit=500`, z.object({ items: z.array(VersionMetaSchema) }));
      return r.ok ? ok(r.data.items.map(asMeta)) : r;
    },
    async getVersion(id, n) {
      const r = await call("GET", `/environments/${id}/versions/${n}`, z.object({ version: VersionDtoSchema }));
      return r.ok ? ok(asVersion(r.data.version)) : r;
    },
    async save(id, input) {
      const r = await call("PUT", `/environments/${id}`, WrittenSchema, input);
      return r.ok ? ok(asWritten(r.data)) : r;
    },
    async revert(id, input) {
      const r = await call("POST", `/environments/${id}/revert`, WrittenSchema, input);
      return r.ok ? ok(asWritten(r.data)) : r;
    },
    async generate(input, o) {
      o?.onPhase?.("drafting");
      const r = await call("POST", "/environments/generate", GenerateSchema, input, { signal: o?.signal, timeout: generateTimeoutMs });
      if (r.ok) {
        o?.onPhase?.("saving");
        return afterServerGenerate(r.data.environmentId, r.data.confidence ?? null);
      }
      if (!routeMissing(r)) return r;
      o?.onPhase?.("saving");
      return createLocally(localTextSpec(input.prompt), "Generated from prompt", null);
    },
    async fromImages(input, o) {
      if (!input.photos.length) return fail({ kind: "photo", message: "Add at least one photo." });
      o?.onPhase?.("uploading");
      const form = new FormData();
      for (const p of input.photos) form.append("images", p.blob, p.name);
      form.append("options", JSON.stringify({ hint: input.hint, knownDimension: input.knownDimension }));
      const r = await call("POST", "/environments/from-images", GenerateSchema, form, { signal: o?.signal, timeout: generateTimeoutMs });
      let created: Result<Created>;
      if (r.ok) {
        o?.onPhase?.("saving");
        created = await afterServerGenerate(r.data.environmentId, r.data.confidence ?? null);
      } else if (routeMissing(r)) {
        o?.onPhase?.("analyzing");
        const { spec, confidence } = localPhotoSpec(input.photos.length, input.hint, input.knownDimension);
        o?.onPhase?.("saving");
        created = await createLocally(spec, `Built from ${input.photos.length} photos`, confidence);
      } else return r;
      if (created.ok) await photoStore.put(created.data.environment.id, input.photos.map(({ name, blob, width, height }) => ({ name, blob, width, height })));
      return created;
    },
    async photos(id) {
      return ok(await photoStore.get(id));
    },
  };
}
