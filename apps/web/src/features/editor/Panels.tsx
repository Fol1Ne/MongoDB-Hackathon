import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../api/client";
import type { VersionMeta } from "../../api/types";
import { Icon } from "../../components/ui";
import { useObjectUrls } from "../../components/useObjectUrls";
import { CATEGORY_ORDER, LOW_CONFIDENCE } from "../../design/tokens";
import { categoryOf, colorOf, footprintOf, labelOf } from "../../domain/categories";
import { diffSpecs, type SpecDiff } from "../../domain/specOps";
import type { EnvironmentSpec } from "../../contract";
import type { CommandArgs } from "../../store/commands";
import { saveView, useStudio } from "../../store/studio";

const NO_OBJECTS: EnvironmentSpec["objects"] = [];

export function Tree() {
  const objects = useStudio((s) => s.spec?.objects ?? NO_OBJECTS);
  const selection = useStudio((s) => s.selection);
  const hidden = useStudio((s) => s.hidden);
  const query = useStudio((s) => s.query);
  const confidence = useStudio((s) => s.confidence);
  const reviewed = useStudio((s) => s.reviewed);
  const reviewOnly = useStudio((s) => s.reviewOnly);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const body = useRef<HTMLDivElement>(null);
  const isLow = (id: string) => Boolean(confidence && (confidence[id] ?? 1) < LOW_CONFIDENCE && !reviewed.includes(id));
  const lowCount = objects.filter((o) => isLow(o.id)).length;
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const byType = new Map<string, string[]>();
    for (const o of objects) {
      if (q && !o.id.toLowerCase().includes(q) && !labelOf(o.type).toLowerCase().includes(q)) continue;
      if (reviewOnly && !isLow(o.id)) continue;
      byType.set(o.type, [...(byType.get(o.type) ?? []), o.id]);
    }
    return [...byType].sort((a, b) => CATEGORY_ORDER.indexOf(categoryOf(a[0])) - CATEGORY_ORDER.indexOf(categoryOf(b[0])) || labelOf(a[0]).localeCompare(labelOf(b[0])));
  }, [objects, q, reviewOnly, confidence, reviewed]);
  const shown = groups.reduce((n, [, ids]) => n + ids.length, 0);
  const selectedType = objects.find((o) => o.id === selection)?.type;

  useEffect(() => { body.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" }); }, [selection]);

  const st = useStudio.getState;
  const toggle = (t: string, isOpen: boolean) => setOpen((prev) => { const n = new Set(prev); if (isOpen) n.add(t); else n.delete(t); return n; });
  return (
    <section className="card tree" aria-label="Scene">
      <h3>Scene <em>{q || reviewOnly ? `${shown} of ${objects.length}` : objects.length}</em></h3>
      <label className="search">
        <Icon name="search" />
        <input placeholder="Filter objects" value={query} onChange={(e) => st().setQuery(e.target.value)} spellCheck={false} />
      </label>
      {confidence ? (
        <div className="filters">
          <button className={`pill ${!reviewOnly ? "on" : ""}`} onClick={() => st().setReviewOnly(false)}>All</button>
          <button className={`pill ${reviewOnly ? "on" : ""} ${lowCount ? "warn" : ""}`} onClick={() => st().setReviewOnly(true)}>
            <Icon name="review" /> Needs review {lowCount}
          </button>
        </div>
      ) : null}
      {hidden.length ? (
        <div className="hiddenbar"><span>{hidden.length} layer{hidden.length === 1 ? "" : "s"} hidden</span><button onClick={() => st().showAll()}>Show all</button></div>
      ) : null}
      <div className="panel-body" ref={body}>
        {groups.length ? groups.map(([type, ids]) => {
          const isHidden = hidden.includes(type);
          const expanded = Boolean(q) || reviewOnly || open.has(type) || type === selectedType;
          return (
            <details key={type} className={isHidden ? "hid" : ""} open={expanded} onToggle={(e) => toggle(type, (e.target as HTMLDetailsElement).open)}>
              <summary>
                <i className="sw" style={{ background: colorOf(type) }} />
                <span className="lab">{labelOf(type)}</span>
                <em>{ids.length}</em>
                <button
                  className={`eye ${isHidden ? "off" : ""}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); st().toggleHidden(type); }}
                  aria-label={`${isHidden ? "Show" : "Hide"} ${labelOf(type)}`}
                  title={`${isHidden ? "Show" : "Hide"} layer`}
                >
                  <Icon name={isHidden ? "eyeoff" : "eye"} />
                </button>
              </summary>
              {expanded ? (
                <ul>
                  {ids.map((id) => (
                    <li key={id} className={id === selection ? "on" : ""} onClick={() => st().select(id)} onDoubleClick={() => { st().select(id); st().focusSelection(); }}>
                      {id}
                      {isLow(id) ? <span className="lowdot" title="Estimated from photos" /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          );
        }) : <div className="empty">{reviewOnly ? "Everything from the photos has been reviewed." : `No objects match “${query}”.`}</div>}
      </div>
    </section>
  );
}

function NumberField({ label, value, step, onCommit }: { label: string; value: number; step: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(step >= 1 ? value.toFixed(0) : value.toFixed(2)), [value, step]);
  const commit = () => { const v = Number(text); if (Number.isFinite(v) && Math.abs(v - value) > 1e-6) onCommit(v); else setText(step >= 1 ? value.toFixed(0) : value.toFixed(2)); };
  return (
    <label className="field">
      {label}
      <input type="number" step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

export function Inspector() {
  const selection = useStudio((s) => s.selection);
  const o = useStudio((s) => s.spec?.objects.find((x) => x.id === s.selection));
  return (
    <section className="card inspector" aria-label="Inspector">
      <h3>{o ? "Inspector" : "Environment"}</h3>
      <div className="panel-body">{o && selection ? <ObjectInspector id={selection} /> : <EnvironmentForm />}</div>
    </section>
  );
}

function ObjectInspector({ id }: { id: string }) {
  const o = useStudio((s) => s.spec!.objects.find((x) => x.id === id)!);
  const issues = useStudio((s) => s.analysis.byId.get(id));
  const confidence = useStudio((s) => s.confidence?.[id]);
  const reviewed = useStudio((s) => s.reviewed.includes(id));
  const fp = footprintOf(o.type);
  const st = useStudio.getState;
  const yawDeg = ((o.rotation[1] * 180) / Math.PI + 360) % 360;
  const all = [...(issues?.errors ?? []).map((i) => ({ ...i, kind: "err" })), ...(issues?.warnings ?? []).map((i) => ({ ...i, kind: "wrn" }))];
  return (
    <>
      <div className="obj-head">
        <i className="sw" style={{ background: colorOf(o.type) }} />
        <div><b>{labelOf(o.type)}</b><span>{o.id} · {categoryOf(o.type)}</span></div>
      </div>
      {confidence !== undefined && confidence < LOW_CONFIDENCE && !reviewed ? (
        <div className="conf">
          <span>Estimated from photos</span>
          <span className="meter"><i style={{ width: `${Math.round(confidence * 100)}%` }} /></span>
          <b className="mono">{Math.round(confidence * 100)}%</b>
        </div>
      ) : null}
      <div className="grid3">
        <NumberField label="X (m)" value={o.position[0]} step={0.5} onCommit={(x) => st().commit("transform", { id, x, z: o.position[2], yaw: o.rotation[1] })} />
        <NumberField label="Z (m)" value={o.position[2]} step={0.5} onCommit={(z) => st().commit("transform", { id, x: o.position[0], z, yaw: o.rotation[1] })} />
        <NumberField label="Yaw °" value={yawDeg} step={15} onCommit={(d) => st().commit("transform", { id, x: o.position[0], z: o.position[2], yaw: (d * Math.PI) / 180 })} />
      </div>
      <div className="sect">Scale</div>
      <div className="grid3">
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <NumberField key={axis} label={axis} value={o.scale[i]!} step={0.1} onCommit={(v) => st().commit("setScale", { id, axis: i as 0 | 1 | 2, value: v })} />
        ))}
      </div>
      <div className="kv">
        <div>Footprint<b>{(fp.width * o.scale[0]).toFixed(1)} × {(fp.depth * o.scale[2]).toFixed(1)} m</b></div>
        <div>Height<b>{(fp.height * o.scale[1]).toFixed(1)} m</b></div>
        <div>Base y<b>{o.position[1].toFixed(2)} m</b></div>
        <div>Physics<b>{o.physics?.static === false ? `dynamic · ${o.physics.mass} kg` : "static"}</b></div>
      </div>
      {all.length ? (
        <ul className="issues">{all.map((i, n) => <li key={n} className={i.kind}><code>{i.code}</code>{i.message}</li>)}</ul>
      ) : (
        <div className="ok-note"><Icon name="check" /> Within bounds, no overlaps</div>
      )}
      <div className="actions">
        {confidence !== undefined && confidence < LOW_CONFIDENCE && !reviewed ? (
          <button className="btn" onClick={() => st().markReviewed(id)}><Icon name="review" />Looks right</button>
        ) : (
          <button className="btn" onClick={() => st().duplicateSelection()}><Icon name="copy" />Duplicate</button>
        )}
        <button className="btn danger" onClick={() => st().deleteSelection()}><Icon name="trash" />Delete</button>
      </div>
    </>
  );
}

const ENV_TYPES = ["warehouse", "factory", "office", "outdoor", "custom"] as const;
const TERRAINS = ["concrete", "asphalt", "grass", "gravel", "tile", "dirt", "custom"] as const;

function EnvironmentForm() {
  const spec = useStudio((s) => s.spec!);
  const photos = useStudio((s) => s.photos);
  const confidence = useStudio((s) => s.confidence);
  const blobs = useMemo(() => photos.slice(0, 4).map((p) => p.blob), [photos]);
  const urls = useObjectUrls(blobs);
  const st = useStudio.getState;
  const { environment: e, terrain: t, provenance: p } = spec;
  const set = (patch: CommandArgs<"setEnvironment">) => st().commit("setEnvironment", patch);
  return (
    <>
      <div className="source">
        {photos.length ? <span className="thumbs">{urls.map((u) => <img key={u} src={u} alt="" />)}</span> : <Icon name={p.source === "image" ? "camera" : "spark"} size={20} />}
        <div>
          <b>{p.source === "image" ? `Built from ${photos.length || "your"} photo${photos.length === 1 ? "" : "s"}` : p.source === "text" ? "Generated from a prompt" : "Imported"}</b>
          <div className="muted" style={{ fontSize: 11.5 }}>{p.source === "image" && p.confidence ? `Overall confidence ${Math.round(p.confidence * 100)}% · ` : ""}{p.model ?? "unknown model"}</div>
        </div>
      </div>
      <label className="field" style={{ marginBottom: 12 }}>
        Name
        <input defaultValue={e.name} key={e.name} onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== e.name) set({ name: v }); }} />
      </label>
      <div className="grid3">
        <NumberField label="Width" value={e.dimensions.width} step={1} onCommit={(width) => width > 0 && set({ width })} />
        <NumberField label="Length" value={e.dimensions.length} step={1} onCommit={(length) => length > 0 && set({ length })} />
        <NumberField label="Height" value={e.dimensions.height} step={1} onCommit={(height) => height > 0 && set({ height })} />
      </div>
      <div className="grid2">
        <label className="field">
          Type
          <select value={e.type} onChange={(ev) => set({ type: ev.target.value as (typeof ENV_TYPES)[number] })}>
            {ENV_TYPES.map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          Terrain
          <select value={t.type} onChange={(ev) => set({ terrain: ev.target.value as (typeof TERRAINS)[number] })}>
            {TERRAINS.map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="grid2">
        <NumberField label="Friction" value={t.properties.friction} step={0.05} onCommit={(friction) => set({ friction: Math.min(2, Math.max(0, friction)) })} />
        <NumberField label="Restitution" value={t.properties.restitution ?? 0} step={0.05} onCommit={(restitution) => set({ restitution: Math.min(1, Math.max(0, restitution)) })} />
      </div>
      <div className="kv">
        <div>Objects<b>{spec.objects.length}</b></div>
        <div>Waypoints<b>{spec.navigation?.waypoints.length ?? 0}</b></div>
        <div>Lighting<b>{spec.lighting?.preset ?? "default"}</b></div>
        {confidence ? <div>Estimated objects<b>{Object.values(confidence).filter((c) => c < LOW_CONFIDENCE).length}</b></div> : null}
      </div>
      <div className="empty" style={{ padding: "8px 4px 0" }}>
        <Icon name="cube" size={22} />
        <div>Click an object to edit it, or press <kbd>A</kbd> to add one.</div>
      </div>
    </>
  );
}

function useVersionSpecs(envId: string | undefined, versions: VersionMeta[]) {
  const [specs, setSpecs] = useState<ReadonlyMap<number, EnvironmentSpec>>(new Map());
  useEffect(() => {
    if (!envId) return;
    let cancelled = false;
    const wanted = versions.slice(-12).map((v) => v.version).filter((n) => !specs.has(n));
    const prev = wanted.map((n) => n - 1).filter((n) => n >= 1 && !specs.has(n) && !wanted.includes(n));
    const all = [...prev, ...wanted];
    if (!all.length) return;
    Promise.all(all.map((n) => api.getVersion(envId as never, n))).then((rs) => {
      if (cancelled) return;
      setSpecs((m) => { const next = new Map(m); rs.forEach((r) => { if (r.ok) next.set(r.data.version, r.data.spec); }); return next; });
    });
    return () => { cancelled = true; };
  }, [envId, versions]);
  return specs;
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export function Timeline() {
  const env = useStudio((s) => s.env);
  const versions = useStudio((s) => s.versions);
  const baseVersion = useStudio((s) => s.baseVersion);
  const headVersion = useStudio((s) => s.headVersion);
  const dirty = useStudio((s) => saveView(s).kind === "dirty" || saveView(s).kind === "blocked");
  const specs = useVersionSpecs(env?.id, versions);
  const [confirm, setConfirm] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { if (list.current) list.current.scrollLeft = list.current.scrollWidth; }, [versions.length]);
  const diffs = useMemo(() => {
    const m = new Map<number, SpecDiff>();
    for (const v of versions) {
      const a = specs.get(v.version - 1);
      const b = specs.get(v.version);
      if (a && b) m.set(v.version, diffSpecs(a, b));
    }
    return m;
  }, [specs, versions]);
  const open = async (n: number) => {
    if (n === baseVersion && !dirty) return;
    if (dirty && confirm !== n) return setConfirm(n);
    setConfirm(null);
    await useStudio.getState().openVersion(n);
  };
  return (
    <section className="card history" aria-label="Versions" style={{ position: "relative" }}>
      <h3>Versions <em>{versions.length}</em></h3>
      {confirm !== null ? (
        <div className="confirm" role="alertdialog">
          Discard unsaved changes and open v{confirm}?
          <button className="btn" onClick={() => setConfirm(null)}>Keep editing</button>
          <button className="btn primary" onClick={() => open(confirm)}>Open v{confirm}</button>
        </div>
      ) : null}
      <ol className="timeline" ref={list}>
        {versions.map((v) => {
          const d = diffs.get(v.version);
          return (
            <li key={v.version}>
              <button className={`ver ${v.version === baseVersion ? "on" : ""}`} onClick={() => open(v.version)} aria-current={v.version === baseVersion}>
                <i className="dot" />
                <span className="vt">
                  <b>v{v.version}</b>
                  {v.version === headVersion ? <span className="tag">Head</span> : null}
                  {v.revertedFromVersion ? <span className="tag" style={{ background: "var(--panel-2)", color: "var(--muted)" }}>from v{v.revertedFromVersion}</span> : null}
                  <small>{ago(v.createdAt)}</small>
                </span>
                <span className="note">{v.changeNote ?? "No note"}</span>
                {d && (d.added.length || d.moved.length || d.removed.length) ? (
                  <span className="df">
                    {d.added.length ? <s className="add">+{d.added.length}</s> : null}
                    {d.moved.length ? <s className="mv">~{d.moved.length}</s> : null}
                    {d.removed.length ? <s className="rm">−{d.removed.length}</s> : null}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
