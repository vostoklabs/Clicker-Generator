import './style.css';
import { createStore } from './store/store';
import { createViewer } from './viewer/viewer';
import { createUi, type UiState } from './ui/ui';
import { loadFileToImage, type RgbaImage } from './image/decode';
import { makeSampleImage } from './image/sample';
import { processImage } from './image/pipeline';
import { runWizard } from './ui/wizard';
import { downloadThreeMF } from './export/threemfExport';
import type {
  BuildParams,
  BuildRegion,
  ClickerPart,
  GeometryResponse,
  PaletteEntry,
  RegionSet,
  RGB,
} from './types';

// ---- State (UI-facing) ----
const store = createStore<UiState>({
  status: 'Loading switch assets…',
  building: false,
  hasParts: false,
  colorCount: 4,
  palette: [],
  baseShape: 'outline',
  capWidthMm: 40,
  topThickness: 1.5,
  imageDepth: 0.8,
  tolerance: 0.4,
  smoothing: 0.65,
  keychain: false,
  removeBg: true,
  view: 'assembled',
  showSwitch: false,
});

// ---- Heavy data kept out of the reactive store ----
let originalImage: RgbaImage | null = null; // pristine decode (never mutated)
let regionSet: RegionSet | null = null;
let latestParts: ClickerPart[] = [];
let assetsReady = false;

const hasImage = () => originalImage !== null;
function cloneImage(img: RgbaImage): RgbaImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

// ---- DOM / subsystems ----
const sidebar = document.getElementById('sidebar')!;
const statusEl = document.getElementById('status')!;
const viewer = createViewer(document.getElementById('app')!);

const ui = createUi(sidebar, statusEl, {
  onUpload: (file) => openWizard(() => loadFileToImage(file)),
  onSample: () => openWizard(async () => makeSampleImage()),
  onColorCount: (n) => {
    store.set({ colorCount: n });
    debouncedReprocess();
  },
  onFilament: (i, hex) => {
    const palette = store.get().palette.slice();
    if (palette[i]) {
      palette[i] = { ...palette[i], filamentRgb: hexToRgb(hex) };
      store.set({ palette });
      debouncedRebuild();
    }
  },
  onHeight: (i, level) => {
    const palette = store.get().palette.slice();
    if (palette[i]) {
      palette[i] = { ...palette[i], heightLevel: Math.max(0, Math.min(6, level)) };
      store.set({ palette });
      debouncedRebuild();
    }
  },
  onShape: (kind) => {
    store.set({ baseShape: kind });
    debouncedRebuild();
  },
  onWidth: (mm) => {
    store.set({ capWidthMm: mm });
    debouncedRebuild();
  },
  onTopThickness: (mm) => {
    store.set({ topThickness: mm });
    debouncedRebuild();
  },
  onImageDepth: (mm) => {
    store.set({ imageDepth: mm });
    debouncedRebuild();
  },
  onTolerance: (mm) => {
    store.set({ tolerance: mm });
    debouncedRebuild();
  },
  onKeychain: (on) => {
    store.set({ keychain: on });
    debouncedRebuild();
  },
  onSmoothing: (v) => {
    store.set({ smoothing: v });
    if (hasImage()) debouncedReprocess();
  },
  onRemoveBg: (on) => {
    store.set({ removeBg: on });
    if (hasImage()) reprocess();
  },
  onView: (mode) => {
    store.set({ view: mode });
    viewer.setView(mode);
  },
  onShowSwitch: (on) => {
    store.set({ showSwitch: on });
    viewer.showSwitch(on);
  },
  onSection: (axis, pos) => viewer.setSection(axis, pos),
  onExport: () => {
    if (latestParts.length) downloadThreeMF(latestParts, 'clicker.3mf');
  },
  onRenderPng: async () => {
    const blob = await viewer.renderToPng();
    if (blob) downloadBlob(blob, 'clicker-render.png');
  },
  onAiPrompt: async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      store.set({ status: 'AI image prompt copied to clipboard ✓' });
    } catch {
      store.set({ status: 'Could not copy — see console.' });
      console.log(AI_PROMPT);
    }
  },
  onSaveProject: () => saveProject(),
  onLoadProject: (file) => loadProject(file),
});

store.subscribe((s) => ui.update(s));
ui.update(store.get());

// ---- Geometry worker ----
const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), {
  type: 'module',
});

worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'ready':
      initAssets();
      break;
    case 'initDone':
      assetsReady = true;
      console.log('[assets] socket:', msg.socketInfo, '| stem:', msg.stemInfo, '| switch:', msg.switchInfo);
      viewer.setSwitch(msg.switchMesh);
      viewer.showSwitch(store.get().showSwitch);
      store.set({
        status: regionSet ? 'Building clicker…' : 'Ready — drop an image or try the sample.',
      });
      if (regionSet) rebuild();
      break;
    case 'parts':
      latestParts = msg.parts;
      viewer.setParts(msg.parts);
      viewer.setView(store.get().view);
      store.set({
        building: false,
        hasParts: msg.parts.length > 0,
        status: `Clicker ready ✓  ${msg.parts.length} parts. Orbit to inspect, then Download 3MF.`,
      });
      break;
    case 'error':
      store.set({ building: false, status: 'Error: ' + firstLine(msg.message) });
      console.error('[geometry worker]', msg.message);
      break;
  }
};
worker.onerror = (e) => {
  store.set({ building: false, status: 'Worker failed: ' + e.message });
  console.error(e);
};

async function initAssets() {
  try {
    const base = import.meta.env.BASE_URL;
    const [socket, stem, sw] = await Promise.all([
      fetch(base + 'assets/switch/mx/mx-socket.3mf').then((r) => r.arrayBuffer()),
      fetch(base + 'assets/switch/mx/mx-stem.3mf').then((r) => r.arrayBuffer()),
      fetch(base + 'assets/switch/mx/mx-switch.3mf').then((r) => r.arrayBuffer()),
    ]);
    worker.postMessage({ type: 'init', socket, stem, switch: sw }, [socket, stem, sw]);
  } catch (err) {
    store.set({ status: 'Failed to load switch assets: ' + String(err) });
  }
}

// ---- Pipeline ----
// Decode, then open the Bambu-style preprocessing wizard. The wizard hands back
// the cropped+adjusted image (background intact); we commit it and run the build.
async function openWizard(getter: () => Promise<RgbaImage>) {
  try {
    store.set({ building: true, status: 'Reading image…' });
    const baseImage = await getter();
    store.set({ building: false, status: 'Preprocess your image…' });
    runWizard({
      baseImage,
      initialColorCount: store.get().colorCount,
      onCancel: () =>
        store.set({ status: originalImage ? 'Ready.' : 'Ready — drop an image or try the sample.' }),
      onComplete: ({ adjusted, preprocess, colorCount }) => {
        originalImage = adjusted;
        store.set({
          removeBg: !preprocess.keepBackground,
          colorCount,
          topThickness: Math.max(1, preprocess.thicknessMm),
        });
        reprocess();
      },
    });
  } catch (err) {
    store.set({ building: false, status: 'Could not read image: ' + String(err) });
  }
}

function reprocess() {
  if (!originalImage) return;
  const s = store.get();
  store.set({ building: true, status: 'Removing background & tracing…' });
  // Work on a fresh copy so the background toggle is reversible.
  regionSet = processImage(cloneImage(originalImage), s.colorCount, {
    removeBg: s.removeBg,
    smoothing: s.smoothing,
  });

  const palette: PaletteEntry[] = regionSet.regions.map((r) => ({
    quantRgb: r.quantRgb,
    filamentRgb: r.quantRgb,
    coverage: r.coverage,
    heightLevel: 0,
  }));
  store.set({ palette });

  if (palette.length === 0) {
    store.set({ building: false, status: 'No subject found — try a PNG with transparency or toggle background removal.' });
    return;
  }
  rebuild();
}

