import { current, produce } from "immer";
import type { EnvironmentSpec } from "../contract";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const normYaw = (yaw: number) => Math.atan2(Math.sin(yaw), Math.cos(yaw));

type EnvPatch = {
  name?: string;
  type?: EnvironmentSpec["environment"]["type"];
  width?: number;
  length?: number;
  height?: number;
  terrain?: EnvironmentSpec["terrain"]["type"];
  friction?: number;
  restitution?: number;
};

interface Command<A> {
  label: (args: A) => string;
  apply: (spec: EnvironmentSpec, args: A) => EnvironmentSpec;
}
const command = <A>(c: Command<A>) => c;

export const COMMANDS = {
  transform: command<{ id: string; x: number; z: number; yaw: number }>({
    label: (a) => `Move ${a.id}`,
    apply: (spec, a) => produce(spec, (d) => {
      const o = d.objects.find((x) => x.id === a.id);
      if (!o) return;
      o.position = [r3(a.x), o.position[1], r3(a.z)];
      o.rotation = [o.rotation[0], r3(normYaw(a.yaw)), o.rotation[2]];
    }),
  }),
  setScale: command<{ id: string; axis: 0 | 1 | 2; value: number }>({
    label: (a) => `Scale ${a.id}`,
    apply: (spec, a) => produce(spec, (d) => {
      const o = d.objects.find((x) => x.id === a.id);
      if (o) o.scale[a.axis] = Math.min(10, Math.max(0.1, r3(a.value)));
    }),
  }),
  add: command<{ id: string; type: string; x: number; z: number }>({
    label: (a) => `Add ${a.id}`,
    apply: (spec, a) => produce(spec, (d) => {
      d.objects.push({ id: a.id, type: a.type, position: [r3(a.x), 0, r3(a.z)], rotation: [0, 0, 0], scale: [1, 1, 1], physics: { static: true, mass: null } });
    }),
  }),
  remove: command<{ id: string }>({
    label: (a) => `Delete ${a.id}`,
    apply: (spec, a) => produce(spec, (d) => {
      d.objects = d.objects.filter((o) => o.id !== a.id);
    }),
  }),
  duplicate: command<{ id: string; newId: string }>({
    label: (a) => `Duplicate ${a.id}`,
    apply: (spec, a) => produce(spec, (d) => {
      const o = d.objects.find((x) => x.id === a.id);
      if (!o) return;
      const source = structuredClone(current(o));
      d.objects.push({ ...source, id: a.newId, position: [r3(source.position[0] + 1.5), source.position[1], r3(source.position[2] + 1.5)] });
    }),
  }),
  setEnvironment: command<EnvPatch>({
    label: () => "Edit environment",
    apply: (spec, a) => produce(spec, (d) => {
      if (a.name !== undefined) d.environment.name = a.name;
      if (a.type !== undefined) d.environment.type = a.type;
      if (a.width !== undefined) d.environment.dimensions.width = a.width;
      if (a.length !== undefined) d.environment.dimensions.length = a.length;
      if (a.height !== undefined) d.environment.dimensions.height = a.height;
      if (a.terrain !== undefined) d.terrain.type = a.terrain;
      if (a.friction !== undefined) d.terrain.properties.friction = a.friction;
      if (a.restitution !== undefined) d.terrain.properties.restitution = a.restitution;
    }),
  }),
};

export type CommandId = keyof typeof COMMANDS;
export type CommandArgs<K extends CommandId> = Parameters<(typeof COMMANDS)[K]["apply"]>[1];

export function runCommand<K extends CommandId>(spec: EnvironmentSpec, id: K, args: CommandArgs<K>): EnvironmentSpec {
  const c = COMMANDS[id] as Command<CommandArgs<K>>;
  return c.apply(spec, args);
}

export function commandLabel<K extends CommandId>(id: K, args: CommandArgs<K>): string {
  const c = COMMANDS[id] as Command<CommandArgs<K>>;
  return c.label(args);
}
