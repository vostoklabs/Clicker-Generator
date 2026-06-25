// A synthetic multi-color test image (transparent background) so the full
// pipeline can be exercised without a manual upload. Doubles as a "Try sample".
import type { RgbaImage } from './decode';

export function makeSampleImage(): RgbaImage {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  // Face (yellow)
  ctx.fillStyle = '#f4c430';
  ctx.beginPath();
  ctx.arc(128, 132, 96, 0, Math.PI * 2);
  ctx.fill();

  // Cheeks (red)
  ctx.fillStyle = '#e8554e';
  ctx.beginPath();
  ctx.arc(86, 150, 18, 0, Math.PI * 2);
  ctx.arc(170, 150, 18, 0, Math.PI * 2);
  ctx.fill();

  // Eyes + smile (dark)
  ctx.fillStyle = '#241f1c';
  ctx.beginPath();
  ctx.arc(98, 110, 12, 0, Math.PI * 2);
  ctx.arc(158, 110, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#241f1c';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(128, 138, 44, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}
