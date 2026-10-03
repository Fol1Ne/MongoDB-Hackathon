import { DEFAULT_ASSET_MAP, type AssetMap } from "../contract";
import { CATEGORY_HEX, type Category } from "../design/tokens";

const isCategory = (tag: string | undefined): tag is Category => tag !== undefined && tag in CATEGORY_HEX;

export function categoryOf(type: string, assets: AssetMap = DEFAULT_ASSET_MAP): Category {
  const tag = assets.get(type)?.tags[0];
  return isCategory(tag) ? tag : "structure";
}

export const colorOf = (type: string, assets: AssetMap = DEFAULT_ASSET_MAP): string => CATEGORY_HEX[categoryOf(type, assets)];

export const labelOf = (type: string, assets: AssetMap = DEFAULT_ASSET_MAP): string => assets.get(type)?.name ?? type;

export function footprintOf(type: string, assets: AssetMap = DEFAULT_ASSET_MAP): { width: number; depth: number; height: number; known: boolean } {
  const a = assets.get(type);
  return a ? { width: a.footprint[0], depth: a.footprint[1], height: a.height, known: true } : { width: 1, depth: 1, height: 1, known: false };
}
