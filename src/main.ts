import './style.css';
import { createStore } from './store/store';
import { createViewer } from './viewer/viewer';
import { createUi, type UiState } from './ui/ui';
import { loadFileToImage, type RgbaImage } from './image/decode';
import { processImage } from './image/pipeline';
import { runWizard } from './ui/wizard';
import { downloadThreeMF } from './export/threemfExport';
import { parseSvg } from './image/logo';
import { SAMPLES, SVG_SAMPLES } from './image/sample';
import { parseLetter, importFontFile } from './image/letter';
import { LUCIDE_ICONS, buildSvg } from './image/lucideIcons';
import type {
  BuildParams,
  BuildRegion,
  ClickerPart,
  EdgeStyle,
  GeometryResponse,
  PaletteEntry,
  RegionSet,
  RGB,
} from './types';
import { FILAMENTS } from './types';

// Start fetching switch assets immediately at startup to run in parallel with worker setup
const base = import.meta.env.BASE_URL;
const assetsPromise = Promise.all([
  fetch(base + 'assets/switch/mx/mx-socket.3mf').then((r) => r.arrayBuffer()),
  fetch(base + 'assets/switch/mx/mx-stem.3mf').then((r) => r.arrayBuffer()),
  fetch(base + 'assets/switch/mx/mx-switch.3mf').then((r) => r.arrayBuffer()),
]).catch((err) => {
  console.error('[assets] Pre-fetch failed:', err);
  throw err;
});

/** Which editable color a clicked model part maps back to. */
type ColorTarget = { kind: 'region'; index: number; compIndex: number } | { kind: 'body' } | { kind: 'base' };

// ---- State (UI-facing) ----
const store = createStore<UiState>({
  status: 'Loading switch assets…',
  building: false,
  hasParts: false,
  colorCount: 4,
  palette: [],
  baseShape: 'outline',
  capWidthMm: 35,
  topThickness: 1.5,
  imageDepth: 0.8,
  tolerance: 0.4,
  smoothing: 0.1,
  keychain: false,
  removeBg: true,
  view: 'exploded',
  showSwitch: true,
  importMode: 'image', // Land on the Image tab by default
  currentIconName: 'circle',
  colorMode: 'normal',
  limitedColors: [],
  bodyColorRgb: [240, 240, 240] as RGB,
  paletteOverrides: [],
  baseColorOverride: null,
  partOverrides: {},
  editMode: 'color',
  edgeSettings: [
    { target: 'capTop', style: 'none', radius: 0 },
    { target: 'baseTop', style: 'none', radius: 0 },
    { target: 'baseBottom', style: 'none', radius: 0 },
  ],
  extrudeHeight: null,
  componentHeights: {},
  selectedParts: [],
});

// ---- Heavy data kept out of the reactive store ----
let originalImage: RgbaImage | null = null; // pristine decode (never mutated)
let regionSet: RegionSet | null = null;
let latestParts: ClickerPart[] = [];
let assetsReady = false;

// Vector states
let currentSvgText = '';
let currentSvgName = '';
let currentIconText = '';
let currentIconName = '';
let currentText = 'Custom\nText';
let currentFontId = 'helvetiker-regular';
let isInitialLoad = true;

const hasImage = () => originalImage !== null;
function cloneImage(img: RgbaImage): RgbaImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

// ---- DOM / subsystems ----
const sidebarLeft = document.getElementById('sidebar-left')!;
const sidebarRight = document.getElementById('sidebar-right')!;
const statusEl = document.getElementById('status')!;
const viewer = createViewer(document.getElementById('app')!);

