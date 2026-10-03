import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { FunctionDeclarationSchema } from "@google/generative-ai";
import { type LLMProvider, type LLMRequest, type LLMResponse, RetryableError, ParseError } from "./interface";

function buildGeminiSchema(jsonSchema: Record<string, unknown>): FunctionDeclarationSchema {
  // Gemini requires its own schema format. We build a permissive top-level object
  // schema so Gemini's responseSchema constraint forces JSON output without us
  // needing to fully translate every nested JSON Schema construct.
  return {
    type: SchemaType.OBJECT,
    description: 'EnvironmentSpec',
    properties: {
      schemaVersion: { type: SchemaType.STRING },
      environment: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          type: { type: SchemaType.STRING },
          dimensions: {
            type: SchemaType.OBJECT,
            properties: {
              width: { type: SchemaType.NUMBER },
              length: { type: SchemaType.NUMBER },
              height: { type: SchemaType.NUMBER },
            },
          },
        },
      },
      terrain: {
        type: SchemaType.OBJECT,
        properties: {
          type: { type: SchemaType.STRING },
          properties: {
            type: SchemaType.OBJECT,
            properties: {
              friction: { type: SchemaType.NUMBER },
              restitution: { type: SchemaType.NUMBER },
            },
          },
        },
      },
      objects: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            id: { type: SchemaType.STRING },
            type: { type: SchemaType.STRING },
            position: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER } },
            rotation: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER } },
            scale: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER } },
          },
        },
      },
      lighting: { type: SchemaType.OBJECT },
      navigation: { type: SchemaType.OBJECT },
      robotics: {
        type: SchemaType.OBJECT,
        properties: {
          simulation_enabled: { type: SchemaType.BOOLEAN },
        },
      },
      provenance: { type: SchemaType.OBJECT },
    },
    required: ['schemaVersion', 'environment', 'terrain', 'objects', 'robotics', 'provenance'],
  } as unknown as FunctionDeclarationSchema;
}

export class GeminiProvider implements LLMProvider {
  name = "gemini-flash-latest";

  private genAI?: GoogleGenerativeAI;

  /** The key is checked per request (like OpenRouterProvider), so the API boots and its tests run without LLM keys. */
  private client(): GoogleGenerativeAI {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) throw new RetryableError("GEMINI_API_KEY not set — skipping Gemini");
    return (this.genAI ??= new GoogleGenerativeAI(apiKey));
  }

  async generateStructured<T>(req: LLMRequest): Promise<LLMResponse<T>> {
    const model = this.client().getGenerativeModel({
      model: 'gemini-flash-latest',
      generationConfig: {
        temperature: req.temperature ?? 0.3,
        responseMimeType: 'application/json',
        responseSchema: buildGeminiSchema(req.jsonSchema as Record<string, unknown>),
      },
      systemInstruction: req.system,
    });

    let result;
    try {
      result = await model.generateContent(req.prompt);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
        throw new RetryableError(`Gemini rate limited: ${errMsg}`);
      }
      if (errMsg.includes("500") || errMsg.includes("503") || errMsg.includes("UNAVAILABLE")) {
        throw new RetryableError(`Gemini server error: ${errMsg}`);
      }
      // 404 covers a retired/renamed model id — fall through to the next provider rather than hard-failing the request.
      if (errMsg.includes("404") || errMsg.includes("not found")) {
        throw new RetryableError(`Gemini model unavailable: ${errMsg}`);
      }
      throw err;
    }

    const raw = result.response.text();

    let data: T;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      throw new ParseError(`Gemini returned non-JSON: ${raw.slice(0, 200)}`, raw);
    }

    return { data, raw };
  }
}

export function createGeminiEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

  return model.embedContent(text).then((res) => res.embedding.values);
}
