import type { Document, ObjectId } from "mongodb";
import type { EnvironmentSpec } from "@twin/schema";
import { VECTOR_INDEX } from "./db/vectorIndex";

type EnvironmentType = EnvironmentSpec["environment"]["type"];

export interface SimilarQuery { text: string; type?: EnvironmentType; excludeEnvironmentId?: ObjectId; limit: number }
export interface SimilarHit {
  _id: ObjectId; environmentId: ObjectId; version: number; name: string; type: EnvironmentType; summaryText: string; score: number;
}

/**
 * Atlas Vector Search over version summaries (PLAN.md §12.6). Atlas embeds the query text itself (automated
 * embedding), then we keep the best-matching version of each environment.
 */
export function buildSimilarPipeline(q: SimilarQuery): Document[] {
  const filter: Document = {};
  if (q.type) filter["spec.environment.type"] = q.type;
  if (q.excludeEnvironmentId) filter.environmentId = { $ne: q.excludeEnvironmentId };
  return [
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: "summaryText",
        query: { text: q.text }, // the docs also show `query: "<text>"`; switch if Atlas rejects this shape
        numCandidates: Math.max(100, q.limit * 20),
        limit: q.limit * 5, // several versions of one environment can match
        ...(Object.keys(filter).length ? { filter } : {}),
      },
    },
    {
      $project: {
        environmentId: 1, version: 1, summaryText: 1,
        name: "$spec.environment.name", type: "$spec.environment.type", score: { $meta: "vectorSearchScore" },
      },
    },
    { $sort: { score: -1 } },
    { $group: { _id: "$environmentId", best: { $first: "$$ROOT" } } },
    { $replaceWith: "$best" },
    { $sort: { score: -1 } },
    { $limit: q.limit },
  ];
}
