import type { EnvironmentSpec } from "@twin/schema";

export function makeSpec(overrides: Partial<EnvironmentSpec> = {}): EnvironmentSpec {
  return {
    schemaVersion: "1.0.0",
    environment: { name: "Warehouse Environment", type: "warehouse", dimensions: { width: 50, length: 80, height: 12 } },
    terrain: { type: "concrete", properties: { friction: 0.8, restitution: 0.05 }, heightmap: null },
    objects: [
      { id: "shelf_001", type: "industrial_shelf", position: [10, 0, 15], rotation: [0, 0, 0], scale: [1, 1, 1], physics: { static: true, mass: null }, tags: ["storage"] },
      { id: "shelf_002", type: "industrial_shelf", position: [10, 0, 20], rotation: [0, 0, 0], scale: [1, 1, 1], physics: { static: true, mass: null }, tags: ["storage"] },
    ],
    lighting: { preset: "warehouse_overhead", intensity: 1.0 },
    navigation: { waypoints: [{ id: "wp_start", position: [0, 0, 0] }, { id: "wp_dock", position: [-20, 0, 35] }] },
    robotics: { simulation_enabled: true },
    provenance: { source: "text", prompt: "A 50 by 80 metre warehouse", model: "gemini-flash", generatedAt: "2026-09-29T14:20:00Z", confidence: null },
    ...overrides,
  };
}
export const clone = <T,>(x: T): T => structuredClone(x);
