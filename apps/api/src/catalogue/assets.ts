export interface CatalogueEntry {
  type: string;
  usdAsset?: string;
  footprint: [number, number]; // [width_x, depth_z] in metres
  height: number;
  collision: 'box' | 'cylinder' | 'mesh';
  tags: string[];
}

export const ASSET_CATALOGUE: CatalogueEntry[] = [
  { type: 'industrial_shelf',  usdAsset: 'assets/shelf_industrial_v2.usd',  footprint: [1.2, 0.6], height: 2.4,  collision: 'box',      tags: ['storage'] },
  { type: 'pallet',            usdAsset: 'assets/pallet_v1.usd',            footprint: [1.2, 0.8], height: 0.15, collision: 'box',      tags: ['cargo'] },
  { type: 'workbench',         usdAsset: 'assets/workbench_v1.usd',         footprint: [1.8, 0.8], height: 0.9,  collision: 'box',      tags: ['work_area'] },
  { type: 'storage_rack',      usdAsset: 'assets/storage_rack_v1.usd',      footprint: [1.5, 0.6], height: 2.0,  collision: 'box',      tags: ['storage'] },
  { type: 'forklift_zone',     usdAsset: 'assets/forklift_zone_v1.usd',     footprint: [3.0, 4.0], height: 0.1,  collision: 'box',      tags: ['zone', 'warehouse'] },
  { type: 'loading_dock',      usdAsset: 'assets/loading_dock_v1.usd',      footprint: [5.0, 3.0], height: 1.2,  collision: 'box',      tags: ['logistics'] },
  { type: 'conveyor',          usdAsset: 'assets/conveyor_v1.usd',          footprint: [4.0, 0.8], height: 0.9,  collision: 'box',      tags: ['production'] },
  { type: 'machine_station',   usdAsset: 'assets/machine_station_v1.usd',   footprint: [2.0, 1.5], height: 2.0,  collision: 'box',      tags: ['production'] },
  { type: 'office_desk',       usdAsset: 'assets/office_desk_v1.usd',       footprint: [1.4, 0.7], height: 0.75, collision: 'box',      tags: ['office'] },
  { type: 'office_chair',      usdAsset: 'assets/office_chair_v1.usd',      footprint: [0.6, 0.6], height: 1.0,  collision: 'cylinder', tags: ['office'] },
  { type: 'crate',             usdAsset: 'assets/crate_v1.usd',             footprint: [0.8, 0.8], height: 0.8,  collision: 'box',      tags: ['cargo'] },
  { type: 'barrier',           usdAsset: 'assets/barrier_v1.usd',           footprint: [2.0, 0.2], height: 1.0,  collision: 'box',      tags: ['safety'] },
  { type: 'column',            usdAsset: 'assets/column_v1.usd',            footprint: [0.4, 0.4], height: 4.0,  collision: 'cylinder', tags: ['structural'] },
  { type: 'door',              usdAsset: 'assets/door_v1.usd',              footprint: [1.0, 0.1], height: 2.1,  collision: 'box',      tags: ['navigation'] },
  { type: 'charging_station',  usdAsset: 'assets/charging_station_v1.usd',  footprint: [0.6, 0.6], height: 1.5,  collision: 'box',      tags: ['robot'] },
];

export const ASSET_MAP = new Map<string, CatalogueEntry>(
  ASSET_CATALOGUE.map((a) => [a.type, a])
);

export const KNOWN_TYPES = new Set<string>(ASSET_CATALOGUE.map((a) => a.type));
