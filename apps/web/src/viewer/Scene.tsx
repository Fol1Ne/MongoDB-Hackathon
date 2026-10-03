import { Line, OrbitControls, TransformControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { computeBox, DEFAULT_ASSET_MAP, type EnvironmentObject, type EnvironmentSpec } from "../contract";
import { analyze } from "../domain/analysis";
import { colorOf, footprintOf, labelOf } from "../domain/categories";
import { COLORS, LOW_CONFIDENCE, MOTION } from "../design/tokens";
import { useStudio } from "../store/studio";
import { bodyGeometry, clamp, easeInOut, easeOutBack, fitDistance, objectGroups, overlay, yawOf, type FreeRegion } from "./support";

const FOV = 24;
const ISO_DIR = new THREE.Vector3(-0.62, 0.62, 0.62).normalize();
const TOP_DIR = new THREE.Vector3(0, 1, 0.02).normalize();
const WHITE = new THREE.Color(1, 1, 1);
const RED = new THREE.Color(COLORS.bad);
const AMBER = new THREE.Color(COLORS.warn);
const now = () => performance.now() / 1000;

export function Scene({ frame, pins }: { frame: RefObject<HTMLDivElement | null>; pins: RefObject<HTMLDivElement | null> }) {
  const hasSpec = useStudio((s) => s.spec !== null);
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: FOV, near: 1, far: 1500, position: [-80, 80, 80] }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}
      onPointerMissed={(e) => { if (e.button === 0) useStudio.getState().select(null); }}
    >
      <color attach="background" args={[COLORS.stage]} />
      <Lights />
      {hasSpec ? (
        <>
          <Floor />
          <Objects />
          <SelectionRing />
          <ConfidenceRings />
          <Gizmo />
          <ScreenPins host={pins} />
        </>
      ) : null}
      <CameraRig frame={frame} />
    </Canvas>
  );
}

function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    const s = sun.current;
    if (!s) return;
    const c = s.shadow.camera;
    c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 10; c.far = 260;
    c.updateProjectionMatrix();
  }, []);
  return (
    <>
      <hemisphereLight args={[COLORS.lightSky, COLORS.lightGround, 0.9]} />
      <directionalLight ref={sun} position={[-55, 80, 40]} intensity={2.4} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0003} shadow-normalBias={0.05} shadow-radius={4} />
      <directionalLight position={[60, 40, -50]} intensity={0.55} color={COLORS.lightFill} />
    </>
  );
}

