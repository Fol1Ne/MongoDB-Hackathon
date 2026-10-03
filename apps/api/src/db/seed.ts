import { MongoClient } from "mongodb";
import { seedDemoScenes } from "../demo";
import { EnvironmentRepository } from "../repository";
import { ensureSchema } from "./jsonSchema";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");
const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "robotics_twin");
await ensureSchema(db);
for (const r of await seedDemoScenes(new EnvironmentRepository(client, db))) {
  console.log(`${r.status === "created" ? "+" : "="} ${r.file} -> ${r.id}`);
}
await client.close();
