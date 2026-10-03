import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(); // uses the database name from the URI
  console.log('[MongoDB] Connected');
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected — call connectMongo() first');
  return db;
}

export function isConnected(): boolean {
  return db !== null;
}

process.on('SIGINT', async () => {
  if (client) await client.close();
  process.exit(0);
});