// ---- Apply initial theme (system pref or saved preference) ----
(function applyInitialTheme() {
  const saved = localStorage.getItem('clicker-theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved ?? (systemDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  viewer.setTheme(theme);
})();

const ui = createUi(sidebarLeft, sidebarRight, statusEl, {
  onUpload: (file) => openWizard(() => loadFileToImage(file)),
  onSample: (load) => openWizard(load),
  onColorCount: (n) => {
    store.set({ colorCount: n });
    debouncedReprocess();
  },
  onFilament: (i, hex) => {
    const palette = store.get().palette.slice();
    if (palette[i]) {
      palette[i] = { ...palette[i], filamentRgb: hexToRgb(hex) };
      store.set({ palette });
      
      const overrides = store.get().paletteOverrides.slice();
      overrides[i] = hexToRgb(hex);
      store.set({ paletteOverrides: overrides });

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
    if (store.get().importMode === 'image' && hasImage()) debouncedReprocess();
  },
  onRemoveBg: (on) => {
    store.set({ removeBg: on });
    if (store.get().importMode === 'image' && hasImage()) reprocess();
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
  onBodyColor: (hex) => {
    store.set({ bodyColorRgb: hexToRgb(hex) });
    debouncedRebuild();
  },

  onImportMode: (mode) => {
    const s = store.get();
    store.set({
      importMode: mode,
      baseShape: mode === 'text' ? 'outline' : s.baseShape,
      colorMode: mode !== 'image' ? 'normal' : s.colorMode,
    });
    reprocess();
  },
  onSvgUpload: async (file) => {
    try {
      store.set({ building: true, status: 'Reading SVG…' });
      const svgText = await file.text();
      ui.addUploadedSvg(svgText, file.name.replace(/\.svg$/i, ''));
      store.set({ building: false });
    } catch (err) {
      store.set({ building: false, status: 'Error reading SVG: ' + String(err) });
    }
  },
  onSelectSvg: (svgText, name) => {
    currentSvgText = svgText;
    currentSvgName = name;
    store.set({ status: `Selected SVG: ${name}. Click Generate to update.` });
  },
  onSelectIcon: (svgText, name) => {
    currentIconText = svgText;
    currentIconName = name;
    store.set({ currentIconName: name, status: `Selected icon: ${name}. Click Generate to update.` });
  },
  onTextChange: (text) => {
    currentText = text;
    store.set({ status: 'Text updated. Click Generate to update.' });
  },
  onFontSelect: (fontId) => {
    currentFontId = fontId;
    store.set({ status: 'Font changed. Click Generate to update.' });
  },
  onImportFont: async (file) => {
    try {
      store.set({ building: true, status: 'Importing font…' });
      const font = await importFontFile(file);
      ui.addFontOption(font);
      currentFontId = font.id;
      store.set({ building: false, status: `Font ${font.name} imported! Click Generate to update.` });
    } catch (err) {
      store.set({ building: false, status: 'Could not import font: ' + String(err) });
    }
  },
  onThemeChange: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('clicker-theme', theme);
    viewer.setTheme(theme);
  },
  onGenerate: () => {
    reprocess();
  },
  onEditMode: (mode) => {
    store.set({ editMode: mode });
    viewer.setEditMode(mode);
    // When leaving extrude mode, sync the geometry to match the visual preview
    if (mode !== 'extrude') {
      debouncedRebuild();
    }
  },
  onEdgeStyle: (target: string, style: EdgeStyle) => {
    const s = store.get();
    const edgeSettings = [...s.edgeSettings];
    const idx = edgeSettings.findIndex(x => x.target === target);
    if (idx >= 0) {
      edgeSettings[idx] = { ...edgeSettings[idx], style };
    } else {
      edgeSettings.push({ target, style, radius: 1.0 });
    }
    store.set({ edgeSettings });
  },
  onEdgeStep: (target: string, delta: number) => {
    const s = store.get();
    const edgeSettings = [...s.edgeSettings];
    const idx = edgeSettings.findIndex(x => x.target === target);
    const current = idx >= 0 ? edgeSettings[idx].radius : 1.0;
    const next = Math.max(0.2, Math.min(5.0, current + delta));
    if (idx >= 0) {
      edgeSettings[idx] = { ...edgeSettings[idx], radius: next };
    } else {
      edgeSettings.push({ target, style: 'fillet', radius: next });
    }
    store.set({ edgeSettings });
  },
  onExtrudeStep: (delta: number) => {
    const s = store.get();
    if (s.selectedParts.length === 0) return;
    const componentHeights = { ...s.componentHeights };
    let changed = false;
    for (const partName of s.selectedParts) {
      const current = componentHeights[partName] ?? 0;
      const next = Math.max(-5, Math.min(6, current + delta));
      if (current !== next) {
        componentHeights[partName] = next;
        changed = true;
      }
    }
    if (changed) {
      store.set({ componentHeights });
      viewer.setComponentHeights(componentHeights, 0.6); // 0.6mm step
    }
  }
});

store.subscribe((s) => ui.update(s));
ui.update(store.get());

// Load heart sample on startup
SAMPLES[0].load().then((img) => {
  originalImage = img;
  if (assetsReady) {
    reprocess();
  }
}).catch((err) => {
  console.error('Failed to load default heart image', err);
});

// ---- Click a colored region on the 3D model to recolor it (live, no rebuild) ----
viewer.onPartPick((index, clientX, clientY, shiftKey) => {
  const s = store.get();
  
  if (index === null) {
    if (s.editMode !== 'color') store.set({ selectedParts: [] });
    return;
  }

  if (s.editMode !== 'color') {
    // Sync the selected parts to UI state for the Edge panel
    // We get the selected indices implicitly from the viewer, but we need to track them by name
    const partName = latestParts[index]?.name;
    if (partName) {
      let nextSelected = s.selectedParts.slice();
      if (shiftKey) {
        if (nextSelected.includes(partName)) {
          nextSelected = nextSelected.filter(p => p !== partName);
        } else {
          nextSelected.push(partName);
        }
      } else {
        nextSelected = [partName];
      }
      store.set({ selectedParts: nextSelected });
    }
    return;
  }

  const part = latestParts[index];
  if (!part) return;
  const target = partColorTarget(part.name);
  if (!target) return;

  const options: RGB[] =
    s.colorMode === 'limited' && s.limitedColors.length > 0
      ? s.limitedColors
      : FILAMENTS.map(([, hex]) => hexToRgb(hex));
  ui.showColorPopoverAt(clientX, clientY, rgbToHex(part.colorRgb), options, {
    onSelect: (hex) => applyModelRecolor(target, hexToRgb(hex), index),
    onClose: () => viewer.clearHighlight(),
  });
});

function partColorTarget(name: string): ColorTarget | null {
  if (name === 'base-body') return { kind: 'body' };
  if (name === 'top-base') return { kind: 'base' };
  const m = /^top-color-(\d+)(?:-(\d+))?$/.exec(name);
  if (m) {
    return { kind: 'region', index: +m[1], compIndex: m[2] ? +m[2] : 0 };
  }
  return null;
}

// --- Edit Mode Event Hooks (Gizmo Drag Handlers Removed) ---

// Apply a recolor to the clicked part: update the live material + export data, and
// persist into store state so it survives rebuilds. Geometry is identical for a
// color change, so we deliberately skip the worker rebuild.
function applyModelRecolor(target: ColorTarget, rgb: RGB, partIndex: number) {
  viewer.setPartColor(partIndex, rgb);
  if (latestParts[partIndex]) latestParts[partIndex] = { ...latestParts[partIndex], colorRgb: rgb };

  const s = store.get();
  if (target.kind === 'region') {
    const partName = `top-color-${target.index}-${target.compIndex}`;
    const overrides = s.partOverrides ? { ...s.partOverrides } : {};
    overrides[partName] = rgb;
    store.set({ partOverrides: overrides });
    syncBaseColor(); // the cap frame mirrors the dominant region — keep it in step
  } else if (target.kind === 'body') {
    store.set({ bodyColorRgb: rgb });
  } else {
    store.set({ baseColorOverride: rgb });
  }
}

// ---- Cap frame / backing color ----
const LIGHT_FRAME: RGB = [240, 240, 240];
const DARK_FRAME: RGB = [38, 38, 42];

function relLuminance(rgb: RGB): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
// A light or dark backing chosen to contrast the given ink, so a single-color design
// is always visible against it.
function contrastingFrame(ink: RGB): RGB {
  return relLuminance(ink) > 150 ? DARK_FRAME : LIGHT_FRAME;
}

function dominantInk(s: UiState): RGB {
  if (s.palette.length === 0) return [180, 180, 185];
  let domIdx = 0;
  for (let i = 1; i < s.palette.length; i++) {
    if (s.palette[i].coverage > s.palette[domIdx].coverage) domIdx = i;
  }
  return s.palette[domIdx]?.filamentRgb ?? [180, 180, 185];
}

// The cap backing/frame color. A photographic IMAGE tiles the whole cap, so the frame
// mirrors its dominant region and blends in naturally. Line-art modes (icon/svg/text)
// are typically a single ink — mirroring that ink would make the design vanish into
// its own backing (the "svg comes out one color" bug), so we pick a contrasting frame
// instead. The design then reads clearly without any manual recolor.
function deriveFrameColor(s: UiState): RGB {
  const ink = dominantInk(s);
  return s.importMode === 'image' ? ink : contrastingFrame(ink);
}

// After a region recolor, repaint the frame part to match the derived color — live, no
// rebuild — so it never lags a frame behind the inlay it shares a color with.
function syncBaseColor() {
  const s = store.get();
  if (s.baseColorOverride || s.palette.length === 0) return;
  const baseRgb = deriveFrameColor(s);
  const bi = latestParts.findIndex((p) => p.name === 'top-base');
  if (bi >= 0) {
    latestParts[bi] = { ...latestParts[bi], colorRgb: baseRgb };
    viewer.setPartColor(bi, baseRgb);
  }
}

// Seed the SVG panel with bundled vector presets (added quietly, not selected).
(async function loadSvgSamples() {
  for (const sample of SVG_SAMPLES) {
    try {
      const svgText = await fetch(sample.src).then((r) => r.text());
      ui.addUploadedSvg(svgText, sample.name, false);
    } catch (err) {
      console.warn('Could not load SVG sample', sample.name, err);
    }
  }
})();

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
        status: 'Ready — import an image, SVG, icon, or text.',
      });
      // Pick a default popular icon on startup so it builds immediately
      if (store.get().importMode === 'icon' && !currentIconText) {
        const first = LUCIDE_ICONS.find((ic) => ic.name === 'circle') || LUCIDE_ICONS[0];
        if (first) {
          currentIconText = buildSvg(first.node);
          currentIconName = first.name;
          store.set({ currentIconName: first.name });
        }
      }
      reprocess();
      break;
    case 'parts': {
      latestParts = msg.parts;
      viewer.setParts(msg.parts);
      viewer.setView(store.get().view);
      store.set({
        building: false,
        hasParts: msg.parts.length > 0,
        status: '', // Clear the banner when ready
      });
      isInitialLoad = false;
      break;
    }
    case 'error':
      store.set({ building: false, status: 'Error: ' + firstLine(msg.message) });
      console.error('[geometry worker]', msg.message);
      isInitialLoad = false;
      break;
  }
};
worker.onerror = (e) => {
  store.set({ building: false, status: 'Worker failed: ' + e.message });
  console.error(e);
};

