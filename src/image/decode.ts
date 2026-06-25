// Decode an uploaded file into downscaled ImageData (main-thread canvas).

export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

export async function loadFileToImage(file: File, maxSize = 1100): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file);
  try {
    return drawToImageData(bitmap, bitmap.width, bitmap.height, maxSize);
  } finally {
    bitmap.close();
  }
}

export function drawToImageData(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxSize: number,
): RgbaImage {
  const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}
