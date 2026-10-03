export const SIM_VERSION = "1.0.0";

/** Tunables of twin-sim-2d. test/demoScenes.test.ts locks the demo outcomes these values produce. */
export const SIM = {
  cellSizeM: 0.25, maxCellsPerAxis: 400, paddingM: 0.05, inflationM: 0.6, inflationCost: 2,
  goalToleranceM: 0.75, sampleHz: 10, slowdownM: 1, minSpeedFactor: 0.25, creepStepM: 0.02, blockedDwellSec: 3,
  nearMissM: 0.25, hotspotCellM: 1, maxHotspots: 50,
} as const;

export type SimConfig = { [K in keyof typeof SIM]: number };
