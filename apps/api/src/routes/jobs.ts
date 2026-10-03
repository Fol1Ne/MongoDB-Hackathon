import { Router, Request, Response } from 'express';
import { isConnected, getDb } from '../db/client';
import { ObjectId } from 'mongodb';

const router = Router();

/**
 * GET /api/v1/jobs/:id
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'] as string;

  if (!isConnected()) {
    res.status(503).json({
      error: { code: 'DB_UNAVAILABLE', message: 'Database not connected' },
    });
    return;
  }

  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid job ID' } });
    return;
  }

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id as string);
  } catch {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid job ID' } });
    return;
  }

  const job = await getDb().collection('generation_jobs').findOne({ _id: objectId });

  if (!job) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    return;
  }

  res.json({
    id: job._id.toString(),
    status: job.status,
    result: job.result ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
  });
});

export { router as jobsRouter };
