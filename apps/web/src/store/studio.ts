import { create } from "zustand";
import { temporal } from "zundo";
import { api } from "../api/client";
import type { ApiError, Confidence, EnvironmentDto, StoredPhoto, VersionDto, VersionMeta } from "../api/types";
import type { EnvironmentSpec } from "../contract";
import { analyze, EMPTY_ANALYSIS, type Analysis } from "../domain/analysis";
import { changeNote, diffSpecs, nextId, sameSpec } from "../domain/specOps";
import { runCommand, type CommandArgs, type CommandId } from "./commands";

export type Tool = "translate" | "rotate";
export type View = "iso" | "top";
export type SaveStatus = { kind: "idle" } | { kind: "saving" } | { kind: "conflict" } | { kind: "failed"; error: ApiError };

export interface StudioState {
  spec: EnvironmentSpec | null;
  env: EnvironmentDto | null;
  versions: VersionMeta[];
  headVersion: number;
  baseVersion: number;
  savedSpec: EnvironmentSpec | null;
  confidence: Confidence | null;
  photos: StoredPhoto[];
  analysis: Analysis;
  saveStatus: SaveStatus;
  loadNonce: number;

  selection: string | null;
  hover: string | null;
  tool: Tool;
  snap: boolean;
  view: View | null;
  viewNonce: number;
  focusNonce: number;
  hidden: readonly string[];
  query: string;
  panel: "none" | "add" | "photos";
  dragging: string | null;
  reviewOnly: boolean;
  reviewed: readonly string[];

  open(input: { environment: EnvironmentDto; version: VersionDto; versions: VersionMeta[]; confidence: Confidence | null; photos: StoredPhoto[] }): void;
  commit<K extends CommandId>(id: K, args: CommandArgs<K>): void;
  setDraftAnalysis(a: Analysis): void;
  select(id: string | null): void;
  setHover(id: string | null): void;
  setTool(t: Tool): void;
  toggleSnap(): void;
  setView(v: View): void;
  clearView(): void;
  focusSelection(): void;
  toggleHidden(type: string): void;
  showAll(): void;
  setQuery(q: string): void;
  setPanel(p: StudioState["panel"]): void;
  setDragging(id: string | null): void;
  setReviewOnly(on: boolean): void;
  markReviewed(id: string): void;
  resolveConflict(choice: "reload" | "override"): Promise<void>;
  addObject(type: string, x: number, z: number): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  save(note?: string): Promise<void>;
  openVersion(n: number): Promise<ApiError | null>;
  reloadHead(): Promise<void>;
}

