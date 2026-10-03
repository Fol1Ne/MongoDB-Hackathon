import { EnvironmentSpecSchema, type EnvironmentSpec } from "../contract";
import photoFixture from "../contract/fixtures/photo.warehouse.json";
import versionsFixture from "../contract/fixtures/warehouse.versions.json";
import { KNOWN_DIMENSIONS, type Confidence, type KnownDimension } from "./types";

const TEXT_BASE = EnvironmentSpecSchema.parse(versionsFixture[0]!.spec);
const PHOTO_BASE = EnvironmentSpecSchema.parse(photoFixture.spec);
const PHOTO_CONFIDENCE: Confidence = photoFixture.confidence;

export const DEMO_VERSIONS = versionsFixture.map((v) => ({ ...v, spec: EnvironmentSpecSchema.parse(v.spec) }));

export function localTextSpec(prompt: string): EnvironmentSpec {
  const spec = structuredClone(TEXT_BASE);
  spec.provenance = { source: "text", prompt, model: "local preview generator", generatedAt: new Date().toISOString(), confidence: null };
  return spec;
}

export function localPhotoSpec(photoCount: number, hint: string, known: KnownDimension | null): { spec: EnvironmentSpec; confidence: Confidence } {
  const spec = structuredClone(PHOTO_BASE);
  const parts = [`${photoCount} photo${photoCount === 1 ? "" : "s"}`];
  if (hint.trim()) parts.push(hint.trim());
  if (known) parts.push(`Scale hint: ${KNOWN_DIMENSIONS[known.kind].toLowerCase()} ${known.meters} m`);
  spec.provenance = { source: "image", prompt: parts.join(". "), model: "local preview generator", generatedAt: new Date().toISOString(), confidence: 0.62 };
  return { spec, confidence: PHOTO_CONFIDENCE };
}
