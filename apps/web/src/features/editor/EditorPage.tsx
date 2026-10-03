import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api/client";
import { copyFor } from "../../api/errors";
import type { EnvId } from "../../api/types";
import { Brand, Icon, Stepper } from "../../components/ui";
import { useObjectUrls } from "../../components/useObjectUrls";
import { DEFAULT_ASSET_MAP } from "../../contract";
import { CATEGORY_ORDER } from "../../design/tokens";
import { categoryOf, colorOf, footprintOf } from "../../domain/categories";
import { LOW_CONFIDENCE } from "../../design/tokens";
import { saveView, useStudio } from "../../store/studio";
import { Scene } from "../../viewer/Scene";
import { overlay } from "../../viewer/support";
import { Inspector, Timeline, Tree } from "./Panels";
import "./editor.css";

export function EditorPage() {
  const { envId } = useParams();
  const loadedId = useStudio((s) => s.env?.id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!envId || loadedId === envId) return;
    let cancelled = false;
    setError(null);
    (async () => {
      const id = envId as EnvId;
      const [head, versions, photos] = await Promise.all([api.getHead(id), api.listVersions(id), api.photos(id)]);
      if (cancelled) return;
      if (!head.ok) return setError(copyFor(head.error).message);
      if (!versions.ok) return setError(copyFor(versions.error).message);
      useStudio.getState().open({
        environment: head.data.environment,
        version: head.data.version,
        versions: versions.data,
        confidence: head.data.confidence,
        photos: photos.ok ? photos.data : [],
      });
    })();
    return () => { cancelled = true; };
  }, [envId, loadedId]);

  if (error) {
    return (
      <div className="loading">
        <div className="empty">
          <Icon name="alert" size={28} />
          <b>{error}</b>
          <Link className="btn" to="/">Back to Create</Link>
        </div>
      </div>
    );
  }
  if (!envId || loadedId !== envId) return <div className="loading">Loading environment…</div>;
  return <Editor envId={envId} />;
}

