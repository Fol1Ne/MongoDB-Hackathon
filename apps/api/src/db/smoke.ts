// End-to-end check against a real cluster (Atlas): versioning, validation gates, the $jsonSchema safety net and
// (when available) vector search. Creates one temporary environment and deletes it afterwards.
import { MongoClient, ObjectId } from "mongodb";
import { buildApp } from "../app";
import { loadDemoScenes } from "../demo";
import { ensureSchema } from "./jsonSchema";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");
const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "robotics_twin");
await ensureSchema(db);
const app = buildApp({ client, db });
await app.ready();

const call = async (method: "GET" | "POST" | "PUT", url: string, payload?: object) => {
  const res = await app.inject({ method, url: `/api/v1${url}`, ...(payload && { payload }) });
  return { status: res.statusCode, body: res.json() };
};
let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { failed = true; console.error(detail); }
};

const spec = structuredClone(loadDemoScenes().find((s) => s.file === "office.json")!.spec) as any;
spec.environment.name = `Smoke test ${Date.now()}`;
let id: string | undefined;
try {
  const created = await call("POST", "/environments", { spec, changeNote: "smoke" });
  id = created.body.environment?.id;
  check("create → 201 (multi-document transaction)", created.status === 201, created.body);

  spec.objects[0].position = [-3, 0, -4];
  const saved = await call("PUT", `/environments/${id}`, { spec, baseVersion: 1 });
  check("edit → v2", saved.body.version?.version === 2, saved.body);

  const bad = structuredClone(spec);
  bad.objects[0].position = [100, 0, 0];
  const rejected = await call("PUT", `/environments/${id}`, { spec: bad, baseVersion: 2 });
  check("bad spec → 400 VALIDATION_FAILED", rejected.status === 400 && rejected.body.error?.code === "VALIDATION_FAILED", rejected.body);

  const stale = await call("PUT", `/environments/${id}`, { spec, baseVersion: 1 });
  check("stale baseVersion → 409", stale.status === 409, stale.body);

  const reverted = await call("POST", `/environments/${id}/revert`, { toVersion: 1 });
  check("revert → v3", reverted.body.version?.version === 3, reverted.body);

  const history = await call("GET", `/environments/${id}/versions`);
  check("history is v1, v2, v3", JSON.stringify(history.body.items?.map((v: any) => v.version)) === "[1,2,3]", history.body);

  const direct = await db.collection("environment_versions")
    .insertOne({ environmentId: new ObjectId(), version: 1, schemaVersion: "1.0.0", spec: { objects: "nope" }, createdAt: new Date() })
    .then(() => "inserted", (e: { code?: number }) => e.code);
  check("$jsonSchema rejects a malformed version written directly (121)", direct === 121, direct);

  const similar = await call("GET", `/environments/similar?text=${encodeURIComponent("warehouse with shelf aisles and a loading dock")}`);
  if (similar.status === 200) check("similar → a warehouse ranks first", similar.body.items?.[0]?.type === "warehouse", similar.body);
  else console.log(`- similar: skipped (HTTP ${similar.status}; needs the vector search endpoint and npm run db:vector)`);
} finally {
  if (id) {
    await db.collection("environment_versions").deleteMany({ environmentId: new ObjectId(id) });
    await db.collection("environments").deleteOne({ _id: new ObjectId(id) });
  }
  await app.close();
  await client.close();
}
process.exitCode = failed ? 1 : 0;
