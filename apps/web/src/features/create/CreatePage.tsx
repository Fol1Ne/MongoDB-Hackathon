import { useCallback, useEffect, useReducer, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { copyFor } from "../../api/errors";
import { KNOWN_DIMENSIONS, PHASE_LABEL, PHASES, type Created, type EnvironmentDto, type KnownDimension, type Phase, type PreparedPhoto, type Result } from "../../api/types";
import { Brand, Icon, PlanThumb, Stepper } from "../../components/ui";
import { buildPlanSvg } from "../../domain/planSvg";
import { checkFile, PHOTO_LIMITS, preparePhoto } from "../../photo/prepare";
import { useStudio } from "../../store/studio";
import { createReducer, promptProblem, type Source } from "./createMachine";
import "./create.css";

type PhotoItem = PreparedPhoto & { url: string };

const EXAMPLES = [
  "A 50 by 80 metre warehouse with six shelf aisles and a loading dock",
  "Small parts factory with two conveyor lines and a charging bay",
  "Distribution centre with pallet racking along the north wall",
];
const PROMPT_PHASES: readonly Phase[] = ["drafting", "validating", "saving"];

export function CreatePage() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(createReducer, { kind: "idle" });
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [pending, setPending] = useState(0);
  const [rejects, setRejects] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [known, setKnown] = useState<KnownDimension | null>({ kind: "door_height", meters: 2.1 });
  const [prompt, setPrompt] = useState("");
  const [over, setOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addFiles = useCallback(async (files: File[]) => {
    const accepted: File[] = [];
    const reasons: string[] = [];
    for (const f of files) {
      const check = checkFile(f, photosRef.current.length + accepted.length);
      if (check.ok) accepted.push(f);
      else reasons.push(check.reason);
    }
    setRejects(reasons);
    if (!accepted.length) return;
    setPending((n) => n + accepted.length);
    dispatch({ type: "prepare", pending: accepted.length });
    for (const f of accepted) {
      try {
        const p = await preparePhoto(f);
        setPhotos((list) => [...list, { ...p, url: URL.createObjectURL(p.blob) }]);
      } catch (e) {
        setRejects((r) => [...r, `${f.name} could not be read. ${e instanceof Error ? e.message : ""}`.trim()]);
      } finally {
        setPending((n) => n - 1);
      }
    }
    dispatch({ type: "prepared" });
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); void addFiles(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  useEffect(() => {
    if (state.kind !== "running") return;
    const t = setInterval(() => setElapsed((performance.now() - state.startedAt) / 1000), 100);
    return () => clearInterval(t);
  }, [state]);

  const finish = (r: Result<Created>, source: Source) => {
    abort.current = null;
    if (!r.ok) return dispatch({ type: "fail", error: r.error });
    const { environment, version, confidence } = r.data;
    const { spec: _spec, ...meta } = version;
    useStudio.getState().open({ environment, version, versions: [meta], confidence, photos: source === "photos" ? photosRef.current.map(({ name, blob, width, height }) => ({ name, blob, width, height })) : [] });
    navigate(`/e/${environment.id}`);
  };

  const run = async (source: Source) => {
    if (state.kind === "running" || state.kind === "preparing") return;
    if (source === "photos" && !photos.length) return;
    if (source === "prompt" && (prompt.trim().length < 10 || promptProblem(prompt))) return;
    abort.current = new AbortController();
    setElapsed(0);
    dispatch({ type: "start", source, at: performance.now() });
    const opts = { signal: abort.current.signal, onPhase: (phase: Phase) => dispatch({ type: "phase", phase }) };
    const r = source === "photos" ? await api.fromImages({ photos, hint, knownDimension: known }, opts) : await api.generate({ prompt: prompt.trim() }, opts);
    finish(r, source);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void addFiles([...e.dataTransfer.files]);
  };
  const remove = (id: string) => setPhotos((list) => { const p = list.find((x) => x.id === id); if (p) URL.revokeObjectURL(p.url); return list.filter((x) => x.id !== id); });
  const problem = promptProblem(prompt);
  const savedKb = photos.reduce((s, p) => s + (p.originalBytes - p.bytes), 0) / 1024;

  return (
    <div className="create" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop}>
      <header className="topbar">
        <Brand title="Twin Studio" meta="photos to robot-ready 3D environments" />
        <Stepper active="create" />
        <span className="status"><i />{api.mode === "mock" ? "Offline demo data" : "Connected to API"}</span>
      </header>
      <div className="create-main">
        <section>
          <div className="hero">
            <h1>Turn photos of a space into a <em>robot-ready</em> 3D twin.</h1>
            <p>Drop a few photos of a warehouse, factory floor, or office. Twin Studio estimates the size and layout, places catalogue objects, and checks every placement for collisions before you edit it.</p>
          </div>
          <div className="card creator">
            <input ref={fileInput} type="file" accept={PHOTO_LIMITS.types.join(",")} multiple hidden onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <div
              className={`drop ${over ? "over" : ""} ${photos.length || pending ? "compact" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); } }}
              aria-label="Add photos"
            >
              {photos.length || pending ? (
                <span className="btn ghost"><Icon name="plus" /> Add more photos <span className="muted">({photos.length + pending} of {PHOTO_LIMITS.maxFiles})</span></span>
              ) : (
                <div>
                  <div className="big"><Icon name="camera" size={30} /></div>
                  <h2>Drop photos of your space</h2>
                  <p>or click to choose. JPEG, PNG, or WebP, up to {PHOTO_LIMITS.maxFiles}.</p>
                  <div className="hints"><span className="pill">Paste works too <kbd>⌘V</kbd></span><span className="pill">Shoot from corners, include a door</span></div>
                </div>
              )}
            </div>
            {rejects.length ? <ul className="rejects">{rejects.map((r) => <li key={r}>{r}</li>)}</ul> : null}
            {photos.length || pending ? (
              <>
                <div className="tray">
                  {photos.map((p) => (
                    <figure key={p.id}>
                      <img src={p.url} alt={p.name} />
                      <figcaption>{p.name} · {p.width}×{p.height}</figcaption>
                      <button className="remove" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}><Icon name="x" size={13} /></button>
                    </figure>
                  ))}
                  {Array.from({ length: pending }, (_, i) => <figure key={`p${i}`} className="pending"><i /></figure>)}
                </div>
                <div className="options">
                  <label className="field">
                    Notes for the model (optional)
                    <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. loading dock on the south wall, six aisles" maxLength={300} />
                  </label>
                  <div className="scale-row">
                    <label className="field">
                      Known size, for scale
                      <select value={known?.kind ?? "none"} onChange={(e) => setKnown(e.target.value === "none" ? null : { kind: e.target.value as KnownDimension["kind"], meters: known?.meters ?? 2.1 })}>
                        <option value="none">None</option>
                        {Object.entries(KNOWN_DIMENSIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                    </label>
                    {known ? (
                      <label className="field" style={{ maxWidth: 96 }}>
                        Metres
                        <input type="number" min={0.5} max={200} step={0.1} value={known.meters} onChange={(e) => setKnown({ ...known, meters: Number(e.target.value) })} />
                      </label>
                    ) : null}
                  </div>
                </div>
                <div className="build-row">
                  <span className="privacy"><Icon name="check" /> Location data is stripped in your browser.{savedKb > 200 ? ` ${(savedKb / 1024).toFixed(1)} MB lighter to upload.` : ""}</span>
                  <button className="btn primary lg" disabled={!photos.length || pending > 0} onClick={() => run("photos")}>
                    <Icon name="spark" /> Build from {photos.length} photo{photos.length === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            ) : null}
            <div className="or">or describe it</div>
            <form className="prompt-row" onSubmit={(e) => { e.preventDefault(); void run("prompt"); }}>
              <span className="spark"><Icon name="spark" /></span>
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A 30 by 40 metre warehouse with three aisles…" maxLength={600} aria-label="Describe the environment" />
              <button className="btn primary" type="submit" disabled={prompt.trim().length < 10 || Boolean(problem)}>Generate</button>
            </form>
            {problem ? <div className="prompt-hint">{problem}</div> : null}
            <div className="examples">{EXAMPLES.map((t) => <button key={t} type="button" onClick={() => setPrompt(t)}>{t}</button>)}</div>
            {state.kind === "failed" ? <FailBanner state={state} onRetry={() => { dispatch({ type: "reset" }); void run(state.source); }} onClose={() => dispatch({ type: "reset" })} /> : null}
          </div>
        </section>
        <aside className="side">
          <Recent />
          <div className="card how">
            <div className="card-title" style={{ padding: 0 }}>How the demo flows</div>
            <ol>
              <li><i>1</i><div><b>Create</b>Photos or a sentence become a validated environment, saved as version 1.</div></li>
              <li><i>2</i><div><b>Edit</b>Move, rotate, add, and delete objects. Collisions and bounds are checked live.</div></li>
              <li><i>3</i><div><b>Blueprint</b>Print a scaled drawing with an object schedule, or save it as a PDF.</div></li>
            </ol>
          </div>
        </aside>
      </div>
      {state.kind === "running" ? <GenerationOverlay source={state.source} phase={state.phase} done={state.done} elapsed={elapsed} photos={photos} prompt={prompt} onCancel={() => abort.current?.abort()} /> : null}
    </div>
  );
}

function FailBanner({ state, onRetry, onClose }: { state: { error: Parameters<typeof copyFor>[0] }; onRetry: () => void; onClose: () => void }) {
  const c = copyFor(state.error);
  const details = state.error.kind === "http" ? state.error.details : [];
  return (
    <div className="banner" role="alert">
      <Icon name="alert" size={20} />
      <div style={{ flex: 1 }}>
        <b>{c.title}</b>
        <p>{c.message}</p>
        {details.length ? <ul>{details.slice(0, 5).map((d, i) => <li key={i}>{d.path}: {d.message}</li>)}</ul> : null}
      </div>
      {c.retry ? <button className="btn" onClick={onRetry}>Try again</button> : null}
      <button className="btn ghost" onClick={onClose} aria-label="Dismiss"><Icon name="x" /></button>
    </div>
  );
}

function GenerationOverlay({ source, phase, done, elapsed, photos, prompt, onCancel }: { source: Source; phase: Phase | null; done: readonly Phase[]; elapsed: number; photos: PhotoItem[]; prompt: string; onCancel: () => void }) {
  const steps = source === "photos" ? PHASES : PROMPT_PHASES;
  const progress = (done.length + (phase ? 0.5 : 0)) / steps.length;
  return (
    <div className="gen-overlay" role="dialog" aria-label="Building environment" aria-live="polite">
      <div className="card gen-card">
        <h2>Building your environment <span>{elapsed.toFixed(1)}s</span></h2>
        {source === "photos" ? (
          <div className="gen-photos">{photos.map((p) => <figure key={p.id}><img src={p.url} alt="" /></figure>)}</div>
        ) : (
          <div className="gen-prompt">“{prompt.trim()}”</div>
        )}
        <ol className="phases">
          {steps.map((s) => <li key={s} className={done.includes(s) ? "done" : s === phase ? "act" : ""}><i />{PHASE_LABEL[s]}</li>)}
        </ol>
        <div className="bar"><b style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <div className="gen-foot">
          <span>{api.mode === "mock" ? "Local preview generator" : "Server generation"}</span>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Recent() {
  const [items, setItems] = useState<{ env: EnvironmentDto; svg: string; objects: number; photo: boolean }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await api.listEnvironments();
      if (!list.ok || cancelled) return setItems([]);
      const heads = await Promise.all(list.data.slice(0, 6).map((e) => api.getHead(e.id)));
      if (cancelled) return;
      setItems(heads.flatMap((h) => (h.ok ? [{
        env: h.data.environment,
        svg: buildPlanSvg(h.data.version.spec, { mode: "thumbnail", widthMm: 112, heightMm: 78, confidence: h.data.confidence }).svg,
        objects: h.data.version.spec.objects.length,
        photo: h.data.version.spec.provenance.source === "image",
      }] : [])));
    })();
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="card recent">
      <h3>Recent environments <em>{items ? items.length : ""}</em></h3>
      <div className="recent-list">
        {items === null ? <div className="empty">Loading…</div> : items.length === 0 ? <div className="empty">Nothing yet. Your first environment will appear here.</div> : items.map((it) => (
          <Link key={it.env.id} className="env-card" to={`/e/${it.env.id}`}>
            <PlanThumb svg={it.svg} label={`Plan of ${it.env.name}`} />
            <div>
              <b>{it.env.name}</b>
              <span><span className={`badge ${it.photo ? "photo" : ""}`}>{it.photo ? "Photos" : it.env.tags.includes("demo") ? "Demo" : "Prompt"}</span>{it.objects} objects · v{it.env.versionCount}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
