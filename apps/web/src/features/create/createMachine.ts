import type { ApiError, Phase } from "../../api/types";

export type Source = "photos" | "prompt";

export type CreateState =
  | { kind: "idle" }
  | { kind: "preparing"; pending: number }
  | { kind: "running"; source: Source; phase: Phase | null; done: readonly Phase[]; startedAt: number }
  | { kind: "failed"; source: Source; error: ApiError };

export type CreateEvent =
  | { type: "prepare"; pending: number }
  | { type: "prepared" }
  | { type: "start"; source: Source; at: number }
  | { type: "phase"; phase: Phase }
  | { type: "fail"; error: ApiError }
  | { type: "reset" };

export function createReducer(state: CreateState, event: CreateEvent): CreateState {
  switch (event.type) {
    case "prepare":
      return state.kind === "running" ? state : { kind: "preparing", pending: event.pending };
    case "prepared":
      return state.kind === "preparing" ? { kind: "idle" } : state;
    case "start":
      return state.kind === "running" || state.kind === "preparing" ? state : { kind: "running", source: event.source, phase: null, done: [], startedAt: event.at };
    case "phase":
      if (state.kind !== "running") return state;
      return { ...state, phase: event.phase, done: state.phase && !state.done.includes(state.phase) ? [...state.done, state.phase] : state.done };
    case "fail":
      return state.kind === "running" ? { kind: "failed", source: state.source, error: event.error } : state;
    case "reset":
      return { kind: "idle" };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export const PROMPT_LIMITS = { min: 10, max: 500 };
export const promptProblem = (p: string): string | null => {
  const n = p.trim().length;
  if (n === 0) return null;
  if (n < PROMPT_LIMITS.min) return `Add a little more detail (${PROMPT_LIMITS.min - n} more characters).`;
  if (n > PROMPT_LIMITS.max) return `Keep it under ${PROMPT_LIMITS.max} characters.`;
  return null;
};
