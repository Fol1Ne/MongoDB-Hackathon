import { createHttpClient } from "./http";
import { createMockClient } from "./mock";
import type { ApiClient } from "./types";

const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
const mode = params.get("api") ?? import.meta.env.VITE_API_MODE ?? "mock";

export const api: ApiClient =
  mode === "http"
    ? createHttpClient({ baseUrl: import.meta.env.VITE_API_BASE ?? "/api/v1" })
    : createMockClient({ latencyMs: Number(params.get("latency") ?? 1), failCode: params.get("fail") });
