# Link the API to the web app

This note is for the backend developer. The web app in `apps/web` runs on a mock client by default, so nothing in the UI calls your code yet. The UI side of every call is written and waits for your endpoints. This note lists each call, what it expects from you, and what the API lacks today.

I checked the API against `develop` at commit `4df23f2`.

## Run the web app against the API

1. Start the API on port 3001 with `npm run dev`.
2. Start the web app with `npm run dev:web`. Vite proxies `/api` to `http://localhost:3001` (see `apps/web/vite.config.ts`), so you need no CORS in development.
3. Open `http://localhost:5173/?api=http`. To make HTTP the default, set `VITE_API_MODE=http` in `apps/web/.env`.

The Create screen shows "Connected to API" in the top right when the HTTP client is active. It shows "Offline demo data" when the mock is active.

## Where the UI calls the API

Every call goes through one interface, `ApiClient` in `apps/web/src/api/types.ts`. The HTTP client is `createHttpClient` in `apps/web/src/api/http.ts`. That file is the only place that knows your routes.

`http.ts` parses every response with the Zod schemas at the top of the file. If a response has the wrong shape, the call fails with a `schema` error and the UI shows "The server sent data this app does not understand." If you change a response, change the matching schema in `http.ts`.

| UI function | Screens that call it | Request | API today |
|---|---|---|---|
| `listEnvironments()` | Create, recent list | `GET /environments?limit=100` | Works |
| `getHead(id)` | Create, Editor, Blueprint | `GET /environments/:id` | Works |
| `listVersions(id)` | Editor timeline, Blueprint revisions | `GET /environments/:id/versions?limit=500` | Works |
| `getVersion(id, n)` | Editor, Blueprint | `GET /environments/:id/versions/:n` | Works |
| `save(id, input)` | Editor, Save version | `PUT /environments/:id` with `spec`, `changeNote`, `baseVersion` | Works |
| `revert(id, input)` | Editor timeline | `POST /environments/:id/revert` with `toVersion`, `baseVersion` | Works |
| `generate(input)` | Create, prompt box | `POST /environments/generate` with `prompt` | Works once per prompt. See gap 2 |
| `fromImages(input)` | Create, photo drop zone | `POST /environments/from-images`, multipart | Missing. See gap 1 |
| `photos(id)` | Editor photo panel, Blueprint sheet 2 | None. Reads IndexedDB in the browser | No endpoint. See gap 4 |
| `catalogue()` | Not called yet | `GET /assets/catalogue` | Works |

"Works" means the route exists and its documented response matches the schema in `http.ts`. I compared the two by reading the code. Nobody has run the web app against a live API yet, so run the three screens once in HTTP mode before the demo.

Errors the UI handles from these calls:

- `409 VERSION_CONFLICT` on `save` opens the "A newer version exists" dialog.
- `400 VALIDATION_FAILED` lists the entries of `details`. Each entry needs `path`, `code`, and `message`, which is what you send today.
- `503 PROVIDER_UNAVAILABLE` on `generate` shows "The AI service is busy" with a retry button.

## What the API lacks

The gaps are in order of how much they hurt the demo.

### 1. `POST /environments/from-images` does not exist

Photos are the main way to create an environment in the demo, and no backend plan owns this route. Today the route returns 404. The web app then falls back. It builds a fixed warehouse from a fixture in the browser, saves it with `POST /environments`, and marks the model as "local preview generator".

The request the UI sends:

- `multipart/form-data`. The API has no multipart parser yet, for example `@fastify/multipart`.
- One `images` part per photo, up to 6. The browser re-encodes each photo to JPEG with the longest edge at 2048 px or less, which also removes EXIF data.
- One `options` part that holds a JSON string:

```json
{ "hint": "loading dock on the south wall", "knownDimension": { "kind": "door_height", "meters": 2.1 } }
```

`knownDimension` can be `null`. `kind` is one of `door_height`, `room_width`, `room_length`, `ceiling_height`.

The response the UI reads is the same as for `generate`, plus one optional field:

```json
{ "environmentId": "66f...", "spec": { "...": "EnvironmentSpec" }, "confidence": { "industrial_shelf_001": 0.91, "pallet_014": 0.34 } }
```

`confidence` maps an object id to a number from 0 to 1. The UI then loads the environment with `GET /environments/:id`. Set `provenance.source` to `"image"` in the spec so the UI labels the environment as built from photos.

### 2. `generate` returns no environment on a cache hit

In `apps/api/src/generate.ts`, the `getCached` branch replies with `environmentId: null` and saves nothing. The UI needs an environment id to open the editor, and the schema in `http.ts` requires a string. So a repeated prompt fails in the UI with a schema error until the cache entry expires, which takes one hour by default.

On a cache hit, create a new environment from the cached spec and return its id. The response then has the same shape as a fresh generation.

### 3. Confidence per object is not stored

The schema has one number, `provenance.confidence`. The editor needs a number per object. It draws a dashed ring around each object below 0.5 and walks the user through them ("needs review").

Today that map exists only in the response of the create call and in browser memory. In HTTP mode the rings disappear after a reload, because `getHead` in `http.ts` sets `confidence: null`.

Store the map with the version and return it from `GET /environments/:id` as a top-level `confidence` field. When you add it, I will read it in `getHead`.

### 4. Photos are not stored on the server

`photos(id)` reads from IndexedDB. The source photos appear in the editor and on blueprint sheet 2 only in the browser that uploaded them. That is enough for a demo on one laptop.

To keep photos across machines, store the uploads and add `GET /environments/:id/photos`.

### 5. Smaller items

- The UI has copy for `429 RATE_LIMITED`, `403 FORBIDDEN`, and `COMPILE_FAILED`. The API sends none of them. If you add a rate limit to `generate`, send `RATE_LIMITED` with a `Retry-After` header. The UI then shows "Try again in N seconds."
- The API sends `503 SEARCH_UNAVAILABLE`. The UI does not know that code and shows a generic error. Only `/environments/similar` sends it, and the UI does not call that route.
- CORS is missing. You need it only if the web app and the API run on different origins.

## What the API has that the UI does not use

- `GET /environments/similar`. No screen calls it.
- `POST /environments/validate`. The editor validates in the browser with `@twin/validator`, the same package you use.
- The `provider`, `warnings`, `repairAttempts`, and `cached` fields of the `generate` response. The UI ignores them.
- Demo scenes. After `npm run db:seed` they are ordinary environments, so the recent list on the Create screen shows them in HTTP mode.

## Tell me what the UI lacks

If your code needs something the UI does not have, for example a screen for similar environments, a field in a request, or a new call, tell me which one. Add it to this file or comment on the pull request. I add calls in `ApiClient` and `http.ts`, so name the route and the response shape.