async function initAssets() {
  try {
    const [socket, stem, sw] = await assetsPromise;
    worker.postMessage({ type: 'init', socket, stem, switch: sw }, [socket, stem, sw]);
  } catch (err) {
    store.set({ status: 'Failed to load switch assets: ' + String(err) });
    isInitialLoad = false;
  }
}

// ---- Pipeline ----
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
      onComplete: ({ adjusted, preprocess, colorCount, colorMode, limitedColors, paletteOverrides }) => {
        originalImage = adjusted;
        let defaultBodyColor = store.get().bodyColorRgb;
        if (colorMode === 'limited' && limitedColors && limitedColors.length > 0) {
          const blackHex = '#161616';
          const blackRgb = hexToRgb(blackHex);
          const hasBlack = limitedColors.some(c => c[0] === blackRgb[0] && c[1] === blackRgb[1] && c[2] === blackRgb[2]);
          defaultBodyColor = hasBlack ? blackRgb : limitedColors[0];
        }
        store.set({
          removeBg: !preprocess.keepBackground,
          colorCount,
          topThickness: Math.max(1, preprocess.thicknessMm),
          colorMode,
          limitedColors: limitedColors || [],
          bodyColorRgb: defaultBodyColor,
          paletteOverrides: paletteOverrides || [],
        });
        reprocess();
      },
    });
  } catch (err) {
    store.set({ building: false, status: 'Could not read image: ' + String(err) });
  }
}

