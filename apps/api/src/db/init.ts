import { MongoClient } from "mongodb";
import { ensureSchema } from "./jsonSchema";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");
const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "robotics_twin");
await ensureSchema(db);
console.log(`Schema + indexes ensured in database '${db.databaseName}'`);
await client.close();
