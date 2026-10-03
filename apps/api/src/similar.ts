import type { Document, ObjectId } from "mongodb";
import type { EnvironmentSpec } from "@twin/schema";
import { VECTOR_INDEX } from "./db/vectorIndex";

type EnvironmentType = EnvironmentSpec["environment"]["type"];

export interface SimilarQuery {
  text: string;
  type?: EnvironmentType;
  excludeEnvironmentId?: ObjectId;
  limit: number;
  /** Defaults to VECTOR_INDEX. */
  index?: string;
}
export interface SimilarHit {
  _id: ObjectId; environmentId: ObjectId; version: number; name: string; type: EnvironmentType; summaryText: string; score: number;
}

/**
 * Atlas Vector Search over version summaries (PLAN.md §12.6). Atlas embeds the query text itself (automated
 * embedding). Only current head versions are kept: old versions carry old names/types and, with near-identical
 * summaries, would otherwise crowd out other environments. Each environment has one head, so no grouping is needed.
 */
export function buildSimilarPipeline(q: SimilarQuery): Document[] {
  const filter: Document = {};
  if (q.type) filter["spec.environment.type"] = q.type;
  if (q.excludeEnvironmentId) filter.environmentId = { $ne: q.excludeEnvironmentId };
  const candidates = Math.max(200, q.limit * 40);
  return [
    {
      $vectorSearch: {
        index: q.index ?? VECTOR_INDEX,
        path: "summaryText",
        query: { text: q.text }, // verified on Atlas M0 (2026-10-03)
        numCandidates: candidates,
        limit: candidates, // non-head versions are dropped below, so over-fetch
        ...(Object.keys(filter).length ? { filter } : {}),
      },
    },
    { $addFields: { score: { $meta: "vectorSearchScore" } } },
    { $lookup: { from: "environments", localField: "_id", foreignField: "headVersionId", as: "head", pipeline: [{ $project: { _id: 1 } }] } },
    { $match: { "head.0": { $exists: true } } },
    {
      $project: {
        environmentId: 1, version: 1, summaryText: 1, score: 1,
        name: "$spec.environment.name", type: "$spec.environment.type",
      },
    },
    { $sort: { score: -1 } },
    { $limit: q.limit },
  ];
}
