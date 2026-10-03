import type { EnvironmentSpec, ValidationWarning } from "@twin/schema";
import { validateAndParse } from "@twin/validator";
import { ASSET_CATALOGUE } from "@twin/catalogue";
import { GeminiProvider } from "./gemini";
import { OpenRouterProvider } from "./openrouter";
import { RetryableError, ParseError } from "./interface";
import { buildSystemPrompt, buildRepairPrompt, buildUserPrompt } from "./prompts";

export interface GenerationResult {
  spec: EnvironmentSpec;
  provider: string;
  warnings: ValidationWarning[];
  repairAttempts: number;
}

const geminiProvider = new GeminiProvider();
const openRouterProvider = new OpenRouterProvider();
const providers = [geminiProvider, openRouterProvider];

// Minimal Gemini-compatible schema shape (used for responseSchema enforcement)
const GEMINI_SCHEMA = {
  schemaVersion: "string",
  environment: { name: "string", type: "string", dimensions: { width: "number", length: "number", height: "number" } },
  terrain: { type: "string", properties: { friction: "number" } },
  objects: "array",
  robotics: { simulation_enabled: "boolean" },
  provenance: { source: "string", generatedAt: "string" },
};

export async function generateWithRepair(
  userPrompt: string,
  examples: EnvironmentSpec[] = [],
): Promise<GenerationResult> {
  const systemPrompt = buildSystemPrompt(ASSET_CATALOGUE, examples);
  const userMessage = buildUserPrompt(userPrompt);

  let lastError: unknown;

  for (const provider of providers) {
    console.log(`[LLM] Trying provider: ${provider.name}`);

    try {
      let response = await provider.generateStructured<unknown>({
        system: systemPrompt,
        prompt: userMessage,
        jsonSchema: GEMINI_SCHEMA,
        temperature: 0.3,
      });

      let { result, spec } = validateAndParse(response.data);

      if (result.valid && spec) {
        console.log(`[LLM] ${provider.name} succeeded on first attempt`);
        return { spec, provider: provider.name, warnings: result.warnings, repairAttempts: 0 };
      }

      console.log(`[LLM] ${provider.name} first attempt invalid (${result.errors.length} errors), entering repair loop`);

      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`[LLM] ${provider.name} repair attempt ${attempt}/2: ${result.errors.map((e) => `${e.code}: ${e.message}`).join("; ")}`);

        const repairSystem = buildRepairPrompt(userPrompt, response.data, result.errors);
        response = await provider.generateStructured<unknown>({
          system: repairSystem,
          prompt: "",
          jsonSchema: GEMINI_SCHEMA,
          temperature: 0.2,
        });

        ({ result, spec } = validateAndParse(response.data));

        if (result.valid && spec) {
          console.log(`[LLM] ${provider.name} repaired on attempt ${attempt}`);
          return { spec, provider: provider.name, warnings: result.warnings, repairAttempts: attempt };
        }

        console.log(`[LLM] ${provider.name} repair attempt ${attempt} still invalid`);
      }

      console.log(`[LLM] ${provider.name} exhausted repair attempts, trying fallback`);
      lastError = new Error(`Validation failed after 2 repair attempts on ${provider.name}`);
    } catch (err) {
      lastError = err;
      if (err instanceof RetryableError || err instanceof ParseError) {
        console.warn(`[LLM] ${provider.name} retryable error: ${(err as Error).message}`);
        continue;
      }
      throw err;
    }
  }

  throw Object.assign(
    new Error(`All LLM providers failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`),
    { code: "PROVIDER_UNAVAILABLE" },
  );
}
