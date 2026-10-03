import type { ZodTypeAny } from "zod";

export type JsonSchema = { [key: string]: unknown };

/**
 * Zod 3 → JSON Schema restricted to what Gemini's `responseJsonSchema` handles reliably (also fine for
 * OpenAI-compatible `json_schema` without strict mode). Differences from zod-to-json-schema:
 * homogeneous tuples become fixed-length arrays (no array-form `items`), literals become one-value enums, and
 * exclusive bounds become inclusive ones. The validator still enforces the exact rules, so always validate output.
 */
export function zodToGeminiJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._def as any; // Zod 3 internal definition; typeName is stable across 3.x
  switch (def.typeName) {
    case "ZodObject": {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(def.shape() as Record<string, ZodTypeAny>)) {
        properties[key] = zodToGeminiJsonSchema(value);
        if (!value.isOptional()) required.push(key);
      }
      return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
    }
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      for (const c of def.checks) {
        if (c.kind === "min") out.minLength = c.value;
        else if (c.kind === "max") out.maxLength = c.value;
        else if (c.kind === "regex") out.pattern = c.regex.source;
        else if (c.kind === "datetime") out.format = "date-time";
      }
      return out;
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "number" };
      for (const c of def.checks) {
        if (c.kind === "min") out.minimum = c.value; // .positive() is exclusive 0; Gemini ignores exclusiveMinimum
        else if (c.kind === "max") out.maximum = c.value;
        else if (c.kind === "int") out.type = "integer";
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: [...def.values] };
    case "ZodLiteral":
      return { type: typeof def.value, enum: [def.value] };
    case "ZodTuple": {
      const items = (def.items as ZodTypeAny[]).map(zodToGeminiJsonSchema);
      const first = items[0] ?? {};
      const homogeneous = items.every((i) => JSON.stringify(i) === JSON.stringify(first));
      return homogeneous
        ? { type: "array", items: first, minItems: items.length, maxItems: items.length }
        : { type: "array", prefixItems: items, minItems: items.length, maxItems: items.length };
    }
    case "ZodArray": {
      const out: JsonSchema = { type: "array", items: zodToGeminiJsonSchema(def.type) };
      if (def.minLength) out.minItems = def.minLength.value;
      if (def.maxLength) out.maxItems = def.maxLength.value;
      if (def.exactLength) out.minItems = out.maxItems = def.exactLength.value;
      return out;
    }
    case "ZodNullable": {
      const inner = zodToGeminiJsonSchema(def.innerType);
      return typeof inner.type === "string" && !inner.enum
        ? { ...inner, type: [inner.type, "null"] }
        : { anyOf: [inner, { type: "null" }] };
    }
    case "ZodOptional":
    case "ZodDefault":
      return zodToGeminiJsonSchema(def.innerType);
    case "ZodEffects":
      return zodToGeminiJsonSchema(def.schema);
    default:
      throw new Error(`zodToGeminiJsonSchema: unsupported Zod type ${def.typeName}`);
  }
}
