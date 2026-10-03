import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { buildApp } from "../src/app";
import { ensureSchema } from "../src/db/jsonSchema";

/**
 * Real MongoDB only (no mocks). Uses TEST_MONGODB_URI (a replica set or Atlas cluster) if set,
 * otherwise downloads/starts an in-memory single-node replica set via mongodb-memory-server.
 * Transactions require a replica set.
 */
export async function startTestApp() {
  let mem: MongoMemoryReplSet | undefined;
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    mem = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = mem.getUri();
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(`twin_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  await ensureSchema(db);
  const app = buildApp({ client, db });
  await app.ready();
  return {
    app, db, client,
    async stop() {
      await app.close();
      await db.dropDatabase();
      await client.close();
      await mem?.stop();
    },
  };
}
