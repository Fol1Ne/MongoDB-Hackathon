export {
  CURRENT_SCHEMA_VERSION,
  EnvironmentSpecSchema,
  LIMITS,
  type AssetDefinition,
  type EnvironmentObject,
  type EnvironmentSpec,
  type ValidationError,
  type ValidationResult,
  type Vec3,
} from "@twin/schema";
export { ASSET_CATALOGUE, DEFAULT_ASSET_MAP, buildAssetMap, type AssetMap } from "@twin/catalogue";
export { computeBox, validateAndParse, validateEnvironmentSpec } from "@twin/validator";
