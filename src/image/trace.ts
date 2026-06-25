// Trace per-color masks into normalized 2D rings using d3-contour (robust hole
// handling), then simplify. Output is normalized: longest silhouette side = 1,
// centered, Y-up. The worker scales by capWidthMm.
import { contours } from 'd3-contour';
import type { QuantizeResult } from './quantize';
import type { RegionSet, Ring, RGB } from '../types';

export function traceRegions(q: QuantizeResult, smoothing = 0.5): RegionSet {
  const { indices, width, height, palette } = q;

  // Foreground bbox (pixel space) for normalization.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (indices[y * width + x] >= 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!isFinite(minX)) {
    return { regions: [], outline: [], aspect: 1 };
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const maxSide = Math.max(bw, bh);
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;

  const norm = (p: [number, number]): [number, number] => [
    (p[0] - cx) / maxSide,
    -(p[1] - cy) / maxSide, // flip Y -> Y-up
  ];

  const contourGen = contours().size([width, height]).thresholds([0.5]);
  const minRingArea = 0.0004 * maxSide * maxSide; // drop noise specks (px²)
  const resampleStep = Math.max(0.6, maxSide / 720); // uniform contour spacing (px) - higher resolution
  // Smoothing strength → Gaussian sigma in px. `smoothing` is 0..1 from the UI.
  const sigmaPx = 1.0 + Math.max(0, Math.min(1, smoothing)) * 14;
  const sigmaPts = Math.max(0.6, sigmaPx / resampleStep);

  // Vector-style smoothing: the staircase boundary is resampled to uniform spacing
  // and Gaussian-smoothed as a 1-D closed curve (like a vectorizer). Brushy pixel
  // noise vanishes while real features (eyes, smile, thin strokes) stay intact —
  // unlike blurring the mask, which erases small features. Shared edges between
  // colors get identical input, so the regions stay gap-free.
  const ringsFromMask = (mask: Float64Array): Ring[] => {
    const multi = contourGen(mask as unknown as number[])[0];
    const out: Ring[] = [];
    for (const poly of multi.coordinates) {
      for (const ring of poly) {
        const r = ring as [number, number][];
        if (Math.abs(ringArea(r)) < minRingArea) continue;
        const sampled = resampleClosed(r, resampleStep);
        const smooth = gaussianSmoothClosed(sampled, sigmaPts);
        const simplified = rdp(smooth, resampleStep * 0.25); // higher resolution simplification
        if (simplified.length >= 3) out.push(simplified.map(norm));
      }
    }
    return out;
  };

  // --- Re-tile colors via blurred argmax: smooths boundaries AND keeps every
  //     foreground pixel assigned (no gaps) with shared edges between colors. ---
  const K = palette.length;
  const fields: Float64Array[] = [];
  for (let k = 0; k < K; k++) {
    const m = new Float64Array(width * height);
    for (let p = 0; p < indices.length; p++) if (indices[p] === k) m[p] = 1;
    fields.push(boxBlur(m, width, height, 1.6));
  }
  const label = new Int16Array(width * height).fill(-1);
  for (let p = 0; p < indices.length; p++) {
    if (indices[p] < 0) continue;
    let best = 0;
    let bestV = -1;
    for (let k = 0; k < K; k++) {
      const v = fields[k][p];
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    label[p] = best;
  }

  // Per-color regions, traced from the smooth tiling.
  const regions: RegionSet['regions'] = [];
  for (let k = 0; k < K; k++) {
    const mask = new Float64Array(width * height);
    for (let p = 0; p < label.length; p++) mask[p] = label[p] === k ? 1 : 0;
    const rings = ringsFromMask(mask);
    if (rings.length === 0) continue;
    regions.push({ quantRgb: palette[k].rgb as RGB, rings, coverage: palette[k].coverage });
  }

  // Outline = all foreground. It's a single region (no adjacency gaps), so blur
  // it for an extra-smooth cap edge.
  const fgMask = new Float64Array(width * height);
  for (let p = 0; p < indices.length; p++) fgMask[p] = indices[p] >= 0 ? 1 : 0;
  const outline = ringsFromMask(boxBlur(fgMask, width, height, 1.6));

  return { regions, outline, aspect: bw / bh };
}

/** Signed area of a polyline ring (shoelace). */
function ringArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

/** Separable box blur over a w×h field (radius in px, fractional ok). */
function boxBlur(src: Float64Array, w: number, h: number, radius: number): Float64Array {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  const norm = 1 / (2 * r + 1);
  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + clampI(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * norm;
      sum += src[row + clampI(x + r + 1, 0, w - 1)] - src[row + clampI(x - r, 0, w - 1)];
    }
  }
  // Vertical pass.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clampI(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum * norm;
      sum += tmp[clampI(y + r + 1, 0, h - 1) * w + x] - tmp[clampI(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Drop a duplicate closing vertex if present. */
function openRing(points: [number, number][]): [number, number][] {
  if (
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
  ) {
    return points.slice(0, -1);
  }
  return points.slice();
}

/** Resample a closed ring to roughly uniform spacing (px) so smoothing is even. */
function resampleClosed(points: [number, number][], step: number): [number, number][] {
  const pts = openRing(points);
  if (pts.length < 3) return pts;
  // Perimeter.
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const count = Math.max(8, Math.round(perim / step));
  const spacing = perim / count;
  const out: [number, number][] = [];
  let i = 0;
  let acc = 0;
  let cur = pts[0];
  out.push([cur[0], cur[1]]);
  for (let k = 1; k < count; k++) {
    let target = k * spacing;
    while (i < pts.length) {
      const a = pts[i % pts.length];
      const b = pts[(i + 1) % pts.length];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      if (acc + seg >= target) {
        const t = (target - acc) / seg;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      acc += seg;
      i++;
    }
  }
  return out;
}

/** Gaussian smoothing of a closed ring (1-D convolution along the contour).
 *  `sigma` is in points; removes high-frequency boundary noise while keeping the
 *  overall shape and coherent features. */
function gaussianSmoothClosed(points: [number, number][], sigma: number): [number, number][] {
  const n = points.length;
  if (n < 5 || sigma < 0.3) return points;
  const radius = Math.max(1, Math.min(Math.ceil(sigma * 3), Math.floor((n - 1) / 2)));
  const kernel: number[] = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  const out: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let k = -radius; k <= radius; k++) {
      const p = points[((i + k) % n + n) % n];
      const w = kernel[k + radius];
      x += p[0] * w;
      y += p[1] * w;
    }
    out[i] = [x / sum, y / sum];
  }
  return out;
}

/** Ramer–Douglas–Peucker polyline simplification (closed ring aware). */
function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 4) return points;
  // Drop duplicate closing point if present.
  const pts =
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
      ? points.slice(0, -1)
      : points.slice();

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const result: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) result.push(pts[i]);
  return result;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