const FLOOR_VS = "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }";
const FLOOR_FS = `varying vec3 vW;
uniform vec3 uIn, uOut, uMinor, uMajor;
uniform vec2 uHalf, uFade;
float grid(vec2 p, float s){ vec2 q = p / s; vec2 d = fwidth(q); vec2 g = abs(fract(q - .5) - .5) / max(d, vec2(1e-4)); float l = 1. - min(min(g.x, g.y), 1.); return l * (1. - smoothstep(.25, .6, max(d.x, d.y))); }
void main(){
  vec2 a = abs(vW.xz) - uHalf;
  float outside = step(0., max(a.x, a.y));
  float lines = mix(1., .3, outside);
  vec3 c = mix(uIn, uOut, outside);
  c = mix(c, uMinor, grid(vW.xz, 1.) * .6 * lines);
  c = mix(c, uMajor, grid(vW.xz, 10.) * .95 * lines);
  gl_FragColor = vec4(c, 1. - smoothstep(uFade.x, uFade.y, length(vW.xz)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function Floor() {
  const dims = useStudio((s) => s.spec!.environment.dimensions);
  const waypoints = useStudio((s) => s.spec!.navigation?.waypoints);
  const { width: W, length: L } = dims;
  const reach = Math.hypot(W, L);
  const fadeStart = Math.max(120, reach * 1.25);
  const fadeEnd = Math.max(330, reach * 3.5);
  const uniforms = useMemo(
    () => ({
      uIn: { value: new THREE.Color(COLORS.floor) },
      uOut: { value: new THREE.Color(COLORS.floorOutside) },
      uMinor: { value: new THREE.Color(COLORS.gridMinor) },
      uMajor: { value: new THREE.Color(COLORS.gridMajor) },
      uHalf: { value: new THREE.Vector2() },
      uFade: { value: new THREE.Vector2() },
    }),
    [],
  );
  useLayoutEffect(() => {
    uniforms.uHalf.value.set(W / 2, L / 2);
    uniforms.uFade.value.set(fadeStart, fadeEnd);
  }, [uniforms, W, L, fadeStart, fadeEnd]);
  const border = useMemo(() => new THREE.BufferGeometry().setFromPoints([[-W / 2, -L / 2], [W / 2, -L / 2], [W / 2, L / 2], [-W / 2, L / 2]].map(([x, z]) => new THREE.Vector3(x, 0, z))), [W, L]);
  const onMove = (e: ThreeEvent<PointerEvent>) => overlay.setCoords(e.point.x, e.point.z);
  const onClick = (e: ThreeEvent<MouseEvent>) => { if (e.delta < 4) useStudio.getState().select(null); };
  const points = useMemo(() => (waypoints ?? []).map((w) => new THREE.Vector3(w.position[0], 0.05, w.position[2])), [waypoints]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} renderOrder={-10} onPointerMove={onMove} onPointerLeave={() => overlay.setCoords(null, null)} onClick={onClick}>
        <planeGeometry args={[fadeEnd * 2, fadeEnd * 2]} />
        <shaderMaterial transparent vertexShader={FLOOR_VS} fragmentShader={FLOOR_FS} uniforms={uniforms} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004} receiveShadow raycast={() => null}>
        <planeGeometry args={[W, L]} />
        <shadowMaterial opacity={0.24} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <lineLoop geometry={border} position-y={0.02} raycast={() => null}>
        <lineBasicMaterial color={COLORS.border} />
      </lineLoop>
      {points.length > 1 ? <Line points={points} color={COLORS.route} lineWidth={1.4} dashed dashSize={0.7} gapSize={0.5} raycast={() => null} /> : null}
      {points.map((p, i) => (
        <mesh key={i} position={p} raycast={() => null}>
          <cylinderGeometry args={[0.7, 0.7, 0.08, 28]} />
          <meshBasicMaterial color={COLORS.route} />
        </mesh>
      ))}
    </group>
  );
}

function Objects() {
  const objects = useStudio((s) => s.spec!.objects);
  const loadNonce = useStudio((s) => s.loadNonce);
  const delays = useMemo(() => {
    const s = useStudio.getState().spec!;
    const { width, length } = s.environment.dimensions;
    const diag = Math.hypot(width, length);
    return new Map(s.objects.map((o) => [o.id, (Math.hypot(o.position[0], o.position[2]) / diag) * MOTION.buildSpread]));
  }, [loadNonce]);
  return (
    <>
      {objects.map((o) => (
        <ObjectMesh key={o.id} o={o} delay={delays.get(o.id) ?? 0} />
      ))}
    </>
  );
}

const ObjectMesh = memo(function ObjectMesh({ o, delay }: { o: EnvironmentObject; delay: number }) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const geometry = useMemo(() => bodyGeometry(o.type, o.scale), [o.type, o.scale]);
  const base = useMemo(() => new THREE.Color(colorOf(o.type)), [o.type]);
  const target = useMemo(
    () => ({ p: new THREE.Vector3(...o.position), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0], o.rotation[1], o.rotation[2], "YXZ")) }),
    [o.position, o.rotation],
  );
  const born = useRef(now() + delay);
  const k = useRef({ hover: 0, sel: 0, err: 0, wrn: 0 });

  useLayoutEffect(() => {
    const g = group.current!;
    g.position.copy(target.p);
    g.quaternion.copy(target.q);
    objectGroups.set(o.id, g);
    return () => { if (objectGroups.get(o.id) === g) objectGroups.delete(o.id); };
  }, [o.id]);

  useFrame((_, dt) => {
    const g = group.current;
    const m = material.current;
    const box = inner.current;
    if (!g || !m || !box) return;
    const s = useStudio.getState();
    const glide = 1 - Math.exp(-MOTION.glideRate * dt);
    if (s.dragging !== o.id) {
      g.position.lerp(target.p, glide);
      g.quaternion.slerp(target.q, glide);
    }
    const u = clamp((now() - born.current) / MOTION.buildDuration, 0, 1);
    const grow = u <= 0 ? 0 : easeOutBack(u);
    box.visible = grow > 0.002;
    box.scale.set(1, Math.max(grow, 0.001), 1);
    g.visible = !s.hidden.includes(o.type);
    const issues = s.analysis.byId.get(o.id);
    const t = 1 - Math.exp(-MOTION.tintRate * dt);
    const kk = k.current;
    kk.hover += ((s.hover === o.id ? 1 : 0) - kk.hover) * t;
    kk.sel += ((s.selection === o.id ? 1 : 0) - kk.sel) * t;
    kk.err += ((issues?.errors.length ? 1 : 0) - kk.err) * t;
    kk.wrn += ((issues?.warnings.length ? 1 : 0) - kk.wrn) * t;
    m.color.copy(base).lerp(WHITE, 0.1 * kk.hover + 0.05 * kk.sel).lerp(AMBER, 0.45 * kk.wrn).lerp(RED, 0.7 * kk.err);
  });

  const label = labelOf(o.type);
  return (
    <group ref={group}>
      <group ref={inner}>
        <mesh
          geometry={geometry}
          castShadow
          receiveShadow
          onPointerOver={(e) => { e.stopPropagation(); useStudio.getState().setHover(o.id); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { useStudio.getState().setHover(null); overlay.hideTip(); document.body.style.cursor = ""; }}
          onPointerMove={(e) => { e.stopPropagation(); overlay.setCoords(e.point.x, e.point.z); if (!useStudio.getState().dragging) overlay.showTip(o.id, label, e.nativeEvent.clientX, e.nativeEvent.clientY); }}
          onClick={(e) => { if (e.delta > 4 || performance.now() - gizmoReleasedAt < 250) return; e.stopPropagation(); useStudio.getState().select(o.id); }}
          onDoubleClick={(e) => { e.stopPropagation(); const st = useStudio.getState(); st.select(o.id); st.focusSelection(); }}
        >
          <meshStandardMaterial ref={material} color={base} roughness={0.88} metalness={0} />
        </mesh>
      </group>
    </group>
  );
});

let gizmoReleasedAt = 0;

function Gizmo() {
  const selection = useStudio((s) => s.selection);
  const tool = useStudio((s) => s.tool);
  const snap = useStudio((s) => s.snap);
  const objectCount = useStudio((s) => s.spec?.objects.length ?? 0);
  const [target, setTarget] = useState<THREE.Group | null>(null);
  const queued = useRef(false);

  useEffect(() => { setTarget(selection ? objectGroups.get(selection) ?? null : null); }, [selection, objectCount]);
  if (!target || !selection) return null;

  const pose = () => ({ x: target.position.x, z: target.position.z, yaw: yawOf(target.quaternion) });
  const liveCheck = () => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame(() => {
      queued.current = false;
      const s = useStudio.getState();
      if (!s.spec || s.dragging !== selection) return;
      const p = pose();
      const draft: EnvironmentSpec = { ...s.spec, objects: s.spec.objects.map((o) => (o.id === selection ? { ...o, position: [p.x, o.position[1], p.z], rotation: [o.rotation[0], p.yaw, o.rotation[2]] } : o)) };
      s.setDraftAnalysis(analyze(draft));
    });
  };

  return (
    <TransformControls
      object={target}
      mode={tool}
      translationSnap={snap ? 0.5 : null}
      rotationSnap={snap ? THREE.MathUtils.degToRad(15) : null}
      showX={tool === "translate"}
      showY={tool === "rotate"}
      showZ={tool === "translate"}
      space="world"
      size={1.35}
      onMouseDown={() => useStudio.getState().setDragging(selection)}
      onObjectChange={liveCheck}
      onMouseUp={() => {
        gizmoReleasedAt = performance.now();
        const s = useStudio.getState();
        s.setDragging(null);
        const o = s.spec?.objects.find((x) => x.id === selection);
        if (!o || !s.spec) return;
        const p = pose();
        const changed = Math.abs(o.position[0] - p.x) > 1e-4 || Math.abs(o.position[2] - p.z) > 1e-4 || Math.abs(Math.atan2(Math.sin(o.rotation[1] - p.yaw), Math.cos(o.rotation[1] - p.yaw))) > 1e-4;
        if (changed) s.commit("transform", { id: selection, ...p });
        else s.setDraftAnalysis(analyze(s.spec));
      }}
    />
  );
}

function footprintBox(o: EnvironmentObject, x: number, z: number, yaw: number) {
  const asset = DEFAULT_ASSET_MAP.get(o.type);
  if (asset) return computeBox({ ...o, position: [x, o.position[1], z], rotation: [o.rotation[0], yaw, o.rotation[2]] }, asset, 0);
  const fp = footprintOf(o.type);
  return { minX: x - fp.width / 2, maxX: x + fp.width / 2, minZ: z - fp.depth / 2, maxZ: z + fp.depth / 2 };
}

function SelectionRing() {
  const fill = useRef<THREE.Mesh>(null);
  const line = useRef<THREE.LineLoop>(null);
  const loop = useMemo(() => new THREE.BufferGeometry().setFromPoints([[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]].map((p) => new THREE.Vector3(...(p as [number, number, number])))), []);
  const accent = useMemo(() => new THREE.Color(COLORS.accent), []);
  useFrame(() => {
    const s = useStudio.getState();
    const o = s.selection ? s.spec?.objects.find((x) => x.id === s.selection) : undefined;
    const g = o ? objectGroups.get(o.id) : undefined;
    const visible = Boolean(o && g && g.visible);
    if (fill.current) fill.current.visible = visible;
    if (line.current) line.current.visible = visible;
    if (!o || !g || !fill.current || !line.current) return;
    const b = footprintBox(o, g.position.x, g.position.z, yawOf(g.quaternion));
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    fill.current.position.set(cx, 0.02, cz);
    fill.current.scale.set(b.maxX - b.minX, b.maxZ - b.minZ, 1);
    line.current.position.set(cx, 0.025, cz);
    line.current.scale.set(b.maxX - b.minX, 1, b.maxZ - b.minZ);
    const color = s.analysis.byId.get(o.id)?.errors.length ? RED : accent;
    (fill.current.material as THREE.MeshBasicMaterial).color.copy(color);
    (line.current.material as THREE.LineBasicMaterial).color.copy(color);
  });
  return (
    <>
      <mesh ref={fill} rotation-x={-Math.PI / 2} renderOrder={2} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.16} depthWrite={false} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
      </mesh>
      <lineLoop ref={line} geometry={loop} renderOrder={3} raycast={() => null}>
        <lineBasicMaterial depthWrite={false} />
      </lineLoop>
    </>
  );
}

function ConfidenceRings() {
  const objects = useStudio((s) => s.spec!.objects);
  const confidence = useStudio((s) => s.confidence);
  const reviewed = useStudio((s) => s.reviewed);
  const rings = useMemo(() => {
    if (!confidence) return [];
    return objects
      .filter((o) => (confidence[o.id] ?? 1) < LOW_CONFIDENCE && !reviewed.includes(o.id))
      .map((o) => {
        const b = footprintBox(o, o.position[0], o.position[2], o.rotation[1]);
        const pad = 0.25;
        return { id: o.id, pts: [[b.minX - pad, b.minZ - pad], [b.maxX + pad, b.minZ - pad], [b.maxX + pad, b.maxZ + pad], [b.minX - pad, b.maxZ + pad], [b.minX - pad, b.minZ - pad]].map(([x, z]) => new THREE.Vector3(x, 0.03, z)) };
      });
  }, [objects, confidence, reviewed]);
  return (
    <>
      {rings.map((r) => (
        <Line key={r.id} points={r.pts} color={COLORS.warn} lineWidth={1.6} dashed dashSize={0.35} gapSize={0.25} raycast={() => null} />
      ))}
    </>
  );
}

function ScreenPins({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dims = useStudio((s) => s.spec!.environment.dimensions);
  const waypoints = useStudio((s) => s.spec!.navigation?.waypoints);
  const anchors = useMemo(() => {
    const list: { text: string; cls: string; at: THREE.Vector3 }[] = [];
    const wps = waypoints ?? [];
    if (wps[0]) list.push({ text: "START", cls: "pin", at: new THREE.Vector3(wps[0].position[0], 0.6, wps[0].position[2]) });
    const last = wps.at(-1);
    if (last && wps.length > 1) list.push({ text: "DOCK", cls: "pin", at: new THREE.Vector3(last.position[0], 0.6, last.position[2]) });
    list.push({ text: `${dims.width} m`, cls: "pin dim", at: new THREE.Vector3(0, 0, dims.length / 2 + 2.4) });
    list.push({ text: `${dims.length} m`, cls: "pin dim", at: new THREE.Vector3(dims.width / 2 + 2.8, 0, 0) });
    return list;
  }, [dims, waypoints]);
  const els = useRef<HTMLSpanElement[]>([]);
  const sel = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    els.current = anchors.map((a) => {
      const el = document.createElement("span");
      el.className = a.cls;
      el.textContent = a.text;
      root.appendChild(el);
      return el;
    });
    const s = document.createElement("span");
    s.className = "pin sel";
    s.style.display = "none";
    root.appendChild(s);
    sel.current = s;
    return () => { els.current.forEach((e) => e.remove()); s.remove(); };
  }, [anchors, host]);

  const v = useMemo(() => new THREE.Vector3(), []);
  const place = (el: HTMLElement, p: THREE.Vector3) => {
    v.copy(p).project(camera);
    const hidden = v.z > 1;
    el.style.display = hidden ? "none" : "";
    el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
  };
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    anchors.forEach((a, i) => { const el = els.current[i]; if (el) place(el, a.at); });
    const s = useStudio.getState();
    const el = sel.current;
    if (!el) return;
    const o = s.selection ? s.spec?.objects.find((x) => x.id === s.selection) : undefined;
    const g = o ? objectGroups.get(o.id) : undefined;
    if (!o || !g || !g.visible) { el.style.display = "none"; return; }
    const fp = footprintOf(o.type);
    const text = `${(fp.width * o.scale[0]).toFixed(1)} × ${(fp.depth * o.scale[2]).toFixed(1)} m`;
    if (el.textContent !== text) el.textContent = text;
    place(el, tmp.set(g.position.x, g.position.y + fp.height * o.scale[1] + 1.2, g.position.z));
  });
  return null;
}

interface Fly {
  t0: number;
  dur: number;
  fromT: THREE.Vector3;
  toT: THREE.Vector3;
  fromD: number;
  toD: number;
  fromDir: THREE.Vector3;
  toDir: THREE.Vector3;
}

function CameraRig({ frame }: { frame: RefObject<HTMLDivElement | null> }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dims = useStudio((s) => s.spec?.environment.dimensions);
  const loadNonce = useStudio((s) => s.loadNonce);
  const viewNonce = useStudio((s) => s.viewNonce);
  const focusNonce = useStudio((s) => s.focusNonce);
  const free = useRef<FreeRegion>({ cx: 0, cy: 0, hx: 0.9, hy: 0.76 });
  const fly = useRef<Fly | null>(null);

  const measure = () => {
    const host = frame.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const hud = host.querySelector("[data-hud='top']")?.getBoundingClientRect();
    const dock = host.querySelector("[data-hud='dock']")?.getBoundingClientRect();
    const y0 = hud ? hud.bottom + 8 : r.top + 14;
    const y1 = dock ? dock.top - 8 : r.bottom - 14;
    const nx = (p: number) => ((p - r.left) / r.width) * 2 - 1;
    const ny = (p: number) => 1 - ((p - r.top) / r.height) * 2;
    const a = nx(r.left + 14);
    const b = nx(r.right - 14);
    const c = ny(y1);
    const d = ny(y0);
    free.current = { cx: (a + b) / 2, cy: (c + d) / 2, hx: Math.max(0.3, (b - a) / 2), hy: Math.max(0.3, (d - c) / 2) };
    camera.setViewOffset(r.width, r.height, (-free.current.cx * r.width) / 2, (free.current.cy * r.height) / 2, r.width, r.height);
    camera.updateProjectionMatrix();
  };

  const distanceFor = (dir: THREE.Vector3) => {
    measure();
    return dims ? fitDistance(dir, dims.width, dims.length, FOV, camera.aspect, free.current) : 200;
  };

  const flyTo = (target: THREE.Vector3, dist: number, dur: number, dir?: THREE.Vector3) => {
    const c = controls.current;
    if (!c) return;
    const cur = camera.position.clone().sub(c.target).normalize();
    fly.current = { t0: now(), dur, fromT: c.target.clone(), toT: target, fromD: camera.position.distanceTo(c.target), toD: dist, fromDir: cur, toDir: dir ?? cur };
  };

  useEffect(() => { measure(); }, [size.width, size.height]);

  useEffect(() => {
    if (!dims || !controls.current) return;
    const d = distanceFor(ISO_DIR);
    controls.current.target.set(0, 0, 0);
    camera.position.copy(ISO_DIR).multiplyScalar(d * 1.7);
    flyTo(new THREE.Vector3(), d, MOTION.introFly, ISO_DIR);
  }, [loadNonce]);

  useEffect(() => {
    if (!viewNonce) return;
    const view = useStudio.getState().view;
    const dir = view === "top" ? TOP_DIR : ISO_DIR;
    flyTo(new THREE.Vector3(), distanceFor(dir), 1, dir);
  }, [viewNonce]);

  useEffect(() => {
    if (!focusNonce) return;
    const id = useStudio.getState().selection;
    const g = id ? objectGroups.get(id) : undefined;
    if (g) flyTo(g.position.clone().setY(1), 26, 0.9);
  }, [focusNonce]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const f = fly.current;
    if (f) {
      const u = clamp((now() - f.t0) / f.dur, 0, 1);
      const e = easeInOut(u);
      c.target.lerpVectors(f.fromT, f.toT, e);
      camera.position.copy(c.target).addScaledVector(f.fromDir.clone().lerp(f.toDir, e).normalize(), f.fromD + (f.toD - f.fromD) * e);
      if (u >= 1) fly.current = null;
    }
    const dist = camera.position.distanceTo(c.target);
    const near = Math.max(0.4, dist * 0.04);
    const far = Math.max(500, dist * 6);
    if (Math.abs(near - camera.near) / camera.near > 0.02 || Math.abs(far - camera.far) / camera.far > 0.02) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      maxPolarAngle={Math.PI * 0.47}
      minDistance={6}
      maxDistance={600}
      screenSpacePanning={false}
      rotateSpeed={0.7}
      zoomSpeed={0.9}
      onStart={() => { fly.current = null; useStudio.getState().clearView(); }}
    />
  );
}
