// Background removal for uploads. Handles three cases with one flood-fill:
//   1) Opaque photo/clipart with a flat background  -> flood the border color.
//   2) PNG already cut out (alpha)                  -> just drop the transparent ring.
//   3) PNG with a transparent ring AROUND a baked solid matte (e.g. a logo on a
//      white box) -> flood through the ring INTO the matte, stopping at the
//      subject. This was the case the old code missed.
//
// A genuine cut-out subject (e.g. a circular face on transparency) is preserved:
// its opaque bounding-box corners are empty, so no matte is detected and only
// the transparent ring is removed.
import type { RgbaImage } from './decode';

const ALPHA_THRESHOLD = 128;

type RGB = [number, number, number];

export function removeBackground(img: RgbaImage, tol = 2000): RgbaImage {
  const { data, width: W, height: H } = img;
  const n = W * H;
  const isTransparent = (p: number) => data[p * 4 + 3] < ALPHA_THRESHOLD;
  const colorAt = (p: number): RGB => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
  const dist2 = (a: RGB, b: RGB) => {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  };

  // Generic border flood: mark pixels reachable from any edge for which pred() holds.
  const floodFromBorder = (pred: (p: number) => boolean): Uint8Array => {
    const mask = new Uint8Array(n);
    const stack: number[] = [];
    const push = (p: number) => {
      if (!mask[p] && pred(p)) {
        mask[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < W; x++) {
      push(x);
      push((H - 1) * W + x);
    }
    for (let y = 0; y < H; y++) {
      push(y * W);
      push(y * W + W - 1);
    }
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p / W) | 0;
      if (x > 0) push(p - 1);
      if (x < W - 1) push(p + 1);
      if (y > 0) push(p - W);
      if (y < H - 1) push(p + W);
    }
    return mask;
  };

  let hadAlpha = 0;
  for (let p = 0; p < n; p++) if (isTransparent(p)) hadAlpha++;
  const isCutout = hadAlpha > n * 0.02;

  // Bounding box of the opaque content NOT connected to the border by transparency.
  const transRing = isCutout ? floodFromBorder(isTransparent) : new Uint8Array(n);
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!transRing[p] && !isTransparent(p)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Detect a solid matte: the four corners of the opaque bbox (or the whole image
  // when fully opaque) must be opaque and mutually similar.
  let matte: RGB | null = null;
  if (maxX >= minX) {
    const corners = [
      [minX, minY],
      [maxX, minY],
      [minX, maxY],
      [maxX, maxY],
    ].map(([x, y]) => y * W + x);
    if (corners.every((p) => !isTransparent(p))) {
      const cs = corners.map(colorAt);
      const uniform = cs.every((c) => dist2(c, cs[0]) <= tol * 3);
      if (uniform) {
        matte = [
          (cs[0][0] + cs[1][0] + cs[2][0] + cs[3][0]) / 4,
          (cs[0][1] + cs[1][1] + cs[2][1] + cs[3][1]) / 4,
          (cs[0][2] + cs[1][2] + cs[2][2] + cs[3][2]) / 4,
        ];
      }
    }
  }

  // Final flood: a pixel is background if it's transparent OR (matte detected and
  // similar to the matte color), reachable from the border.
  const bg = floodFromBorder((p) =>
    isTransparent(p) || (matte !== null && dist2(colorAt(p), matte) <= tol),
  );

  for (let p = 0; p < n; p++) if (bg[p]) data[p * 4 + 3] = 0;
  return img;
}