function Editor({ envId }: { envId: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const pins = useRef<HTMLDivElement>(null);
  useKeyboard();
  useUnsavedGuard();
  return (
    <div className="editor">
      <TopBar envId={envId} />
      <Tree />
      <main className="stage" ref={frame} aria-label="3D environment">
        <Scene frame={frame} pins={pins} />
        <div className="vignette" />
        <div className="pins" ref={pins} aria-hidden="true" />
        <Hud />
        <Dock />
        <AddMenu />
        <PhotosPanel />
        <div className="tip" ref={(el) => overlay.bindTip(el)} />
      </main>
      <Inspector />
      <Timeline />
    </div>
  );
}

function TopBar({ envId }: { envId: string }) {
  const env = useStudio((s) => s.env);
  const spec = useStudio((s) => s.spec);
  const view = useStudio(useShallow(saveView));
  const baseVersion = useStudio((s) => s.baseVersion);
  const headVersion = useStudio((s) => s.headVersion);
  const saveStatus = useStudio((s) => s.saveStatus);
  const d = spec?.environment.dimensions;
  const statusText =
    view.kind === "blocked" ? `${view.errors} error${view.errors === 1 ? "" : "s"} block saving`
    : view.kind === "dirty" ? `Unsaved changes · from v${baseVersion}`
    : view.kind === "restore" ? `Viewing v${baseVersion}`
    : view.kind === "saving" ? "Saving…"
    : view.kind === "conflict" ? "Conflict"
    : view.kind === "failed" ? copyFor(view.error).title
    : `v${headVersion} · Saved`;
  const statusClass = view.kind === "blocked" || view.kind === "failed" || view.kind === "conflict" ? "bad" : view.kind === "dirty" ? "dirty" : view.kind === "restore" ? "old" : "";
  const canSave = view.kind === "dirty" || view.kind === "restore" || view.kind === "failed";
  return (
    <header className="topbar">
      <Brand title={spec?.environment.name ?? env?.name ?? "Environment"} meta={d ? `${d.width}×${d.length}×${d.height} m · ${spec!.terrain.type} · ${spec!.objects.length} obj` : undefined} />
      <div className="center"><Stepper active="edit" envId={envId} /></div>
      <div className="right">
        <div className={`status ${statusClass}`} aria-live="polite"><i />{statusText}</div>
        <button className={`btn ${canSave ? "primary" : ""}`} disabled={!canSave} onClick={() => useStudio.getState().save()} title="Save version (⌘S)">
          {view.kind === "saving" ? "Saving…" : view.label}
        </button>
        <Link className="btn" to={`/e/${envId}/blueprint`} title="Print the blueprint">
          <Icon name="print" /> Blueprint <Icon name="arrow" size={14} />
        </Link>
      </div>
      {saveStatus.kind === "conflict" ? (
        <div className="card conflict" role="alertdialog" aria-label="A newer version exists">
          <b>A newer version exists</b>
          <p>Someone saved this environment while you were editing.</p>
          <div className="actions">
            <button className="btn" onClick={() => useStudio.getState().resolveConflict("reload")}>Load latest</button>
            <button className="btn primary" onClick={() => useStudio.getState().resolveConflict("override")}>Save on top</button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function Hud() {
  const snap = useStudio((s) => s.snap);
  const view = useStudio((s) => s.view);
  const errors = useStudio((s) => s.analysis.errors.length);
  const warnings = useStudio((s) => s.analysis.warnings.length);
  const byId = useStudio((s) => s.analysis.byId);
  const photos = useStudio((s) => s.photos.length);
  const panel = useStudio((s) => s.panel);
  const spec = useStudio((s) => s.spec);
  const confidence = useStudio((s) => s.confidence);
  const reviewed = useStudio((s) => s.reviewed);
  const cursor = useRef(0);
  const toReview = useMemo(() => (confidence && spec ? spec.objects.filter((o) => (confidence[o.id] ?? 1) < LOW_CONFIDENCE && !reviewed.includes(o.id)).map((o) => o.id) : []), [confidence, spec, reviewed]);
  const isPhoto = spec?.provenance.source === "image";
  const problems = errors + warnings;
  const cycle = (ids: string[]) => {
    if (!ids.length) return;
    cursor.current = (cursor.current + 1) % ids.length;
    const st = useStudio.getState();
    st.select(ids[cursor.current]!);
    st.focusSelection();
  };
  return (
    <div className="hud" data-hud="top">
      <div className="hud-row">
      <div>
        <span className="pill mono" ref={(el) => overlay.bindCoords(el)}>X —   Z —</span>
        <button className={`pill ${snap ? "on" : ""}`} onClick={() => useStudio.getState().toggleSnap()} title="Snap to 0.5 m and 15°">
          <Icon name="magnet" /> Snap 0.5 m · 15°
        </button>
        {photos ? (
          <button className={`pill ${panel === "photos" ? "on" : ""}`} onClick={() => useStudio.getState().setPanel(panel === "photos" ? "none" : "photos")} title="Show the source photos (P)">
            <Icon name="image" /> Photos {photos}
          </button>
        ) : null}
      </div>
      <div>
        <button className={`pill ${view === "iso" ? "on" : ""}`} onClick={() => useStudio.getState().setView("iso")} title="Isometric view (I)">
          <Icon name="iso" /> Iso
        </button>
        <button className={`pill ${view === "top" ? "on" : ""}`} onClick={() => useStudio.getState().setView("top")} title="Top view (T)">
          <Icon name="top" /> Top
        </button>
        <button className={`pill ${errors ? "bad" : warnings ? "warn" : "ok"}`} disabled={!problems} onClick={() => cycle([...byId.keys()])} aria-live="polite">
          <Icon name={problems ? "alert" : "check"} />
          {problems ? [errors && `${errors} error${errors === 1 ? "" : "s"}`, warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`].filter(Boolean).join(" · ") : "No problems"}
        </button>
      </div>
      </div>
      {isPhoto && toReview.length ? (
        <div className="hud-row center">
          <span className="review-pill">
            <Icon name="camera" />
            <span>Built from photos · <b>{toReview.length} to review</b></span>
            <button className="btn" onClick={() => cycle(toReview)}>Review next</button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Dock() {
  const tool = useStudio((s) => s.tool);
  const selection = useStudio((s) => s.selection);
  const panel = useStudio((s) => s.panel);
  const canUndo = useStore(useStudio.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(useStudio.temporal, (t) => t.futureStates.length > 0);
  const st = useStudio.getState;
  return (
    <nav className="dock card" data-hud="dock" aria-label="Tools">
      <button className={tool === "translate" ? "on" : ""} onClick={() => st().setTool("translate")} title="Move (W)" aria-label="Move"><Icon name="move" /></button>
      <button className={tool === "rotate" ? "on" : ""} onClick={() => st().setTool("rotate")} title="Rotate (E)" aria-label="Rotate"><Icon name="rotate" /></button>
      <span className="sep" />
      <button className={panel === "add" ? "on" : ""} onClick={() => st().setPanel(panel === "add" ? "none" : "add")} title="Add object (A)" aria-label="Add object"><Icon name="plus" /></button>
      <button disabled={!selection} onClick={() => st().duplicateSelection()} title="Duplicate (⌘D)" aria-label="Duplicate"><Icon name="copy" /></button>
      <button disabled={!selection} onClick={() => st().deleteSelection()} title="Delete (⌫)" aria-label="Delete"><Icon name="trash" /></button>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => useStudio.temporal.getState().undo()} title="Undo (⌘Z)" aria-label="Undo"><Icon name="undo" /></button>
      <button disabled={!canRedo} onClick={() => useStudio.temporal.getState().redo()} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon name="redo" /></button>
    </nav>
  );
}

function AddMenu() {
  const open = useStudio((s) => s.panel === "add");
  const [q, setQ] = useState("");
  if (!open) return null;
  const assets = [...DEFAULT_ASSET_MAP.values()].filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()) || a.type.includes(q.toLowerCase()));
  const groups = CATEGORY_ORDER.map((c) => ({ c, items: assets.filter((a) => categoryOf(a.type) === c) })).filter((g) => g.items.length);
  const place = (type: string) => {
    const spec = useStudio.getState().spec;
    if (!spec) return;
    const { width, length } = spec.environment.dimensions;
    const fp = footprintOf(type);
    const free = (x: number, z: number) => !spec.objects.some((o) => Math.abs(o.position[0] - x) < 2 && Math.abs(o.position[2] - z) < 2);
    let spot: [number, number] = [0, 0];
    search: for (let r = 0; r < Math.max(width, length) / 2; r += 1.5) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r * 2) / 2;
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r * 2) / 2;
        if (Math.abs(x) + fp.width / 2 < width / 2 - 1 && Math.abs(z) + fp.depth / 2 < length / 2 - 1 && free(x, z)) { spot = [x, z]; break search; }
      }
    }
    useStudio.getState().addObject(type, spot[0], spot[1]);
  };
  return (
    <div className="card popover addmenu" role="menu" aria-label="Add object">
      <input className="input" autoFocus placeholder="Search the catalogue" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") useStudio.getState().setPanel("none"); }} />
      <div className="list">
        {groups.length ? groups.map((g) => (
          <div key={g.c}>
            <div className="group-label">{g.c}</div>
            {g.items.map((a) => (
              <button key={a.type} className="menu-item" role="menuitem" onClick={() => place(a.type)}>
                <i className="sw" style={{ background: colorOf(a.type) }} />
                {a.name}
                <small>{a.footprint[0]} × {a.footprint[1]} m</small>
              </button>
            ))}
          </div>
        )) : <div className="empty">No catalogue type matches “{q}”.</div>}
      </div>
    </div>
  );
}

function PhotosPanel() {
  const open = useStudio((s) => s.panel === "photos");
  const photos = useStudio((s) => s.photos);
  const [zoom, setZoom] = useState<number | null>(null);
  const blobs = useMemo(() => photos.map((p) => p.blob), [photos]);
  const urls = useObjectUrls(blobs);
  if (!open || !photos.length) return null;
  return (
    <>
      <div className="card popover photos-panel" aria-label="Source photos">
        <h4>Source photos <button className="btn ghost" onClick={() => useStudio.getState().setPanel("none")} aria-label="Close photos"><Icon name="x" size={14} /></button></h4>
        <div className="photo-grid">
          {urls.map((u, i) => (
            <button key={u} onClick={() => setZoom(i)} aria-label={`Open ${photos[i]!.name}`}><img src={u} alt={photos[i]!.name} /></button>
          ))}
        </div>
        <p className="muted" style={{ margin: "10px 2px 0", fontSize: 11.5 }}>Compare the scene with your photos while you fix positions.</p>
      </div>
      {zoom !== null ? (
        <div className="lightbox" onClick={() => setZoom(null)} role="dialog" aria-label="Photo">
          <img src={urls[zoom]} alt={photos[zoom]!.name} />
          <button className="btn" onClick={() => setZoom(null)}><Icon name="x" /> Close</button>
          <span className="caption">{photos[zoom]!.name} · {photos[zoom]!.width}×{photos[zoom]!.height}</span>
        </div>
      ) : null}
    </>
  );
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      const mod = e.metaKey || e.ctrlKey;
      const st = useStudio.getState();
      if (e.key === "Escape") { if (typing) (el as HTMLElement).blur(); else { st.setPanel("none"); st.select(null); } return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); st.save(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) useStudio.temporal.getState().redo(); else useStudio.temporal.getState().undo(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); st.duplicateSelection(); return; }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (k === "w") st.setTool("translate");
      else if (k === "e") st.setTool("rotate");
      else if (k === "a") st.setPanel(st.panel === "add" ? "none" : "add");
      else if (k === "f") { if (st.selection) st.focusSelection(); else st.setView("iso"); }
      else if (k === "t") st.setView("top");
      else if (k === "i") st.setView("iso");
      else if (k === "p" && st.photos.length) st.setPanel(st.panel === "photos" ? "none" : "photos");
      else if (e.key === "Delete" || e.key === "Backspace") st.deleteSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useUnsavedGuard() {
  const dirty = useStudio((s) => { const v = saveView(s).kind; return v === "dirty" || v === "blocked"; });
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);
}

