import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toLlmJsonSchema, zodToGeminiJsonSchema, type JsonSchema } from "../src";

function walk(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { visit(k, v); walk(v, visit); }
}
const prop = (s: JsonSchema, ...path: string[]): JsonSchema =>
  path.reduce<JsonSchema>((node, key) =>
    key === "[]" ? (node.items as JsonSchema) : (node.properties as Record<string, JsonSchema>)[key]!, s);

describe("toLlmJsonSchema", () => {
  const schema = toLlmJsonSchema();

  it("describes the spec without provenance, which the server fills in", () => {
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties as object)).not.toContain("provenance");
    expect(schema.required).toEqual(expect.arrayContaining(["schemaVersion", "environment", "terrain", "objects", "robotics"]));
  });

  it("emits vec3 tuples as fixed-length number arrays", () => {
    expect(prop(schema, "objects", "[]", "position")).toMatchObject({ type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 });
    expect(prop(schema, "objects", "[]", "scale")).toMatchObject({ items: { type: "number", minimum: 0.1, maximum: 10 } });
  });

  it("uses only keywords Gemini's responseJsonSchema handles reliably", () => {
    walk(schema, (key, value) => {
      expect(["$schema", "const", "exclusiveMinimum", "exclusiveMaximum", "prefixItems"]).not.toContain(key);
      if (key === "items") expect(Array.isArray(value)).toBe(false);
    });
  });

  it("keeps enums, ranges, nullability and strictness", () => {
    expect(prop(schema, "schemaVersion")).toEqual({ type: "string", enum: ["1.0.0"] });
    expect(prop(schema, "environment", "type")).toMatchObject({ enum: ["warehouse", "factory", "office", "outdoor", "custom"] });
    expect(prop(schema, "terrain", "properties", "friction")).toMatchObject({ type: "number", minimum: 0, maximum: 2 });
    expect(prop(schema, "terrain", "heightmap")).toMatchObject({ type: ["object", "null"] });
    expect(prop(schema, "environment")).toMatchObject({ additionalProperties: false });
  });

  it("constrains object types to the catalogue when given", () => {
    expect(prop(toLlmJsonSchema(), "objects", "[]", "type").enum).toBeUndefined();
    expect(prop(toLlmJsonSchema({ objectTypes: ["pallet", "crate"] }), "objects", "[]", "type"))
      .toMatchObject({ type: "string", enum: ["pallet", "crate"] });
  });
});

describe("zodToGeminiJsonSchema", () => {
  it("keeps heterogeneous tuples position by position", () => {
    expect(zodToGeminiJsonSchema(z.tuple([z.string(), z.number()]))).toEqual({
      type: "array", prefixItems: [{ type: "string" }, { type: "number" }], minItems: 2, maxItems: 2,
    });
  });

  it("carries Zod descriptions through, including on wrapped and tuple types", () => {
    expect(zodToGeminiJsonSchema(z.string().describe("an id"))).toEqual({ type: "string", description: "an id" });
    expect(zodToGeminiJsonSchema(z.object({ a: z.number().optional().describe("metres") }).strict()))
      .toMatchObject({ properties: { a: { type: "number", description: "metres" } } });
    expect(zodToGeminiJsonSchema(z.tuple([z.number(), z.number()]).describe("radians")))
      .toMatchObject({ type: "array", description: "radians" });
  });

  it("fails loudly on Zod types it can't translate", () => {
    expect(() => zodToGeminiJsonSchema(z.map(z.string(), z.number()))).toThrow(/ZodMap/);
  });
});
