// Image -> normalized RegionSet. Orchestrates matte + quantize + trace.
import type { RgbaImage } from './decode';
import { removeBackground } from './matte';
import { quantize } from './quantize';
import { traceRegions } from './trace';
import type { RegionSet } from '../types';

export interface ProcessOptions {
  /** Strip a flat background by edge flood-fill (skipped if image has alpha). */
  removeBg?: boolean;
  /** Edge smoothing strength, 0..1 (higher = smoother contours). */
  smoothing?: number;
}

export function processImage(
  img: RgbaImage,
  colorCount: number,
  opts: ProcessOptions = {},
): RegionSet {
  if (opts.removeBg !== false) removeBackground(img);
  const q = quantize(img, colorCount);
  return traceRegions(q, opts.smoothing ?? 0.5);
}
