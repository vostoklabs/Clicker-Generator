// Bambu-style image preprocessing: crop to a ratio + per-pixel adjustments
// (exposure, contrast, saturation, brightness, white balance, highlights,
// shadows). Pure functions; never mutate the source image.
import type { RgbaImage } from './decode';
import type { CropRatio, PreprocessParams } from '../types';

const RATIO: Record<CropRatio, number | null> = {
  free: null,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
};

/** Center-crop to the target aspect ratio. `free` returns a copy unchanged. */
export function cropToRatio(img: RgbaImage, ratio: CropRatio): RgbaImage {
  const target = RATIO[ratio];
  if (!target) return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };

  const { width: W, height: H } = img;
  let cw = W;
  let ch = Math.round(W / target);
  if (ch > H) {
    ch = H;
    cw = Math.round(H * target);
  }
  const x0 = ((W - cw) / 2) | 0;
  const y0 = ((H - ch) / 2) | 0;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcRow = (y0 + y) * W + x0;
    const dstRow = y * cw;
    for (let x = 0; x < cw; x++) {
      const si = (srcRow + x) * 4;
      const di = (dstRow + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }
  return { data: out, width: cw, height: ch };
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Apply tone/color adjustments. Returns a new image; alpha is preserved. */
export function adjustImage(img: RgbaImage, p: PreprocessParams): RgbaImage {
  const out = new Uint8ClampedArray(img.data);
  const { exposure, contrast, saturation, brightness, whiteBalance, highlights, shadows } = p;

  // White balance: warm (>1) pushes red, cools blue, and vice-versa.
  const rGain = whiteBalance;
  const bGain = 2 - whiteBalance;
  const briOffset = (brightness - 1) * 110;

  for (let i = 0; i < out.length; i += 4) {
    let r = img.data[i];
    let g = img.data[i + 1];
    let b = img.data[i + 2];

    // Exposure (linear gain) + white balance.
    r = r * exposure * rGain;
    g = g * exposure;
    b = b * exposure * bGain;

    // Contrast about mid-gray.
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;

    // Highlights / shadows weighted by luma.
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (highlights !== 1 && luma > 128) {
      const w = (luma - 128) / 127;
      const d = (highlights - 1) * 90 * w;
      r += d; g += d; b += d;
    }
    if (shadows !== 1 && luma < 128) {
      const w = (128 - luma) / 128;
      const d = (shadows - 1) * 90 * w;
      r += d; g += d; b += d;
    }

    // Saturation about luma.
    if (saturation !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;
    }

    // Brightness offset.
    r += briOffset; g += briOffset; b += briOffset;

    out[i] = clamp(r);
    out[i + 1] = clamp(g);
    out[i + 2] = clamp(b);
    // alpha (out[i+3]) already copied
  }
  return { data: out, width: img.width, height: img.height };
}

/** Crop then adjust — the full preprocess (background removal happens later). */
export function preprocessImage(img: RgbaImage, p: PreprocessParams): RgbaImage {
  return adjustImage(cropToRatio(img, p.cropRatio), p);
}
