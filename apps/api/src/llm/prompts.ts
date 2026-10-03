import { ID_PATTERN, type EnvironmentSpec } from "@twin/schema";
import type { AssetDefinition } from "@twin/schema";

function formatCatalogueTable(catalogue: readonly AssetDefinition[]): string {
  const header = "| type | footprint (m) | height (m) |";
  const sep = "|---|---|---|";
  const rows = catalogue.map(
    (a) => `| \`${a.type}\` | ${a.footprint[0]} × ${a.footprint[1]} | ${a.height} |`,
  );
  return [header, sep, ...rows].join("\n");
}

function formatExamples(examples: EnvironmentSpec[]): string {
  if (examples.length === 0) return "";
  const parts = examples.map((e, i) => {
    const summary = `${e.environment.type} ${e.environment.dimensions.width}×${e.environment.dimensions.length}m`;
    return `Example ${i + 1} (${summary}):\n${JSON.stringify(e, null, 2)}`;
  });
  return `\nHere are validated example environments for reference:\n\n${parts.join("\n\n---\n\n")}\n`;
}

export function buildSystemPrompt(
  catalogue: readonly AssetDefinition[],
  examples: EnvironmentSpec[],
): string {
  return `You are an AI that converts natural-language environment descriptions into EnvironmentSpec JSON objects for robot simulation.

RULES:
1. All measurements are in metres. Coordinate system: Y-up, right-handed. X = width, Y = height, Z = length. Rotations are Euler XYZ in radians (not degrees).
2. Origin is at the environment centre on the ground plane.
3. All object positions MUST be inside environment bounds:
   - X: [-width/2, +width/2]
   - Y: >= 0 (on or above the ground)
   - Z: [-length/2, +length/2]
4. You MUST ONLY use object types from the ASSET CATALOGUE below. Any other type is invalid.
5. Every object and waypoint must have a unique id (e.g. "shelf_001", "shelf_002"). IDs must match ${ID_PATTERN.source}: a letter or underscore, then letters, digits or underscores only (no "-" or ".").
6. Static objects should not overlap each other.
7. Scale values must all be between 0.1 and 10.
8. Set schemaVersion to "1.0.0".
9. Set provenance.source to "text" and provenance.generatedAt to the current ISO timestamp.
10. Set robotics.simulation_enabled to true.
11. Output raw JSON only — no markdown, no code fences, no explanation.

ASSET CATALOGUE:
${formatCatalogueTable(catalogue)}
${formatExamples(examples)}`;
}

export function buildRepairPrompt(
  originalPrompt: string,
  invalidSpec: unknown,
  errors: { path: string; code: string; message: string }[],
): string {
  return `The EnvironmentSpec you previously generated is invalid. You MUST fix every error listed below.

ORIGINAL USER REQUEST:
${originalPrompt}

YOUR INVALID SPEC:
${JSON.stringify(invalidSpec, null, 2)}

VALIDATION ERRORS:
${errors.map((e) => `- [${e.code}] ${e.path}: ${e.message}`).join("\n")}

Return a corrected EnvironmentSpec JSON that resolves every error. Follow all original rules.
Output raw JSON only. No markdown. No explanation.`;
}

export function buildUserPrompt(userDescription: string): string {
  return `Generate an EnvironmentSpec for the following description:\n\n${userDescription}`;
}
