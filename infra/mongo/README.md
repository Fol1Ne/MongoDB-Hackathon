# MongoDB setup

**Atlas:** create a cluster, allow your IP, then
```bash
export MONGODB_URI='mongodb+srv://<user>:<pass>@<cluster>/?retryWrites=true&w=majority'
npm run db:init        # creates collections + $jsonSchema validators + indexes (idempotent)
npm run dev            # API on :3001 (also runs ensureSchema on boot)
```

**Demo data and smoke test (no Docker needed):**
```bash
set -a; source .env; set +a   # or export MONGODB_URI / MONGODB_DB yourself
npm run db:seed               # creates the 4 scenes in apps/api/demo-scenes/ (idempotent)
npm run smoke                 # create → edit → 400 → 409 → revert → history → $jsonSchema 121 (cleans up after itself)
```
On Atlas M0, `smoke` also proves that multi-document transactions work on the free tier.

**Local:** `docker compose -f infra/mongo/docker-compose.yml up -d`, then use
`MONGODB_URI='mongodb://localhost:27017/?replicaSet=rs0'`.

Collections: `environments` (head pointer), `environment_versions` (immutable snapshots).
Validators live in `apps/api/src/db/jsonSchema.ts` (`validationLevel: strict`, `validationAction: error`).
Indexes: `environment_versions {environmentId:1, version:-1}` UNIQUE; `environments` `{ownerId,updatedAt}`, `{projectId}`, `{tags}`, `{updatedAt,_id}`.
