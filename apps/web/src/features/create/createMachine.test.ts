import { describe, expect, it } from "vitest";
import { createReducer, promptProblem, type CreateState } from "./createMachine";

const idle: CreateState = { kind: "idle" };

describe("create flow", () => {
  it("records finished phases in order while running", () => {
    let s = createReducer(idle, { type: "start", source: "photos", at: 0 });
    s = createReducer(s, { type: "phase", phase: "uploading" });
    s = createReducer(s, { type: "phase", phase: "analyzing" });
    s = createReducer(s, { type: "phase", phase: "estimating" });
    expect(s).toEqual({ kind: "running", source: "photos", phase: "estimating", done: ["uploading", "analyzing"], startedAt: 0 });
  });

  it("ignores a second start and phases outside a run", () => {
    const running = createReducer(idle, { type: "start", source: "prompt", at: 5 });
    expect(createReducer(running, { type: "start", source: "photos", at: 9 })).toBe(running);
    expect(createReducer(idle, { type: "phase", phase: "saving" })).toBe(idle);
  });

  it("keeps the source on failure so Retry knows what to rerun", () => {
    const running = createReducer(idle, { type: "start", source: "photos", at: 0 });
    expect(createReducer(running, { type: "fail", error: { kind: "aborted" } })).toEqual({ kind: "failed", source: "photos", error: { kind: "aborted" } });
  });

  it("cannot start while photos are still being prepared", () => {
    const preparing = createReducer(idle, { type: "prepare", pending: 2 });
    expect(createReducer(preparing, { type: "start", source: "photos", at: 0 })).toBe(preparing);
    expect(createReducer(preparing, { type: "prepared" })).toEqual(idle);
  });

  it("checks prompt length against the backend limits", () => {
    expect(promptProblem("")).toBeNull();
    expect(promptProblem("warehouse")).toBe("Add a little more detail (1 more characters).");
    expect(promptProblem("a warehouse")).toBeNull();
    expect(promptProblem("x".repeat(501))).toBe("Keep it under 500 characters.");
  });
});
