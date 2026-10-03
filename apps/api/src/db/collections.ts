import { Db, ObjectId } from 'mongodb';
import { EnvironmentSpec } from '../validation/schema';

export async function setupCollections(db: Db): Promise<void> {
  const existingCollections = await db.listCollections().toArray();
  const names = new Set(existingCollections.map((c) => c.name));

  // environments collection
  if (!names.has('environments')) {
    await db.createCollection('environments');
    console.log('[MongoDB] Created collection: environments');
  }

  // environment_versions with $jsonSchema
  if (!names.has('environment_versions')) {
    await db.createCollection('environment_versions', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['environmentId', 'version', 'schemaVersion', 'spec', 'createdAt'],
          properties: {
            environmentId: { bsonType: 'objectId' },
            version: { bsonType: 'int', minimum: 1 },
            schemaVersion: { bsonType: 'string' },
            spec: {
              bsonType: 'object',
              required: ['environment', 'terrain', 'objects'],
              properties: {
                environment: {
                  bsonType: 'object',
                  required: ['name', 'type', 'dimensions'],
                },
                objects: { bsonType: 'array', maxItems: 500 },
              },
            },
            createdAt: { bsonType: 'date' },
          },
        },
      },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    console.log('[MongoDB] Created collection: environment_versions');
  }

  // generation_jobs
  if (!names.has('generation_jobs')) {
    await db.createCollection('generation_jobs');
  }

  // Indexes
  const envColl = db.collection('environments');
  await envColl.createIndex({ ownerId: 1, updatedAt: -1 }, { background: true });
  await envColl.createIndex({ projectId: 1 }, { background: true });
  await envColl.createIndex({ tags: 1 }, { background: true });

  const verColl = db.collection('environment_versions');
  await verColl.createIndex(
    { environmentId: 1, version: -1 },
    { unique: true, background: true }
  );

  const jobsColl = db.collection('generation_jobs');
  await jobsColl.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 30 * 24 * 3600, background: true } // 30-day TTL
  );

  console.log('[MongoDB] Indexes ensured');
}

export interface SaveVersionOptions {
  prompt: string;
  provider: string;
  projectId?: string;
  userId?: string;
  changeNote?: string;
  summaryText?: string;
}

export interface SaveVersionResult {
  environmentId: string;
  versionId: string;
  version: number;
}

export async function saveNewVersion(
  db: Db,
  spec: EnvironmentSpec,
  opts: SaveVersionOptions
): Promise<SaveVersionResult> {
  const envColl = db.collection('environments');
  const verColl = db.collection('environment_versions');

  const projectId = opts.projectId ? new ObjectId(opts.projectId) : null;
  const userId = opts.userId ? new ObjectId(opts.userId) : null;
  const now = new Date();

  // Find existing environment by name + type + project (or create new)
  const query = projectId
    ? { projectId, name: spec.environment.name }
    : { name: spec.environment.name, type: spec.environment.type };

  let envDoc = await envColl.findOne(query);
  let environmentId: ObjectId;

  if (!envDoc) {
    const result = await envColl.insertOne({
      projectId,
      ownerId: userId,
      name: spec.environment.name,
      type: spec.environment.type,
      headVersionId: null,
      versionCount: 0,
      tags: [spec.environment.type],
      createdAt: now,
      updatedAt: now,
    });
    environmentId = result.insertedId;
  } else {
    environmentId = envDoc._id as ObjectId;
  }

  // Determine next version number
  const latestVersion = await verColl
    .find({ environmentId })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  const nextVersion = latestVersion.length > 0 ? (latestVersion[0].version as number) + 1 : 1;

  const summaryText =
    opts.summaryText ??
    `${spec.environment.type} ${spec.environment.dimensions.width}x${spec.environment.dimensions.length}m, ${spec.objects.length} objects`;

  const verResult = await verColl.insertOne({
    environmentId,
    version: nextVersion,
    parentVersionId: latestVersion[0]?._id ?? null,
    schemaVersion: spec.schemaVersion,
    spec,
    summaryText,
    embedding: [],
    changeNote: opts.changeNote ?? `Generated from prompt: "${opts.prompt.slice(0, 80)}"`,
    createdBy: userId,
    createdAt: now,
  });

  // Update environment head
  await envColl.updateOne(
    { _id: environmentId },
    {
      $set: {
        headVersionId: verResult.insertedId,
        updatedAt: now,
      },
      $inc: { versionCount: 1 },
    }
  );

  return {
    environmentId: environmentId.toHexString(),
    versionId: verResult.insertedId.toHexString(),
    version: nextVersion,
  };
}

export async function findSimilarVersions(
  db: Db,
  embedding: number[],
  topK = 3,
  envType?: string
): Promise<EnvironmentSpec[]> {
  const verColl = db.collection('environment_versions');

  try {
    const pipeline: object[] = [
      {
        $vectorSearch: {
          index: 'env_vector_index',
          path: 'embedding',
          queryVector: embedding,
          numCandidates: topK * 10,
          limit: topK,
          ...(envType ? { filter: { 'spec.environment.type': envType } } : {}),
        },
      },
      { $project: { spec: 1, summaryText: 1 } },
    ];

    const results = await verColl.aggregate(pipeline).toArray();
    return results.map((r) => r.spec as EnvironmentSpec);
  } catch {
    // Vector search index may not exist yet; fall back to empty
    return [];
  }
}
