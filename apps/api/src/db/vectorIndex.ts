import type { Db, Document } from "mongodb";

export const VECTOR_INDEX = "env_summary_autoembed";
export const EMBEDDING_MODEL = "voyage-4-lite";

/**
 * Atlas Automated Embedding (GA 2026-08, works on M0): Atlas embeds `summaryText` with Voyage AI and queries pass
 * plain text, so the app stores no vectors. Filter fields must be indexed to be usable in $vectorSearch.filter.
 */
export const vectorIndexDefinition: Document = {
  fields: [
    { type: "autoEmbed", modality: "text", path: "summaryText", model: EMBEDDING_MODEL },
    { type: "filter", path: "spec.environment.type" },
    { type: "filter", path: "environmentId" },
  ],
};

/** Atlas only. Creates the index if missing, then polls gently (M0 allows 100 ops/s) until it is queryable. */
export async function ensureVectorIndex(db: Db, { timeoutMs = 600_000, pollMs = 5_000 } = {}): Promise<void> {
  const coll = db.collection("environment_versions");
  const [existing] = await coll.listSearchIndexes(VECTOR_INDEX).toArray();
  if (!existing) await coll.createSearchIndex({ name: VECTOR_INDEX, type: "vectorSearch", definition: vectorIndexDefinition });
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await new Promise((r) => setTimeout(r, pollMs))) {
    const [index] = (await coll.listSearchIndexes(VECTOR_INDEX).toArray()) as Document[];
    if (index?.status === "FAILED") throw new Error(`${VECTOR_INDEX} failed to build: ${JSON.stringify(index)}`);
    if (index?.queryable) return;
  }
  throw new Error(`${VECTOR_INDEX} not queryable after ${timeoutMs / 1000} s`);
}