function rebuild() {
  if (!regionSet || regionSet.regions.length === 0) return;
  if (!assetsReady) {
    store.set({ status: 'Waiting for switch assets…' });
    return;
  }
  const s = store.get();

  // Dominant color carries the slab + stem (the base filament).
  let domIdx = 0;
  for (let i = 1; i < s.palette.length; i++) {
    if (s.palette[i].coverage > s.palette[domIdx].coverage) domIdx = i;
  }

  const regions: BuildRegion[] = regionSet.regions.map((r, i) => ({
    filamentRgb: s.palette[i]?.filamentRgb ?? r.quantRgb,
    heightLevel: s.palette[i]?.heightLevel ?? 0,
    coverage: r.coverage,
    rings: r.rings,
  }));

  const params: BuildParams = {
    baseShape: s.baseShape,
    capWidthMm: s.capWidthMm,
    topThickness: Math.max(1, s.topThickness), // solid backing behind the image (≥1 mm)
    imageDepth: s.imageDepth, // how deep colors cut from the top
    imageMargin: 1.2, // flat base-color frame between image and cap edge
    borderWidth: 2.6, // raised body border (bezel) around the cap
    capProud: 4.0, // cap sticks up above the border by ≈ travel → flush when fully pressed
    tolerance: s.tolerance, // slip-fit between cap outer wall and body well wall
    colorBleed: 0.12, // tiny overlap so neighboring colors never leave a gap
    stepHeight: 0.6,
    travel: 4.0, // MX switch press travel
    floorThickness: 1.6,
    keychainHole: s.keychain,
    baseFilamentRgb: s.palette[domIdx]?.filamentRgb ?? ([180, 180, 185] as RGB),
    bodyColorRgb: [120, 124, 130] as RGB,
  };

  store.set({ building: true, status: 'Building clicker…' });
  worker.postMessage({ type: 'buildClicker', regions, outline: regionSet.outline, params });
}

// ---- Debounce ----
function debounce(fn: () => void, ms: number) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}
const debouncedRebuild = debounce(rebuild, 130);
const debouncedReprocess = debounce(reprocess, 220);

function hexToRgb(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
function firstLine(s: string): string {
  return s.split('\n')[0];
}

// ---- Render / project save-load / AI prompt ----
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imageToDataUrl(img: RgbaImage): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c.toDataURL('image/png');
}

function dataUrlToImage(url: string): Promise<RgbaImage> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      resolve({ data: d.data, width: c.width, height: c.height });
    };
    im.onerror = () => reject(new Error('bad image data'));
    im.src = url;
  });
}

function saveProject() {
  const s = store.get();
  const proj = {
    version: 1,
    settings: {
      colorCount: s.colorCount,
      baseShape: s.baseShape,
      capWidthMm: s.capWidthMm,
      topThickness: s.topThickness,
      imageDepth: s.imageDepth,
      tolerance: s.tolerance,
      smoothing: s.smoothing,
      removeBg: s.removeBg,
    },
    palette: s.palette, // filament mappings + height levels
    image: originalImage ? imageToDataUrl(originalImage) : null,
  };
  downloadBlob(new Blob([JSON.stringify(proj)], { type: 'application/json' }), 'clicker-project.json');
  store.set({ status: 'Project saved ✓' });
}

async function loadProject(file: File) {
  try {
    store.set({ building: true, status: 'Loading project…' });
    const proj = JSON.parse(await file.text());
    const set = proj.settings ?? {};
    store.set({
      colorCount: set.colorCount ?? store.get().colorCount,
      baseShape: set.baseShape ?? store.get().baseShape,
      capWidthMm: set.capWidthMm ?? store.get().capWidthMm,
      topThickness: set.topThickness ?? store.get().topThickness,
      imageDepth: set.imageDepth ?? store.get().imageDepth,
      tolerance: set.tolerance ?? store.get().tolerance,
      smoothing: set.smoothing ?? store.get().smoothing,
      removeBg: set.removeBg ?? store.get().removeBg,
    });
    if (proj.image) {
      originalImage = await dataUrlToImage(proj.image);
      reprocess();
      // Re-apply saved filament/height mappings over the regenerated palette.
      if (Array.isArray(proj.palette)) {
        const pal = store.get().palette.map((p, i) => ({
          ...p,
          filamentRgb: proj.palette[i]?.filamentRgb ?? p.filamentRgb,
          heightLevel: proj.palette[i]?.heightLevel ?? p.heightLevel,
        }));
        store.set({ palette: pal });
        rebuild();
      }
    } else {
      store.set({ building: false, status: 'Project loaded (no image).' });
    }
  } catch (err) {
    store.set({ building: false, status: 'Could not load project: ' + String(err) });
  }
}

const AI_PROMPT = [
  'Create a simple, flat vector-style illustration suitable for a small multi-color 3D print.',
  'Requirements:',
  '- Bold, clean shapes with thick outlines; no gradients, no shading, no texture.',
  '- A small number of FLAT solid colors (4–6 max), each clearly separated.',
  '- Centered subject on a plain solid (or transparent) background.',
  '- High contrast between adjacent colors; avoid thin slivers and tiny details.',
  '- Square-ish framing, subject fills ~80% of the canvas.',
  'Subject: <describe your subject here>.',
].join('\n');
