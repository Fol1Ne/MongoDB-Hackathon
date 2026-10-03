import { describe, expect, it } from "vitest";
import { checkFile, fitWithin, hasExif } from "./prepare";

const jpegWith = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const app0 = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];
const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

describe("photo checks", () => {
  it("accepts JPEG, PNG, and WebP and explains each rejection", () => {
    expect(checkFile({ name: "dock.jpg", type: "image/jpeg", size: 4_000_000 }, 0)).toEqual({ ok: true });
    expect(checkFile({ name: "aisle.webp", type: "image/webp", size: 1_000 }, 5)).toEqual({ ok: true });
    expect(checkFile({ name: "IMG_0042.HEIC", type: "", size: 1_000 }, 0)).toEqual({ ok: false, reason: 'IMG_0042.HEIC is HEIC. Export it as JPEG first, or set the iPhone camera to "Most Compatible".' });
    expect(checkFile({ name: "spin.gif", type: "image/gif", size: 1_000 }, 0)).toEqual({ ok: false, reason: "spin.gif is not a JPEG, PNG, or WebP image." });
    expect(checkFile({ name: "huge.png", type: "image/png", size: 30_000_000 }, 0)).toEqual({ ok: false, reason: "huge.png is larger than 25 MB." });
    expect(checkFile({ name: "seventh.jpg", type: "image/jpeg", size: 1_000 }, 6)).toEqual({ ok: false, reason: "Up to 6 photos per environment." });
  });

  it("shrinks the long edge to 2048 and never enlarges", () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(1200, 800, 2048)).toEqual({ width: 1200, height: 800 });
  });

  it("detects an EXIF block before the image data", () => {
    expect(hasExif(jpegWith(app0, exif))).toBe(true);
    expect(hasExif(jpegWith(app0))).toBe(false);
    expect(hasExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
