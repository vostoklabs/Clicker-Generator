// Median-cut color quantization over the foreground (non-transparent) pixels.
import type { RgbaImage } from './decode';
import type { RGB } from '../types';

export interface QuantizeResult {
  palette: { rgb: RGB; coverage: number }[];
  /** Per-pixel palette index, or -1 for background. Length = width*height. */
  indices: Int16Array;
  width: number;
  height: number;
}

interface Box {
  pixels: number[]; // indices into the foreground arrays
}

// Soft anti-aliased edge pixels (alpha below this) are dropped from the model so
// they don't quantize into a light "halo" ring around the subject.
const ALPHA_THRESHOLD = 170;

export function quantize(img: RgbaImage, colorCount: number): QuantizeResult {
  const { data, width, height } = img;
  const n = width * height;

  // Collect foreground pixels.
  const fgR: number[] = [];
  const fgG: number[] = [];
  const fgB: number[] = [];
  const fgPixel: number[] = []; // pixel index in full image
  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3];
    if (a < ALPHA_THRESHOLD) continue;
    fgR.push(data[p * 4]);
    fgG.push(data[p * 4 + 1]);
    fgB.push(data[p * 4 + 2]);
    fgPixel.push(p);
  }

  const indices = new Int16Array(n).fill(-1);
  if (fgR.length === 0) {
    return { palette: [], indices, width, height };
  }

  // Median cut.
  let boxes: Box[] = [{ pixels: fgR.map((_, i) => i) }];
  const target = Math.max(1, Math.min(colorCount, 16));
  while (boxes.length < target) {
    // Pick the box with the largest channel range to split.
    let best = -1;
    let bestRange = -1;
    let bestChannel = 0;
    for (let b = 0; b < boxes.length; b++) {
      const { range, channel } = boxStats(boxes[b], fgR, fgG, fgB);
      if (range > bestRange && boxes[b].pixels.length > 1) {
        bestRange = range;
        best = b;
        bestChannel = channel;
      }
    }
    if (best < 0 || bestRange <= 0) break;

    const box = boxes[best];
    const ch = bestChannel === 0 ? fgR : bestChannel === 1 ? fgG : fgB;
    box.pixels.sort((i, j) => ch[i] - ch[j]);
    const mid = box.pixels.length >> 1;
    const a: Box = { pixels: box.pixels.slice(0, mid) };
    const c: Box = { pixels: box.pixels.slice(mid) };
    boxes.splice(best, 1, a, c);
  }

  // Average each box -> palette color.
  const palette: { rgb: RGB; coverage: number }[] = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const i of box.pixels) {
      r += fgR[i];
      g += fgG[i];
      bl += fgB[i];
    }
    const k = box.pixels.length || 1;
    return {
      rgb: [Math.round(r / k), Math.round(g / k), Math.round(bl / k)] as RGB,
      coverage: box.pixels.length / fgR.length,
    };
  });

  // Assign every foreground pixel to nearest palette color.
  for (let i = 0; i < fgR.length; i++) {
    let bestK = 0;
    let bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const [pr, pg, pb] = palette[k].rgb;
      const dr = fgR[i] - pr;
      const dg = fgG[i] - pg;
      const db = fgB[i] - pb;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    indices[fgPixel[i]] = bestK;
  }

  return { palette, indices, width, height };
}

function boxStats(box: Box, R: number[], G: number[], B: number[]) {
  let rmin = 255;
  let rmax = 0;
  let gmin = 255;
  let gmax = 0;
  let bmin = 255;
  let bmax = 0;
  for (const i of box.pixels) {
    rmin = Math.min(rmin, R[i]);
    rmax = Math.max(rmax, R[i]);
    gmin = Math.min(gmin, G[i]);
    gmax = Math.max(gmax, G[i]);
    bmin = Math.min(bmin, B[i]);
    bmax = Math.max(bmax, B[i]);
  }
  // Weight green slightly (perceptual), like classic median cut.
  const rr = rmax - rmin;
  const gr = (gmax - gmin) * 1.2;
  const br = bmax - bmin;
  const range = Math.max(rr, gr, br);
  const channel = range === rr ? 0 : range === gr ? 1 : 2;
  return { range, channel };
}
