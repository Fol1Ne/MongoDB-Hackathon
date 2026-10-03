# Data & Validation layer (Person 3)

```
packages/schema     Zod EnvironmentSpec + types (source of truth)
packages/catalogue  15-asset catalogue
packages/validator  structural -> referential -> geometric -> physical validation
apps/api            Fastify routes + repository + $jsonSchema (src/db/jsonSchema.ts)
infra/mongo         docker-compose (replica set) + setup notes
docs/api.md         API contract
```
Run: `npm install && npm run typecheck && npm run test:unit` (no DB needed).
API tests need a real replica set: `TEST_MONGODB_URI='mongodb://localhost:27017/?replicaSet=rs0' npm run test:api`
(or leave it unset to let mongodb-memory-server download mongod). Server: `MONGODB_URI=... npm run dev`.
