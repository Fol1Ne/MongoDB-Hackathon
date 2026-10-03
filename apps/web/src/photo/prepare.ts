import type { PreparedPhoto } from "../api/types";

export const PHOTO_LIMITS = {
  maxFiles: 6,
  maxBytes: 25 * 1024 * 1024,
  maxEdge: 2048,
  quality: 0.9,
  types: ["image/jpeg", "image/png", "image/webp"] as const,
};

export type FileCheck = { ok: true } | { ok: false; reason: string };

export function checkFile(file: { name: string; type: string; size: number }, alreadyAdded: number): FileCheck {
  if (alreadyAdded >= PHOTO_LIMITS.maxFiles) return { ok: false, reason: `Up to ${PHOTO_LIMITS.maxFiles} photos per environment.` };
  const lower = file.name.toLowerCase();
  if (file.type === "image/heic" || file.type === "image/heif" || lower.endsWith(".heic") || lower.endsWith(".heif")) {
    return { ok: false, reason: `${file.name} is HEIC. Export it as JPEG first, or set the iPhone camera to "Most Compatible".` };
  }
  if (!(PHOTO_LIMITS.types as readonly string[]).includes(file.type)) return { ok: false, reason: `${file.name} is not a JPEG, PNG, or WebP image.` };
  if (file.size > PHOTO_LIMITS.maxBytes) return { ok: false, reason: `${file.name} is larger than 25 MB.` };
  return { ok: true };
}

export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function hasExif(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) return true;
    if (marker === 0xda) return false;
    i += 2 + length;
  }
  return false;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = fitWithin(bitmap.width, bitmap.height, PHOTO_LIMITS.maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the photo."))), "image/jpeg", PHOTO_LIMITS.quality));
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { id: crypto.randomUUID(), name, blob, width: size.width, height: size.height, bytes: blob.size, originalBytes: file.size };
}
