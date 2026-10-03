import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ObjectId } from "mongodb";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EnvironmentSpec } from "@twin/schema";
import { badRequest } from "./errors";
import { generateWithRepair } from "./llm/router";
import { cacheKey, getCached, setCached } from "./cache";
import { createGeminiEmbedding } from "./llm/gemini";
import type { EnvironmentRepository } from "./repository";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GenerateBody = z
  .object({
    prompt: z.string().min(5).max(1000),
    projectId: z.string().length(24).optional(),
    ownerId: z.string().length(24).optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  })
  .strict();

function loadDemoScenes(): EnvironmentSpec[] {
  const scenesDir = join(__dirname, "../demo-scenes");
  try {
    return readdirSync(scenesDir)
      .filter((f) => f.endsWith(".json"))
      .slice(0, 3)
      .map((f) => JSON.parse(readFileSync(join(scenesDir, f), "utf-8")) as EnvironmentSpec);
  } catch {
    return [];
  }
}

async function findExamples(repo: EnvironmentRepository, prompt: string): Promise<EnvironmentSpec[]> {
  try {
    const embedding = await createGeminiEmbedding(prompt);
    const items = await repo.versions
      .aggregate<{ spec: EnvironmentSpec }>([
        {
          $vectorSearch: {
            index: "env_vector_index",
            path: "embedding",
            queryVector: embedding,
            numCandidates: 30,
            limit: 3,
          },
        },
        { $project: { spec: 1 } },
      ])
      .toArray();
    return items.length > 0 ? items.map((i) => i.spec) : loadDemoScenes();
  } catch {
    return loadDemoScenes();
  }
}

export async function registerGenerateRoutes(app: FastifyInstance, repo: EnvironmentRepository): Promise<void> {
  /**
   * POST /api/v1/environments/generate
   * Body: { prompt, projectId?, ownerId?, tags? }
   *
   * Calls the LLM, runs the repair loop, validates via @twin/validator,
   * and saves version 1 via the shared EnvironmentRepository.
   */
  app.post<{ Body: unknown }>("/environments/generate", async (req, reply) => {
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Invalid request", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { prompt, projectId, ownerId, tags } = parsed.data;

    // Cache check — still persist a new environment so the UI always gets an id to open.
    const key = cacheKey(prompt);
    const hit = getCached(key);
    let spec: EnvironmentSpec;
    let provider: string;
    let warnings: unknown[] = [];
    let repairAttempts = 0;
    let cached = false;

    if (hit) {
      spec = hit.spec;
      provider = hit.provider;
      cached = true;
    } else {
      // Few-shot examples from vector search or demo scenes
      const examples = await findExamples(repo, prompt);

      // Generate + repair loop (throws AppError-compatible object on PROVIDER_UNAVAILABLE)
      let generationResult;
      try {
        generationResult = await generateWithRepair(prompt, examples);
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === "PROVIDER_UNAVAILABLE") {
          return reply.status(503).send({ error: { code: "PROVIDER_UNAVAILABLE", message: e.message ?? "All LLM providers failed", details: [] } });
        }
        throw err;
      }

      ({ spec, provider, warnings, repairAttempts } = generationResult);
      setCached(key, spec, provider);
    }

    // Persist using Person 3's repo (spec is already validated inside generateWithRepair)
    const { environment, version } = await repo.create(spec, {
      changeNote: `Generated from: "${prompt.slice(0, 80)}"`,
      tags: tags ?? [spec.environment.type],
      ...(projectId && ObjectId.isValid(projectId) ? { projectId: new ObjectId(projectId) } : {}),
      ...(ownerId && ObjectId.isValid(ownerId) ? { ownerId: new ObjectId(ownerId) } : {}),
    });

    return reply.status(201).send({
      environmentId: String(environment._id),
      versionId: String(version._id),
      version: version.version,
      spec,
      provider,
      warnings,
      repairAttempts,
      cached,
    });
  });
}