function reprocess() {
  // A fresh trace means fresh regions — drop any pinned frame color so it re-derives.
  store.set({ baseColorOverride: null });
  const s = store.get();

  if (s.importMode === 'image') {
    if (!originalImage) return;
    store.set({ building: true, status: 'Removing background & tracing…' });
    regionSet = processImage(cloneImage(originalImage), s.colorCount, {
      removeBg: s.removeBg,
      smoothing: s.smoothing,
      customColors: s.colorMode === 'limited' ? s.limitedColors : undefined,
    });
  } else if (s.importMode === 'svg') {
    if (!currentSvgText) {
      store.set({ status: 'Upload an SVG file first.' });
      return;
    }
    try {
      store.set({ building: true, status: 'Parsing SVG…' });
      regionSet = parseSvg(currentSvgText);
    } catch (e: any) {
      store.set({ building: false, status: 'Error: ' + e.message });
      return;
    }
  } else if (s.importMode === 'icon') {
    if (!currentIconText) {
      const first = LUCIDE_ICONS.find((ic) => ic.name === 'circle') || LUCIDE_ICONS[0];
      if (first) {
        currentIconText = buildSvg(first.node);
        currentIconName = first.name;
        store.set({ currentIconName: first.name });
      }
    }
    if (!currentIconText) {
      store.set({ status: 'Select an icon first.' });
      return;
    }
    try {
      store.set({ building: true, status: 'Parsing Icon…' });
      regionSet = parseSvg(currentIconText);
    } catch (e: any) {
      store.set({ building: false, status: 'Error: ' + e.message });
      return;
    }
  } else if (s.importMode === 'text') {
    try {
      store.set({ building: true, status: 'Generating Text…' });
      regionSet = parseLetter(currentText, currentFontId, 15);
    } catch (e: any) {
      store.set({ building: false, status: 'Error: ' + e.message });
      return;
    }
  }

  if (!regionSet) return;

  const palette: PaletteEntry[] = regionSet.regions.map((r, i) => ({
    quantRgb: r.quantRgb,
    filamentRgb: s.paletteOverrides[i] ?? r.quantRgb,
    coverage: r.coverage,
  }));
  store.set({ palette });

  if (palette.length === 0) {
    store.set({ building: false, status: 'No outline found.' });
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

  const regions: BuildRegion[] = [];
  regionSet.regions.forEach((r, i) => {
    const baseColor = s.palette[i]?.filamentRgb ?? r.quantRgb;
    r.components.forEach((comp, j) => {
      const partName = `top-color-${i}-${j}`;
      regions.push({
        filamentRgb: s.partOverrides?.[partName] ?? baseColor,
        coverage: r.coverage, // Use the parent coverage for priority
        rings: comp.rings,
        partName,
      });
    });
  });

  // Icons are line-art (a single-color silhouette), not a multi-color picture.
  // Using their thin stroke as the body outline makes a broken ring, so the body
  // is always a solid shape (circle/square) and the icon rides on top as a design.
  const isIcon = s.importMode === 'icon';
  const effectiveBaseShape = isIcon && s.baseShape === 'outline' ? 'circle' : s.baseShape;
  // The cap backing contrasts line-art designs so they stay visible (see
  // deriveFrameColor). A frame the user pinned by clicking the model wins over it.
  const capBaseColor: RGB = s.baseColorOverride ?? deriveFrameColor(s);

  const isText = s.importMode === 'text';
  const params: BuildParams = {
    baseShape: effectiveBaseShape,
    capWidthMm: s.capWidthMm,
    topThickness: Math.max(1, s.topThickness),
    imageDepth: s.imageDepth,
    imageMargin: isText ? 2.5 : 1.2,
    borderWidth: isText ? 3.5 : 2.6,
    capProud: 4.0,
    tolerance: s.tolerance,
    colorBleed: 0.12,
    stepHeight: 0.6,
    travel: 4.0,
    floorThickness: 1.6,
    keychainHole: s.keychain,
    baseFilamentRgb: capBaseColor,
    bodyColorRgb: s.bodyColorRgb ?? ([120, 124, 130] as RGB),
    edgeSettings: s.edgeSettings,
    componentHeights: s.componentHeights,
  };

  if (isInitialLoad) {
    store.set({ status: 'Building clicker…' });
  } else {
    store.set({ building: true, status: 'Building clicker…' });
  }
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
function rgbToHex(rgb: RGB): string {
  return (
    '#' +
    rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
  );
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
    version: 2,
    settings: {
      colorCount: s.colorCount,
      baseShape: s.baseShape,
      capWidthMm: s.capWidthMm,
      topThickness: s.topThickness,
      imageDepth: s.imageDepth,
      tolerance: s.tolerance,
      smoothing: s.smoothing,
      removeBg: s.removeBg,
      importMode: s.importMode,
      currentText,
      currentFontId,
      currentSvgText,
      currentSvgName,
      currentIconText,
      currentIconName,
      colorMode: s.colorMode,
      limitedColors: s.limitedColors,
      bodyColorRgb: s.bodyColorRgb,
      paletteOverrides: s.paletteOverrides,
      baseColorOverride: s.baseColorOverride,
      partOverrides: s.partOverrides,
      edgeSettings: s.edgeSettings,
      componentHeights: s.componentHeights,
    },
    palette: s.palette, // filament mappings
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

    currentText = set.currentText ?? 'Custom\nText';
    currentFontId = set.currentFontId ?? 'helvetiker-regular';
    currentSvgText = set.currentSvgText ?? '';
    currentSvgName = set.currentSvgName ?? '';
    currentIconText = set.currentIconText ?? '';
    currentIconName = set.currentIconName ?? '';

    if (currentSvgText && currentSvgName) {
      ui.addUploadedSvg(currentSvgText, currentSvgName);
    }

    store.set({
      importMode: set.importMode ?? 'image',
      colorCount: set.colorCount ?? store.get().colorCount,
      baseShape: set.baseShape ?? store.get().baseShape,
      capWidthMm: set.capWidthMm ?? store.get().capWidthMm,
      topThickness: set.topThickness ?? store.get().topThickness,
      imageDepth: set.imageDepth ?? store.get().imageDepth,
      tolerance: set.tolerance ?? store.get().tolerance,
      smoothing: set.smoothing ?? store.get().smoothing,
      removeBg: set.removeBg ?? store.get().removeBg,
      currentIconName: currentIconName || 'circle',
      colorMode: set.colorMode ?? 'normal',
      limitedColors: set.limitedColors ?? [],
      bodyColorRgb: set.bodyColorRgb ?? [120, 124, 130],
      paletteOverrides: set.paletteOverrides ?? [],
      partOverrides: set.partOverrides ?? {},
      edgeSettings: set.edgeSettings ?? store.get().edgeSettings,
      componentHeights: set.componentHeights ?? {},
    });

    if (set.importMode === 'image' && proj.image) {
      originalImage = await dataUrlToImage(proj.image);
    }

    reprocess();

    if (Array.isArray(proj.palette)) {
      const pal = store.get().palette.map((p, i) => ({
        ...p,
        filamentRgb: proj.palette[i]?.filamentRgb ?? p.filamentRgb,
      }));
      store.set({ palette: pal, baseColorOverride: set.baseColorOverride ?? null });
      rebuild();
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
