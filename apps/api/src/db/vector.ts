import { MongoClient } from "mongodb";
import { ensureVectorIndex, VECTOR_INDEX } from "./vectorIndex";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");
const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "robotics_twin");
console.log(`Building ${VECTOR_INDEX} on '${db.databaseName}'. Atlas embeds existing summaries first; this can take a few minutes.`);
await ensureVectorIndex(db);
console.log(`${VECTOR_INDEX} is queryable`);
await client.close();