export const useStudio = create<StudioState>()(
  temporal(
    (set, get) => ({
      spec: null,
      env: null,
      versions: [],
      headVersion: 0,
      baseVersion: 0,
      savedSpec: null,
      confidence: null,
      photos: [],
      analysis: EMPTY_ANALYSIS,
      saveStatus: { kind: "idle" },
      loadNonce: 0,
      selection: null,
      hover: null,
      tool: "translate",
      snap: true,
      view: "iso",
      viewNonce: 0,
      focusNonce: 0,
      hidden: [],
      query: "",
      panel: "none",
      dragging: null,
      reviewOnly: false,
      reviewed: [],

      open(input) {
        set({
          spec: input.version.spec,
          env: input.environment,
          versions: input.versions,
          headVersion: input.version.version,
          baseVersion: input.version.version,
          savedSpec: input.version.spec,
          confidence: input.confidence,
          photos: input.photos,
          analysis: analyze(input.version.spec),
          saveStatus: { kind: "idle" },
          loadNonce: get().loadNonce + 1,
          selection: null,
          hover: null,
          hidden: [],
          query: "",
          panel: "none",
          view: "iso",
          reviewOnly: false,
          reviewed: [],
        });
        useStudio.temporal.getState().clear();
      },
      commit(id, args) {
        const spec = get().spec;
        if (!spec) return;
        const touched = (id === "transform" || id === "setScale") && "id" in args ? String(args.id) : null;
        set({
          spec: runCommand(spec, id, args),
          saveStatus: get().saveStatus.kind === "failed" ? { kind: "idle" } : get().saveStatus,
          reviewed: touched && !get().reviewed.includes(touched) ? [...get().reviewed, touched] : get().reviewed,
        });
      },
      setDraftAnalysis: (analysis) => set({ analysis }),
      select: (selection) => {
        const type = selection ? get().spec?.objects.find((o) => o.id === selection)?.type : undefined;
        set({ selection, panel: get().panel === "add" ? "none" : get().panel, hidden: type ? get().hidden.filter((t) => t !== type) : get().hidden });
      },
      setHover: (hover) => (get().hover === hover ? undefined : set({ hover })),
      setTool: (tool) => set({ tool }),
      toggleSnap: () => set({ snap: !get().snap }),
      setView: (view) => set({ view, viewNonce: get().viewNonce + 1 }),
      clearView: () => (get().view ? set({ view: null }) : undefined),
      focusSelection: () => set({ focusNonce: get().focusNonce + 1 }),
      toggleHidden: (type) => {
        const hidden = get().hidden.includes(type) ? get().hidden.filter((t) => t !== type) : [...get().hidden, type];
        const sel = get().spec?.objects.find((o) => o.id === get().selection);
        set({ hidden, selection: sel && hidden.includes(sel.type) ? null : get().selection });
      },
      showAll: () => set({ hidden: [] }),
      setQuery: (query) => set({ query }),
      setPanel: (panel) => set({ panel }),
      setDragging: (dragging) => set({ dragging }),
      setReviewOnly: (reviewOnly) => set({ reviewOnly }),
      markReviewed: (id) => (get().reviewed.includes(id) ? undefined : set({ reviewed: [...get().reviewed, id] })),
      addObject(type, x, z) {
        const spec = get().spec;
        if (!spec) return;
        const id = nextId(spec, type);
        get().commit("add", { id, type, x, z });
        set({ selection: id, panel: "none", hidden: get().hidden.filter((t) => t !== type) });
      },
      deleteSelection() {
        const id = get().selection;
        if (!id) return;
        set({ selection: null });
        get().commit("remove", { id });
      },
      duplicateSelection() {
        const { spec, selection } = get();
        const o = spec?.objects.find((x) => x.id === selection);
        if (!spec || !o) return;
        const newId = nextId(spec, o.type);
        get().commit("duplicate", { id: o.id, newId });
        set({ selection: newId });
      },
      async save(note) {
        const s = get();
        if (!s.spec || !s.env || s.analysis.errors.length || s.saveStatus.kind === "saving") return;
        const dirty = !sameSpec(s.spec, s.savedSpec);
        if (!dirty && s.baseVersion === s.headVersion) return;
        set({ saveStatus: { kind: "saving" } });
        const auto = s.savedSpec ? changeNote(diffSpecs(s.savedSpec, s.spec), JSON.stringify(s.savedSpec.environment) !== JSON.stringify(s.spec.environment)) : "Edited";
        const r = dirty
          ? await api.save(s.env.id, { spec: s.spec, changeNote: note?.trim() || auto, baseVersion: s.headVersion })
          : await api.revert(s.env.id, { toVersion: s.baseVersion, baseVersion: s.headVersion });
        if (!r.ok) {
          set({ saveStatus: r.error.kind === "http" && r.error.code === "VERSION_CONFLICT" ? { kind: "conflict" } : { kind: "failed", error: r.error } });
          return;
        }
        const { spec: _spec, ...meta } = r.data.version;
        set({
          env: r.data.environment,
          versions: [...get().versions, meta],
          headVersion: r.data.version.version,
          baseVersion: r.data.version.version,
          savedSpec: get().spec,
          saveStatus: { kind: "idle" },
        });
      },
      async openVersion(n) {
        const env = get().env;
        if (!env) return null;
        const r = await api.getVersion(env.id, n);
        if (!r.ok) return r.error;
        set({ spec: r.data.spec, savedSpec: r.data.spec, baseVersion: n, analysis: analyze(r.data.spec), selection: null, saveStatus: { kind: "idle" } });
        useStudio.temporal.getState().clear();
        return null;
      },
      async resolveConflict(choice) {
        if (choice === "reload") return get().reloadHead();
        const env = get().env;
        if (!env) return;
        const versions = await api.listVersions(env.id);
        if (!versions.ok) return set({ saveStatus: { kind: "failed", error: versions.error } });
        const head = versions.data.at(-1)?.version ?? get().headVersion;
        set({ versions: versions.data, headVersion: head, baseVersion: head, saveStatus: { kind: "idle" } });
        await get().save();
      },
      async reloadHead() {
        const env = get().env;
        if (!env) return;
        const [head, versions] = await Promise.all([api.getHead(env.id), api.listVersions(env.id)]);
        if (!head.ok || !versions.ok) return;
        get().open({ environment: head.data.environment, version: head.data.version, versions: versions.data, confidence: get().confidence, photos: get().photos });
      },
    }),
    {
      partialize: (s) => ({ spec: s.spec }),
      equality: (a, b) => a.spec === b.spec,
      limit: 100,
    },
  ),
);

useStudio.subscribe((s, prev) => {
  if (s.spec !== prev.spec && s.spec && !s.dragging) useStudio.setState({ analysis: analyze(s.spec) });
});

export function useUndo() {
  return useStudio.temporal.getState();
}

export type SaveView =
  | { kind: "blocked"; errors: number; label: string }
  | { kind: "saving"; label: string }
  | { kind: "dirty"; label: string }
  | { kind: "restore"; label: string }
  | { kind: "clean"; label: string }
  | { kind: "conflict"; label: string }
  | { kind: "failed"; label: string; error: ApiError };

export function saveView(s: Pick<StudioState, "spec" | "savedSpec" | "analysis" | "saveStatus" | "baseVersion" | "headVersion">): SaveView {
  if (s.saveStatus.kind === "saving") return { kind: "saving", label: "Saving" };
  if (s.saveStatus.kind === "conflict") return { kind: "conflict", label: "A newer version exists" };
  const n = s.analysis.errors.length;
  if (n) return { kind: "blocked", errors: n, label: `Fix ${n} error${n === 1 ? "" : "s"} to save` };
  if (s.saveStatus.kind === "failed") return { kind: "failed", label: "Try saving again", error: s.saveStatus.error };
  if (!sameSpec(s.spec, s.savedSpec)) return { kind: "dirty", label: "Save version" };
  if (s.baseVersion !== s.headVersion) return { kind: "restore", label: `Restore as v${s.headVersion + 1}` };
  return { kind: "clean", label: "Saved" };
}

if (import.meta.env.DEV) Object.assign(globalThis, { __studio: useStudio });
