import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { copyFor } from "../../api/errors";
import type { Confidence, EnvId, EnvironmentDto, StoredPhoto, VersionDto, VersionMeta } from "../../api/types";
import { Icon, Stepper } from "../../components/ui";
import { useObjectUrls } from "../../components/useObjectUrls";
import { validateEnvironmentSpec } from "../../contract";
import { CATEGORY_HEX, CATEGORY_LABEL, CATEGORY_ORDER, COLORS, LOW_CONFIDENCE } from "../../design/tokens";
import { blueprintPatternDefs, buildPlanSvg, type PlanStyle } from "../../domain/planSvg";
import { buildSchedule, scheduleCsv } from "../../domain/schedule";
import { sameSpec, specHash } from "../../domain/specOps";
import { useStudio } from "../../store/studio";
import "./blueprint.css";

interface Loaded {
  environment: EnvironmentDto;
  version: VersionDto;
  versions: VersionMeta[];
  confidence: Confidence | null;
  photos: StoredPhoto[];
}

const DRAWING = { widthMm: 207, heightMm: 190 };

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BlueprintPage() {
  const { envId } = useParams();
  const [params, setParams] = useSearchParams();
  const requested = params.get("v");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const style: PlanStyle = params.get("style") === "colour" ? "colour" : "blueprint";
  const editorDirty = useStudio((s) => s.env?.id === envId && !sameSpec(s.spec, s.savedSpec));

  useEffect(() => {
    if (!envId) return;
    let cancelled = false;
    (async () => {
      const id = envId as EnvId;
      const [head, versions, photos] = await Promise.all([api.getHead(id), api.listVersions(id), api.photos(id)]);
      if (cancelled) return;
      if (!head.ok) return setError(copyFor(head.error).message);
      let version = head.data.version;
      if (requested && Number(requested) !== version.version) {
        const v = await api.getVersion(id, Number(requested));
        if (!v.ok) return setError(copyFor(v.error).message);
        version = v.data;
      }
      setData({ environment: head.data.environment, version, versions: versions.ok ? versions.data : [], confidence: head.data.confidence ?? useStudio.getState().confidence, photos: photos.ok ? photos.data : [] });
    })();
    return () => { cancelled = true; };
  }, [envId, requested]);

  useEffect(() => { if (data) void specHash(data.version.spec).then(setHash); }, [data]);

  const photoBlobs = useMemo(() => (data?.photos ?? []).slice(0, 6).map((p) => p.blob), [data]);
  const photoUrls = useObjectUrls(photoBlobs);

  if (error) return <div className="loading"><div className="empty"><Icon name="alert" size={28} /><b>{error}</b><Link className="btn" to="/">Back to Create</Link></div></div>;
  if (!data || !envId) return <div className="loading">Preparing the blueprint…</div>;

  const { environment, version, versions, confidence } = data;
  const spec = version.spec;
  const plan = buildPlanSvg(spec, { style, mode: "sheet", ...DRAWING, confidence });
  const schedule = buildSchedule(spec);
  const validation = validateEnvironmentSpec(spec);
  const d = spec.environment.dimensions;
  const drawingNo = `ENV-${envId.slice(-6).toUpperCase()}-V${version.version}`;
  const date = new Date(version.createdAt).toISOString().slice(0, 10);
  const lowCount = confidence ? spec.objects.filter((o) => (confidence[o.id] ?? 1) < LOW_CONFIDENCE).length : 0;
  const ink = style === "blueprint" ? COLORS.blueprintInk : COLORS.ink;
  const swatch = (c: (typeof CATEGORY_ORDER)[number]) =>
    style === "blueprint"
      ? `<svg viewBox="0 0 6 3.6"><rect x="0.2" y="0.2" width="5.6" height="3.2" fill="url(#bp-${c})" stroke="${ink}" stroke-width="0.25"/></svg>`
      : `<svg viewBox="0 0 6 3.6"><rect x="0.2" y="0.2" width="5.6" height="3.2" fill="${CATEGORY_HEX[c]}" stroke="${ink}" stroke-opacity="0.6" stroke-width="0.25"/></svg>`;
  const setStyle = (s: PlanStyle) => { const p = new URLSearchParams(params); if (s === "colour") p.set("style", "colour"); else p.delete("style"); setParams(p, { replace: true }); };
  const source = spec.provenance.source === "image" ? `Photos (${data.photos.length || "?"})` : spec.provenance.source === "text" ? "Text prompt" : spec.provenance.source;

  return (
    <div className="bp-page">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<defs>${blueprintPatternDefs(ink)}</defs>` }} />
      <div className="bp-toolbar">
        <Link className="btn" to={`/e/${envId}`}><Icon name="back" /> Back to editor</Link>
        <Stepper active="blueprint" envId={envId} />
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Drawing style">
          <button className={style === "blueprint" ? "on" : ""} onClick={() => setStyle("blueprint")}>Blueprint</button>
          <button className={style === "colour" ? "on" : ""} onClick={() => setStyle("colour")}>Colour</button>
        </div>
        <button className="btn" onClick={() => download(`${drawingNo}.svg`, "image/svg+xml", plan.svg)}><Icon name="download" /> SVG</button>
        <button className="btn" onClick={() => download(`${drawingNo}-schedule.csv`, "text/csv", scheduleCsv(schedule))}><Icon name="download" /> CSV</button>
        <button className="btn" onClick={() => download(`${drawingNo}.json`, "application/json", JSON.stringify(spec, null, 2))}><Icon name="download" /> JSON</button>
        <button className="btn primary" onClick={() => window.print()}><Icon name="print" /> Print or save PDF</button>
      </div>
      {editorDirty ? <div className="bp-note"><Icon name="alert" /> This prints saved version {version.version}. Save in the editor to include your latest changes.</div> : null}

      <section className={`sheet ${style}`} aria-label="Sheet 1, plan">
        <div className="frame">
          <div className="drawing" dangerouslySetInnerHTML={{ __html: plan.svg }} />
          <aside className="side-col">
            <div className="side-block">
              <h4>Legend</h4>
              {CATEGORY_ORDER.filter((c) => schedule.byCategory[c]).map((c) => (
                <div className="legend-row" key={c}>
                  <span dangerouslySetInnerHTML={{ __html: swatch(c) }} />
                  {CATEGORY_LABEL[c]}
                  <em>{schedule.byCategory[c]}</em>
                </div>
              ))}
              {lowCount ? <div className="legend-row"><span dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 6 3.6"><rect x="0.3" y="0.3" width="5.4" height="3" fill="none" stroke="${style === "blueprint" ? ink : COLORS.warn}" stroke-width="0.3" stroke-dasharray="0.9 0.6"/></svg>` }} />Estimated from photos<em>{lowCount}</em></div> : null}
              <div className="legend-row"><span dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 6 3.6"><path d="M0.3 1.8H5.7" stroke="${style === "blueprint" ? ink : COLORS.accent}" stroke-width="0.35" stroke-dasharray="1 0.6"/></svg>` }} />Robot test route</div>
            </div>
            <div className="side-block">
              <h4>Key facts</h4>
              <dl className="facts">
                <dt>Size</dt><dd>{d.width} × {d.length} × {d.height} m</dd>
                <dt>Floor area</dt><dd>{schedule.floorArea} m²</dd>
                <dt>Occupied</dt><dd>{schedule.totalArea} m² ({Math.round((schedule.totalArea / schedule.floorArea) * 1000) / 10}%)</dd>
                <dt>Objects</dt><dd>{schedule.totalCount}</dd>
                <dt>Terrain</dt><dd>{spec.terrain.type}, μ {spec.terrain.properties.friction}</dd>
                <dt>Waypoints</dt><dd>{spec.navigation?.waypoints.length ?? 0}</dd>
              </dl>
            </div>
            <div className="side-block">
              <h4>Revisions</h4>
              <table className="revs">
                <thead><tr><th>Rev</th><th>Date</th><th>Change</th></tr></thead>
                <tbody>
                  {versions.slice(-4).map((v) => (
                    <tr key={v.version} style={v.version === version.version ? { fontWeight: 700 } : undefined}><td>v{v.version}</td><td>{v.createdAt.slice(5, 10)}</td><td>{v.changeNote ?? ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="titleblock">
              <div className="wide"><small>Drawing title</small><b>{spec.environment.name}</b></div>
              <div><small>Project</small><b>Twin Studio</b></div>
              <div><small>Drawing no</small><b>{drawingNo}</b></div>
              <div><small>Scale</small><b>1:{plan.scaleDenominator} @ A4</b></div>
              <div><small>Date</small><b>{date}</b></div>
              <div><small>Source</small><b>{source}</b></div>
              <div><small>Validation</small><b className={validation.valid ? "valid-ok" : "valid-bad"}>{validation.valid ? "Passed" : `${validation.errors.length} errors`}</b></div>
              <div><small>Spec hash</small><b>{hash}</b></div>
              <div><small>Sheet</small><b>1 of 2</b></div>
            </div>
          </aside>
        </div>
      </section>

      <section className={`sheet ${style}`} aria-label="Sheet 2, schedule">
        <div className="sheet2">
          <div>
            <h3>Object schedule</h3>
            <table className="schedule">
              <thead><tr><th>Object</th><th>Category</th><th className="n">Count</th><th className="n">Footprint m</th><th className="n">Height m</th><th className="n">Area m²</th></tr></thead>
              <tbody>
                {schedule.rows.map((r) => (
                  <tr key={r.type}><td>{r.name}</td><td>{CATEGORY_LABEL[r.category]}</td><td className="n">{r.count}</td><td className="n">{r.footprint[0]} × {r.footprint[1]}</td><td className="n">{r.height}</td><td className="n">{r.area}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td /><td className="n">{schedule.totalCount}</td><td /><td /><td className="n">{schedule.totalArea}</td></tr></tfoot>
            </table>
          </div>
          <div>
            {photoUrls.length ? (
              <>
                <h4>Source photos</h4>
                <div className="src-photos">{photoUrls.map((u, i) => <img key={u} src={u} alt={data.photos[i]?.name ?? ""} />)}</div>
              </>
            ) : null}
            <h4>Provenance</h4>
            <dl className="facts">
              <dt>Source</dt><dd>{source}</dd>
              <dt>Model</dt><dd>{spec.provenance.model ?? "unknown"}</dd>
              <dt>Generated</dt><dd>{spec.provenance.generatedAt.slice(0, 10)}</dd>
              {spec.provenance.confidence ? <><dt>Confidence</dt><dd>{Math.round(spec.provenance.confidence * 100)}%</dd></> : null}
            </dl>
            {spec.provenance.prompt ? <p style={{ margin: "1.6mm 0 0", opacity: 0.8 }}>{spec.provenance.prompt}</p> : null}
            <h4>Waypoints</h4>
            <dl className="facts">{(spec.navigation?.waypoints ?? []).map((w) => <span key={w.id} style={{ display: "contents" }}><dt>{w.id}</dt><dd>{w.position[0]}, {w.position[2]}</dd></span>)}</dl>
            <h4>Validation</h4>
            <p style={{ margin: 0 }}>{validation.valid ? "No errors." : validation.errors.slice(0, 4).map((e) => `${e.code} ${e.path}`).join("; ")} {validation.warnings.length ? `${validation.warnings.length} warnings.` : "No warnings."}</p>
          </div>
        </div>
        <div className="foot"><span>{drawingNo} · {environment.name}</span><span>Units metres · Y up · origin at centre · spec {hash}</span><span>Sheet 2 of 2</span></div>
      </section>
    </div>
  );
}
