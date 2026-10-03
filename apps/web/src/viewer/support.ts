import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { footprintOf } from "../domain/categories";

export const objectGroups = new Map<string, THREE.Group>();

const geometryCache = new Map<string, THREE.BufferGeometry>();

export function bodyGeometry(type: string, scale: readonly [number, number, number]): THREE.BufferGeometry {
  const key = `${type}|${scale.join("|")}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const fp = footprintOf(type);
  const w = fp.width * scale[0];
  const d = fp.depth * scale[2];
  const h = fp.height * scale[1];
  const g = new RoundedBoxGeometry(w, h, d, 4, Math.min(0.07, 0.2 * Math.min(w, d, h))).translate(0, h / 2, 0);
  geometryCache.set(key, g);
  return g;
}

export const yawOf = (q: THREE.Quaternion) => new THREE.Euler().setFromQuaternion(q, "YXZ").y;

export const easeOutBack = (u: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};
export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export interface FreeRegion {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
}

const fitCamera = new THREE.PerspectiveCamera();

export function fitDistance(dir: THREE.Vector3, width: number, length: number, fov: number, aspect: number, free: FreeRegion): number {
  fitCamera.fov = fov;
  fitCamera.aspect = aspect;
  fitCamera.near = 1;
  fitCamera.far = 5000;
  fitCamera.updateProjectionMatrix();
  const corners: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 4]) corners.push(new THREE.Vector3((sx * width) / 2, y, (sz * length) / 2));
  const v = new THREE.Vector3();
  for (let d = 20; d < 3000; d *= 1.02) {
    fitCamera.position.copy(dir).multiplyScalar(d);
    fitCamera.lookAt(0, 0, 0);
    fitCamera.updateMatrixWorld();
    if (corners.every((c) => { v.copy(c).project(fitCamera); return Math.abs(v.x) <= free.hx && Math.abs(v.y) <= free.hy; })) return d;
  }
  return 400;
}

let tipEl: HTMLElement | null = null;
let coordsEl: HTMLElement | null = null;

export const overlay = {
  bindTip(el: HTMLElement | null) {
    tipEl = el;
  },
  bindCoords(el: HTMLElement | null) {
    coordsEl = el;
  },
  showTip(title: string, sub: string, clientX: number, clientY: number) {
    if (!tipEl?.parentElement) return;
    const r = tipEl.parentElement.getBoundingClientRect();
    tipEl.innerHTML = "";
    const a = document.createElement("span");
    a.className = "mono";
    a.textContent = title;
    const b = document.createElement("span");
    b.className = "muted";
    b.textContent = sub;
    tipEl.append(a, b);
    tipEl.style.transform = `translate(${clientX - r.left + 14}px, ${clientY - r.top + 14}px)`;
    tipEl.dataset.show = "true";
  },
  hideTip() {
    if (tipEl) tipEl.dataset.show = "false";
  },
  setCoords(x: number | null, z: number | null) {
    if (!coordsEl) return;
    coordsEl.textContent = x === null || z === null ? "X —   Z —" : `X ${x.toFixed(1).padStart(6)}   Z ${z.toFixed(1).padStart(6)}`;
  },
};
