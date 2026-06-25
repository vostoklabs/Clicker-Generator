// Bambu-style image → model wizard. Three modal steps:
//   1) Preprocessing  — crop ratio, keep background, thickness, tone/color sliders
//   2) Conversion preview — shows the processed (matte-applied) result
//   3) Auto matching  — pick 4 / 8 / 12 colors, preview the color→slot mapping
// On confirm it hands the adjusted image (background intact) + params back; the
// caller runs the trace/build pipeline (background removal is re-derived there).
import type { RgbaImage } from '../image/decode';
import { preprocessImage } from '../image/adjust';
import { removeBackground } from '../image/matte';
import { quantize } from '../image/quantize';
import { DEFAULT_PREPROCESS, type CropRatio, type PreprocessParams } from '../types';

export interface WizardResult {
  adjusted: RgbaImage; // cropped + tone-adjusted, background still present
  preprocess: PreprocessParams;
  colorCount: number;
}

interface WizardOpts {
  baseImage: RgbaImage;
  initialColorCount: number;
  onComplete(result: WizardResult): void;
  onCancel?(): void;
}

const SLIDERS: [keyof PreprocessParams, string][] = [
  ['exposure', 'Exposure'],
  ['contrast', 'Contrast'],
  ['saturation', 'Saturation'],
  ['brightness', 'Brightness'],
  ['whiteBalance', 'White Balance'],
  ['highlights', 'Highlights'],
  ['shadows', 'Shadows'],
];

const RATIOS: [CropRatio, string][] = [
  ['free', 'Free'],
  ['1:1', '1:1'],
  ['4:3', '4:3'],
  ['3:2', '3:2'],
  ['16:9', '16:9'],
];

function imageToCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export function runWizard(opts: WizardOpts) {
  const params: PreprocessParams = { ...DEFAULT_PREPROCESS };
  let colorCount = [4, 8, 12].includes(opts.initialColorCount) ? opts.initialColorCount : 4;

  const overlay = document.createElement('div');
  overlay.className = 'wz-overlay';
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const cancel = () => {
    close();
    opts.onCancel?.();
  };

  // Adjusted image (background intact) for the current params.
  const adjusted = () => preprocessImage(opts.baseImage, params);
  // Processed image used for preview / matching (background removed unless kept).
  const processed = (): RgbaImage => {
    const a = adjusted();
    if (!params.keepBackground) removeBackground(a);
    return a;
  };

  // ---------- Step 1: preprocessing ----------
  function stepPreprocess() {
    overlay.innerHTML = `
      <div class="wz-modal lg">
        <div class="wz-head">Image Preprocessing</div>
        <div class="wz-body">
          <div class="wz-canvas checker" id="wzPrev"></div>
          <div class="wz-controls">
            <div class="wz-label">Crop Ratio</div>
            <div class="seg" id="wzRatio">${RATIOS.map(
              ([k, l]) => `<button data-r="${k}">${l}</button>`,
            ).join('')}</div>

            <div class="wz-row spread">
              <span class="wz-label">Keep Background</span>
              <label class="toggle"><input type="checkbox" id="wzKeep" /><span class="track"></span></label>
            </div>

            <div class="wz-row spread">
              <span class="wz-label">Image Thickness</span>
              <span class="wz-num"><input type="number" id="wzThick" min="0.2" max="10" step="0.2" /> mm</span>
            </div>

            <div class="wz-label">Image Adjustment</div>
            ${SLIDERS.map(
              ([k, l]) => `
              <div class="wz-adj">
                <span>${l}</span>
                <input type="range" data-k="${k}" min="0" max="2" step="0.05" />
                <span class="wz-num"><input type="number" data-n="${k}" min="0" max="2" step="0.05" /></span>
              </div>`,
            ).join('')}
          </div>
        </div>
        <div class="wz-foot">
          <button id="wzCancel">Cancel</button>
          <button class="primary" id="wzNext">Confirm</button>
        </div>
      </div>`;

    const prev = overlay.querySelector<HTMLElement>('#wzPrev')!;
    const redraw = () => {
      prev.innerHTML = '';
      prev.appendChild(imageToCanvas(adjusted()));
    };
    redraw();

    for (const b of overlay.querySelectorAll<HTMLElement>('#wzRatio button')) {
      b.classList.toggle('active', b.dataset.r === params.cropRatio);
      b.addEventListener('click', () => {
        params.cropRatio = b.dataset.r as CropRatio;
        for (const x of overlay.querySelectorAll('#wzRatio button')) x.classList.remove('active');
        b.classList.add('active');
        redraw();
      });
    }

    const keep = overlay.querySelector<HTMLInputElement>('#wzKeep')!;
    keep.checked = params.keepBackground;
    keep.addEventListener('change', () => (params.keepBackground = keep.checked));

    const thick = overlay.querySelector<HTMLInputElement>('#wzThick')!;
    thick.value = String(params.thicknessMm);
    thick.addEventListener('input', () => (params.thicknessMm = +thick.value || 1));

    let raf = 0;
    const scheduleRedraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(redraw);
    };
    for (const [k] of SLIDERS) {
      const range = overlay.querySelector<HTMLInputElement>(`input[data-k="${k}"]`)!;
      const num = overlay.querySelector<HTMLInputElement>(`input[data-n="${k}"]`)!;
      range.value = num.value = String(params[k]);
      const apply = (v: number) => {
        (params[k] as number) = v;
        range.value = num.value = String(v);
        scheduleRedraw();
      };
      range.addEventListener('input', () => apply(+range.value));
      num.addEventListener('input', () => apply(+num.value));
    }

    overlay.querySelector('#wzCancel')!.addEventListener('click', cancel);
    overlay.querySelector('#wzNext')!.addEventListener('click', stepConversion);
  }

  // ---------- Step 2: conversion preview ----------
  function stepConversion() {
    overlay.innerHTML = `
      <div class="wz-modal">
        <div class="wz-head">Image Conversion Preview</div>
        <div class="wz-body center">
          <div class="wz-canvas checker big" id="wzConv"></div>
        </div>
        <div class="wz-foot">
          <button id="wzBack">↻ Try Again</button>
          <button class="primary" id="wzNext">Confirm</button>
        </div>
      </div>`;
    overlay.querySelector('#wzConv')!.appendChild(imageToCanvas(processed()));
    overlay.querySelector('#wzBack')!.addEventListener('click', stepPreprocess);
    overlay.querySelector('#wzNext')!.addEventListener('click', stepMatching);
  }

  // ---------- Step 3: auto matching ----------
  function stepMatching() {
    overlay.innerHTML = `
      <div class="wz-modal">
        <div class="wz-head">Auto Matching</div>
        <div class="wz-body col">
          <div class="seg center" id="wzCount">
            ${[4, 8, 12].map((n) => `<button data-n="${n}">${n} Color</button>`).join('')}
          </div>
          <div class="wz-sub">Colors are automatically matched to the chosen number.<br/>You can re-match them manually later.</div>
          <div class="wz-canvas checker" id="wzMatchPrev"></div>
          <div class="wz-chips" id="wzChips"></div>
        </div>
        <div class="wz-foot">
          <button id="wzCancel">Cancel</button>
          <button class="primary" id="wzDone">Confirm</button>
        </div>
      </div>`;

    const proc = processed();
    overlay.querySelector('#wzMatchPrev')!.appendChild(imageToCanvas(proc));

    const renderChips = () => {
      const q = quantize({ data: new Uint8ClampedArray(proc.data), width: proc.width, height: proc.height }, colorCount);
      const chips = overlay.querySelector<HTMLElement>('#wzChips')!;
      chips.innerHTML = q.palette
        .map((p, i) => {
          const hex =
            '#' + p.rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
          return `<span class="wz-chip"><span class="dot" style="background:${hex}"></span>→<span class="slot">${i + 1}</span></span>`;
        })
        .join('');
    };

    for (const b of overlay.querySelectorAll<HTMLElement>('#wzCount button')) {
      b.classList.toggle('active', +b.dataset.n! === colorCount);
      b.addEventListener('click', () => {
        colorCount = +b.dataset.n!;
        for (const x of overlay.querySelectorAll('#wzCount button')) x.classList.remove('active');
        b.classList.add('active');
        renderChips();
      });
    }
    renderChips();

    overlay.querySelector('#wzCancel')!.addEventListener('click', cancel);
    overlay.querySelector('#wzDone')!.addEventListener('click', () => {
      close();
      opts.onComplete({ adjusted: adjusted(), preprocess: { ...params }, colorCount });
    });
  }

  stepPreprocess();
}
