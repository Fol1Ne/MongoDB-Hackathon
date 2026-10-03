import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The API must boot (and generation must fail soft) on machines without LLM keys: the frontend teammate,
// CI and the data-layer tests all build the app without GEMINI_API_KEY.
const saved = { gemini: process.env.GEMINI_API_KEY, openrouter: process.env.OPENROUTER_API_KEY };
beforeEach(() => { delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY; });
afterEach(() => {
  if (saved.gemini !== undefined) process.env.GEMINI_API_KEY = saved.gemini;
  if (saved.openrouter !== undefined) process.env.OPENROUTER_API_KEY = saved.openrouter;
});

describe("LLM providers without API keys", () => {
  it("the Gemini provider can be created, and only fails (retryably) when used", async () => {
    const { GeminiProvider } = await import("../src/llm/gemini");
    const { RetryableError } = await import("../src/llm/interface");
    const provider = new GeminiProvider();
    await expect(provider.generateStructured({ system: "s", prompt: "p", jsonSchema: {} })).rejects.toBeInstanceOf(RetryableError);
  });

  it("generation reports PROVIDER_UNAVAILABLE instead of crashing", async () => {
    const { generateWithRepair } = await import("../src/llm/router");
    await expect(generateWithRepair("a small warehouse")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("system prompt", () => {
  it("states the same id rule the validator enforces", async () => {
    const { buildSystemPrompt } = await import("../src/llm/prompts");
    const { ID_PATTERN } = await import("@twin/schema");
    const { ASSET_CATALOGUE } = await import("@twin/catalogue");
    const prompt = buildSystemPrompt(ASSET_CATALOGUE, []);
    expect(prompt).toContain(ID_PATTERN.source);
    expect(prompt).not.toContain("[A-Za-z0-9_.-]{1,64}");
  });
});
