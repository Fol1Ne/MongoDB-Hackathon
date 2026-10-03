import axios from "axios";
import { type LLMProvider, type LLMRequest, type LLMResponse, RetryableError, ParseError } from "./interface";

function extractJson(text: string): string {
  // Strip markdown code fences
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
  // Find first { to last }
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) return stripped;
  return stripped.slice(start, end + 1);
}

export class OpenRouterProvider implements LLMProvider {
  name = "openrouter-llama3-8b";

  private baseURL = "https://openrouter.ai/api/v1";
  private model = "meta-llama/llama-3.1-8b-instruct:free";

  async generateStructured<T>(req: LLMRequest): Promise<LLMResponse<T>> {
    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (!apiKey) throw new RetryableError("OPENROUTER_API_KEY not set — skipping fallback");

    // Include schema in system prompt since OpenRouter has no native responseSchema
    const systemWithSchema =
      req.system +
      "\n\nIMPORTANT: Your response must be a single valid JSON object matching the EnvironmentSpec schema. No markdown. No explanation. No code fences. Raw JSON only.";

    let response;
    try {
      response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          temperature: req.temperature ?? 0.3,
          messages: [
            { role: 'system', content: systemWithSchema },
            { role: 'user', content: req.prompt },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://mongohackathon.dev",
            "X-Title": "RoboEnv Generator",
          },
          timeout: 60_000,
        }
      );
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 429 || (status !== undefined && status >= 500)) {
          throw new RetryableError(`OpenRouter HTTP ${status}`);
        }
        if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
          throw new RetryableError("OpenRouter timeout");
        }
      }
      throw err;
    }

    const raw: string = (response.data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    const cleaned = extractJson(raw);

    let data: T;
    try {
      data = JSON.parse(cleaned) as T;
    } catch {
      throw new ParseError(`OpenRouter returned non-JSON: ${raw.slice(0, 200)}`, raw);
    }

    return { data, raw };
  }
}
