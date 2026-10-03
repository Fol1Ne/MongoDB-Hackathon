import type { EnvironmentSpec } from "@twin/schema";
import type { Sample } from "../src";

type Obj = EnvironmentSpec["objects"][number];

export const obj = (id: string, type: string, x: number, z: number, scale: [number, number, number] = [1, 1, 1], yaw = 0): Obj => ({
  id, type, position: [x, 0, z], rotation: [0, yaw, 0], scale, physics: { static: true, mass: null },
});

export function scene(o: {
  width?: number; length?: number; objects?: Obj[]; friction?: number;
  waypoints?: [id: string, x: number, z: number][];
} = {}): EnvironmentSpec {
  return {
    schemaVersion: "1.0.0",
    environment: { name: "Test floor", type: "warehouse", dimensions: { width: o.width ?? 20, length: o.length ?? 20, height: 5 } },
    terrain: { type: "concrete", properties: { friction: o.friction ?? 0.8 }, heightmap: null },
    objects: o.objects ?? [],
    navigation: {
      waypoints: (o.waypoints ?? [["wp_a", -5, -5], ["wp_b", 5, 5]]).map(([id, x, z]) => ({ id, position: [x, 0, z] as [number, number, number] })),
    },
    robotics: { simulation_enabled: true },
    provenance: { source: "manual", generatedAt: "2026-10-03T12:00:00Z" },
  };
}

/** Two walls across z = 0 that touch both side walls of a 20 × 20 m floor, leaving a 1.1 m gap centred on x = 0. */
export const gapScene = () =>
  scene({
    objects: [obj("wall_left", "wall", -5.275, 0, [2.3625, 1, 1]), obj("wall_right", "wall", 5.275, 0, [2.3625, 1, 1])],
    waypoints: [["wp_a", 0, -6], ["wp_b", 0, 6]],
  });

/** Length of the polyline the samples actually drove. */
export function drivenLength(samples: readonly Sample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    total += Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
  }
  return total;
}
