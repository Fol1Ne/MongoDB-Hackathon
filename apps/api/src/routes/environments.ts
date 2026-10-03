import { Router, Response } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { generateRateLimiter } from '../middleware/rateLimit';
import { generateWithRepair } from '../llm/router';
import { cacheKey, getCached, setCached } from '../cache';
import { isConnected, getDb } from '../db/client';
import { saveNewVersion, findSimilarVersions } from '../db/collections';
import { createGeminiEmbedding } from '../llm/gemini';
import { ASSET_CATALOGUE } from '../catalogue/assets';
import path from 'path';
import fs from 'fs';

const router = Router();

// Load demo scenes as fallback few-shot examples
function loadDemoScenes(): unknown[] {
  const scenesDir = path.join(__dirname, '../../demo-scenes');
  try {
    return fs
      .readdirSync(scenesDir)
      .filter((f) => f.endsWith('.json'))
      .slice(0, 3)
      .map((f) => {
        const raw = fs.readFileSync(path.join(scenesDir, f), 'utf-8');
        return JSON.parse(raw);
      });
  } catch {
    return [];
  }
}

/**
 * POST /api/v1/environments/generate
 * Body: { prompt: string, projectId?: string }
 */
router.post(
  '/generate',
  generateRateLimiter,
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { prompt, projectId } = req.body as { prompt?: unknown; projectId?: unknown };

    // Validate input
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'prompt is required and must be a string' },
      });
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 5) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'prompt must be at least 5 characters' },
      });
      return;
    }
    if (trimmedPrompt.length > 1000) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'prompt must be at most 1000 characters' },
      });
      return;
    }

    // Cache check
    const key = cacheKey(trimmedPrompt);
    const cached = getCached(key);
    if (cached) {
      console.log(`[generate] Cache hit for prompt: "${trimmedPrompt.slice(0, 60)}"`);
      res.json({
        environmentId: null,
        versionId: null,
        spec: cached.spec,
        provider: cached.provider,
        warnings: [],
        cached: true,
      });
      return;
    }

    // Find few-shot examples: try vector search, fall back to demo scenes
    let examples: unknown[] = [];
    if (isConnected()) {
      try {
        const embedding = await createGeminiEmbedding(trimmedPrompt);
        const similar = await findSimilarVersions(getDb(), embedding, 3);
        examples = similar.length > 0 ? similar : loadDemoScenes();
      } catch (err) {
        console.warn('[generate] Embedding/vector search failed, using demo scenes:', (err as Error).message);
        examples = loadDemoScenes();
      }
    } else {
      examples = loadDemoScenes();
    }

    // Generate
    let result;
    try {
      result = await generateWithRepair(trimmedPrompt, examples as import('../validation/schema').EnvironmentSpec[]);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'PROVIDER_UNAVAILABLE') {
        res.status(503).json({
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'All LLM providers are unavailable. Please try again later.',
          },
        });
        return;
      }
      console.error('[generate] Unexpected error:', err);
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected error during generation' },
      });
      return;
    }

    const { spec, provider, warnings, repairAttempts } = result;

    // Save to MongoDB
    let saveResult: { environmentId: string; versionId: string; version: number } | null = null;
    if (isConnected()) {
      try {
        saveResult = await saveNewVersion(getDb(), spec, {
          prompt: trimmedPrompt,
          provider,
          projectId: typeof projectId === 'string' ? projectId : undefined,
          userId: req.userId,
        });
      } catch (err) {
        console.warn('[generate] MongoDB save failed (returning spec anyway):', (err as Error).message);
      }
    }

    // Cache the result
    setCached(key, spec, provider);

    if (repairAttempts > 0) {
      console.log(`[generate] Served spec after ${repairAttempts} repair attempt(s) via ${provider}`);
    }

    res.json({
      environmentId: saveResult?.environmentId ?? null,
      versionId: saveResult?.versionId ?? null,
      version: saveResult?.version ?? null,
      spec,
      provider,
      warnings,
      repairAttempts,
      cached: false,
    });
  }
);

/**
 * GET /api/v1/environments
 * List environments (lightweight)
 */
router.get('/', authMiddleware, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!isConnected()) {
    res.json([]);
    return;
  }

  const envs = await getDb()
    .collection('environments')
    .find({})
    .sort({ updatedAt: -1 })
    .limit(50)
    .project({ name: 1, type: 1, headVersionId: 1, versionCount: 1, updatedAt: 1 })
    .toArray();

  res.json(
    envs.map((e) => ({
      id: e._id.toString(),
      name: e.name,
      type: e.type,
      versionCount: e.versionCount,
      updatedAt: e.updatedAt,
    }))
  );
});

/**
 * GET /api/v1/assets/catalogue
 */
router.get('/catalogue', (_req, res: Response): void => {
  res.json(ASSET_CATALOGUE);
});

export { router as generateRouter };
