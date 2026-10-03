import { MongoClient } from "mongodb";
import { buildApp } from "./app";
import { ensureSchema } from "./db/jsonSchema";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required (Atlas connection string or local replica set)");
const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "robotics_twin");
await ensureSchema(db);
const app = buildApp({ client, db });
await app.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" });
