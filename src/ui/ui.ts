// Sidebar UI. Plain DOM, no framework. Emits intent via callbacks; reflects
// state via update(). Color panel mirrors a filament-picker workflow: each
// detected color maps to a filament swatch + a height level (3D relief).
import type { BaseShapeKind, PaletteEntry, ViewMode } from '../types';
import type { SectionAxis } from '../viewer/viewer';
import { SAMPLES } from '../image/sample';
import type { RgbaImage } from '../image/decode';
import type { FontOption } from '../image/letter';
import { FONT_OPTIONS, loadBundledFonts } from '../image/letter';
import { LUCIDE_ICONS, buildSvg, svgDataUrl } from '../image/lucideIcons';

export interface UiState {
  status: string;
  building: boolean;
  hasParts: boolean;
  colorCount: number;
  palette: PaletteEntry[];
  baseShape: BaseShapeKind;
  capWidthMm: number;
  topThickness: number;
  imageDepth: number;
  tolerance: number;
  smoothing: number;
  keychain: boolean;
  removeBg: boolean;
  view: ViewMode;
  showSwitch: boolean;
  importMode: 'image' | 'svg' | 'icon' | 'text';
}

export interface UiCallbacks {
  onUpload(file: File): void;
  onSample(creator: () => RgbaImage): void;
  onColorCount(n: number): void;
  onSmoothing(v: number): void;
  onFilament(index: number, hex: string): void;
  onHeight(index: number, level: number): void;
  onShape(kind: BaseShapeKind): void;
  onWidth(mm: number): void;
  onTopThickness(mm: number): void;
  onImageDepth(mm: number): void;
  onTolerance(mm: number): void;
  onKeychain(on: boolean): void;
  onRemoveBg(on: boolean): void;
  onView(mode: ViewMode): void;
  onShowSwitch(on: boolean): void;
  onSection(axis: SectionAxis, pos: number): void;
  onExport(): void;
  onRenderPng(): void;
  onAiPrompt(): void;
  onSaveProject(): void;
  onLoadProject(file: File): void;

  // New callbacks for vector modes
  onImportMode(mode: 'image' | 'svg' | 'icon' | 'text'): void;
  onSvgUpload(file: File): void;
  onSelectSvg(svgText: string, name: string): void;
  onSelectIcon(svgText: string, name: string): void;
  onTextChange(text: string): void;
  onFontSelect(fontId: string): void;
  onImportFont(file: File): void;
}

// Real filament rolls (Bambu Basic-ish). Color slots are assigned from THIS
// palette only — no freeform RGB, since each color is a physical spool.
const FILAMENTS: [string, string][] = [
  ['Black', '#161616'],
  ['White', '#f7f7f5'],
  ['Gray', '#8c8c90'],
  ['Silver', '#cfd0d2'],
  ['Red', '#c8102e'],
  ['Orange', '#ff6a13'],
  ['Yellow', '#f5c518'],
  ['Green', '#00ae42'],
  ['Cyan', '#0086d6'],
  ['Blue', '#0a5cd5'],
  ['Purple', '#8e44ad'],
  ['Pink', '#e6398b'],
  ['Brown', '#7a5230'],
  ['Beige', '#d9c8a9'],
];

const POPULAR_LUCIDE = [
  // File & clipboard
  'copy', 'clipboard', 'clipboard-paste', 'scissors', 'trash-2', 'save',
  'file', 'files', 'folder', 'folder-open', 'archive', 'download', 'upload',
  // Edit
  'undo-2', 'redo-2', 'search', 'replace', 'eraser', 'pencil', 'type',
  'bold', 'italic', 'underline',
  // Navigation
  'home', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
  'corner-down-left', 'chevron-up', 'chevron-down',
  // Keys & input
  'keyboard', 'mouse', 'command', 'delete',
  // Media
  'play', 'pause', 'skip-back', 'skip-forward', 'volume-2', 'volume-x',
  'mic', 'mic-off', 'music', 'headphones',
  // Display / system
  'sun', 'moon', 'monitor', 'lock', 'unlock', 'eye', 'eye-off',
  'power', 'wifi', 'bluetooth', 'battery',
  // Apps
  'terminal', 'code', 'settings', 'bell', 'calendar', 'mail',
  'message-circle', 'phone', 'camera', 'image',
  // Symbols & fun
  'star', 'heart', 'bookmark', 'flag', 'check', 'x', 'plus', 'minus',
  'refresh-cw', 'rotate-cw', 'flame', 'zap', 'rocket', 'ghost', 'skull',
  'coffee', 'gamepad-2', 'trophy', 'crown',
];

const rgbHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

export function createUi(
  sidebarLeft: HTMLElement,
  sidebarRight: HTMLElement,
  statusEl: HTMLElement,
  cb: UiCallbacks
) {
  // Populate Left Sidebar (Settings + Preview)
  sidebarLeft.innerHTML = `
    <h1>Clicker Generator <span class="sub">vector/image → clicker</span></h1>

    <div class="section">
      <span class="label">Preview &amp; View</span>
      <div class="tabs" id="viewTabs" role="tablist" style="margin-bottom: 12px;">
        <button class="tab active" data-view="assembled" type="button">Assembled</button>
        <button class="tab" data-view="exploded" type="button">Exploded</button>
      </div>
      <div class="switch-row">
        <span class="switch-label">Show MX switch</span>
        <label class="toggle"><input id="showswitch" type="checkbox" /><span class="slider"></span></label>
      </div>
    </div>

    <div class="section">
      <span class="label">1 · Colors &amp; Smoothing</span>
      <div class="field" id="colorCountField">
        <label for="ccount">Colors</label>
        <select id="ccount">
          <option value="2">2 Colors</option>
          <option value="3">3 Colors</option>
          <option value="4">4 Colors</option>
          <option value="5">5 Colors</option>
          <option value="6">6 Colors</option>
          <option value="7">7 Colors</option>
          <option value="8">8 Colors</option>
          <option value="9">9 Colors</option>
          <option value="10">10 Colors</option>
          <option value="11">11 Colors</option>
          <option value="12">12 Colors</option>
        </select>
      </div>
      <div class="prow" id="smoothingField">
        <label for="smooth">Smoothing</label>
        <input type="range" id="smooth" min="0" max="1" step="0.05" />
        <span class="val" id="smoothVal"></span>
      </div>
      <div class="palette" id="palette">
        <div class="hint">Load an image/vector to pick colors.</div>
      </div>
    </div>

    <div class="section">
      <span class="label">2 · Shape &amp; Size</span>
      <div class="field">
        <label>Base style</label>
        <div class="tabs" id="shapeTypeTabs" role="tablist">
          <button class="tab" data-style="outline" type="button">Outline</button>
          <button class="tab" data-style="shape" type="button">Shape</button>
        </div>
      </div>
      <div class="field" id="shapeSelectField">
        <label for="shapeSelect">Shape geometry</label>
        <select id="shapeSelect">
          <option value="circle">Circle</option>
          <option value="square">Square</option>
        </select>
      </div>
      <div class="prow">
        <label for="width">Cap width</label>
        <input type="range" id="width" min="20" max="70" step="1" />
        <span class="val" id="widthVal"></span>
      </div>
      <div class="prow">
        <label for="topthick">Top thickness</label>
        <input type="range" id="topthick" min="1" max="4" step="0.1" />
        <span class="val" id="topthickVal"></span>
      </div>
      <div class="prow">
        <label for="imgdepth">Image depth</label>
        <input type="range" id="imgdepth" min="0.2" max="3" step="0.1" />
        <span class="val" id="imgdepthVal"></span>
      </div>
      <div class="prow">
        <label for="tol">Fit tolerance</label>
        <input type="range" id="tol" min="0.2" max="0.8" step="0.05" />
        <span class="val" id="tolVal"></span>
      </div>
      <div class="switch-row">
        <span class="switch-label">Keychain loop</span>
        <label class="toggle"><input id="keychain" type="checkbox" /><span class="slider"></span></label>
      </div>
    </div>
  `;

  // Populate Right Sidebar (Import, Export)
  sidebarRight.innerHTML = `
    <div class="section legend-section">
      <span class="label">Import Source</span>
      <div class="tabs four-tabs" id="importTabs" role="tablist">
        <button class="tab active" data-mode="image" type="button">Image</button>
        <button class="tab" data-mode="svg" type="button">SVG</button>
        <button class="tab" data-mode="icon" type="button">Icon</button>
        <button class="tab" data-mode="text" type="button">Text</button>
      </div>

      <!-- Image Panel -->
      <div id="imagePanel" class="mode-panel">
        <div class="drop" id="drop">
          Drop an image, or <u>click to browse</u><br/>
          <span style="font-size:10px; opacity:0.8; display:block; margin-top:4px;">PNG with transparency works best</span>
        </div>
        <input type="file" id="file" accept="image/*" hidden />
        <button class="secondary" id="sample" style="width:100%; margin-top:10px">Choose sample image</button>
        <div class="switch-row">
          <span class="switch-label">Remove background</span>
          <label class="toggle"><input id="removebg" type="checkbox" /><span class="slider"></span></label>
        </div>
      </div>

      <!-- SVG Panel -->
      <div id="svgPanel" class="mode-panel" hidden>
        <p class="hint-text">
          Drop or upload SVG vector files. Color paths will map to filament slots.
        </p>
        <div id="uploadGallery"></div>
        <label class="upload-cta">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload SVG file(s)
          <input id="svgUpload" type="file" accept=".svg,image/svg+xml" multiple />
        </label>
      </div>

      <!-- Icon Panel -->
      <div id="iconPanel" class="mode-panel" hidden>
        <div id="iconSearchWrap">
          <input id="iconSearch" type="search" placeholder="Search Lucide icons…" autocomplete="off" spellcheck="false" />
          <button id="iconSearchClear" type="button" aria-label="Clear search">×</button>
        </div>
        <div id="iconCount"></div>
        <div id="gallery"></div>
      </div>

      <!-- Text Panel -->
      <div id="letterPanel" class="mode-panel" hidden>
        <div class="field">
          <label for="letterText">Custom Text</label>
          <input id="letterText" type="text" value="A" maxlength="8" autocomplete="off" spellcheck="false" />
        </div>
        <div class="field">
          <label for="fontSelect">Font</label>
          <select id="fontSelect"></select>
          <label class="upload">
            + Import font
            <input id="fontUpload" type="file" accept=".ttf,.otf,.json,font/ttf,font/otf,application/json" />
          </label>
        </div>
      </div>
    </div>

    <div class="section">
      <span class="label">Export</span>
      <button class="primary" id="export" style="width:100%; margin-bottom:10px">Download 3MF</button>
      <div class="btn-row" style="margin-bottom:8px">
        <button id="render" class="secondary">Save render PNG</button>
        <button id="aiPrompt" class="secondary">AI prompt</button>
      </div>
      <div class="btn-row">
        <button id="saveProj" class="secondary">Save project</button>
        <button id="loadProj" class="secondary">Load project</button>
        <input type="file" id="projFile" accept="application/json" hidden />
      </div>
    </div>
  `;

  // Global ID helper
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  // --- Image ---
  const drop = $('drop');
  const file = $<HTMLInputElement>('file');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    if (file.files?.[0]) cb.onUpload(file.files[0]);
  });

  // Global drag & drop for the whole window
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.name.endsWith('.svg')) {
      cb.onSvgUpload(f);
    } else if (f.name.endsWith('.ttf') || f.name.endsWith('.otf') || f.name.endsWith('.json')) {
      cb.onImportFont(f);
    } else if (f.type.startsWith('image/')) {
      cb.onUpload(f);
    }
  });

  // Choose Sample Picker Modal
  $('sample').addEventListener('click', () => {
    const modal = document.createElement('div');
    modal.className = 'wz-overlay';
    modal.innerHTML = `
      <div class="wz-modal" style="width: 460px;">
        <div class="wz-head">Choose Sample Image</div>
        <div class="wz-body">
          <div class="sample-grid">
            ${SAMPLES.map((s, idx) => `
              <div class="sample-item" data-idx="${idx}">
                <canvas width="80" height="80" style="width: 80px; height: 80px;"></canvas>
                <span>${s.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="wz-foot">
          <button class="secondary" id="closeSampleModal" style="width: auto;">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    SAMPLES.forEach((s, idx) => {
      const item = modal.querySelector(`.sample-item[data-idx="${idx}"]`)!;
      const canvas = item.querySelector('canvas')!;
      const ctx = canvas.getContext('2d')!;
      const imgData = s.creator();
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imgData.width;
      tempCanvas.height = imgData.height;
      tempCanvas.getContext('2d')!.putImageData(
        new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height),
        0,
        0
      );
      ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    });

    modal.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.sample-item') as HTMLElement | null;
      if (item) {
        const idx = parseInt(item.dataset.idx!);
        cb.onSample(SAMPLES[idx].creator);
        modal.remove();
      }
    });

    modal.querySelector('#closeSampleModal')!.addEventListener('click', () => {
      modal.remove();
    });
  });

  $<HTMLInputElement>('removebg').addEventListener('change', (e) =>
    cb.onRemoveBg((e.target as HTMLInputElement).checked)
  );

  // --- SVG Panel Setup ---
  const svgUpload = $<HTMLInputElement>('svgUpload');
  svgUpload.addEventListener('change', () => {
    const f = svgUpload.files?.[0];
    if (f) cb.onSvgUpload(f);
    svgUpload.value = '';
  });

  const uploadGalleryEl = $('uploadGallery');
  let uploadEmptyEl: HTMLElement | null = null;
  function refreshUploadEmptyState() {
    const empty = uploadGalleryEl.querySelectorAll('.icon').length === 0;
    if (empty && !uploadEmptyEl) {
      uploadEmptyEl = document.createElement('div');
      uploadEmptyEl.id = 'uploadGalleryEmpty';
      uploadEmptyEl.textContent = 'No SVGs yet. Drop files or use the upload button.';
      uploadGalleryEl.appendChild(uploadEmptyEl);
    } else if (!empty && uploadEmptyEl) {
      uploadEmptyEl.remove();
      uploadEmptyEl = null;
    }
  }
  refreshUploadEmptyState();

  function makeIconEl(
    thumbUrl: string,
    name: string,
    onClick: (el: HTMLElement) => void
  ) {
    const el = document.createElement('div');
    el.className = 'icon';
    el.title = name;
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = name;
    el.appendChild(img);
    el.addEventListener('click', () => onClick(el));
    return el;
  }

  function addUploadedSvg(svgText: string, name: string) {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const el = makeIconEl(url, name, (clickedEl) => {
      uploadGalleryEl.querySelectorAll('.icon').forEach((n) => n.classList.remove('active'));
      clickedEl.classList.add('active');
      cb.onSelectSvg(svgText, name);
    });
    uploadGalleryEl.appendChild(el);
    refreshUploadEmptyState();
    el.click();
  }

  // --- Lucide Icon Panel Setup ---
  const galleryEl = $('gallery');
  const searchEl = $<HTMLInputElement>('iconSearch');
  const searchClearEl = $<HTMLButtonElement>('iconSearchClear');
  const countEl = $('iconCount');

  const GALLERY_PAGE = 240;
  let lucideShown = 0;
  let lucideMatches: any[] = [];
  let moreBtn: HTMLButtonElement | null = null;

  function rankLucide(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) {
      const popularSet = new Set(POPULAR_LUCIDE);
      const popular = POPULAR_LUCIDE
        .map((name) => LUCIDE_ICONS.find((ic) => ic.name === name))
        .filter(Boolean);
      const rest = LUCIDE_ICONS.filter((ic) => !popularSet.has(ic.name));
      return popular.concat(rest);
    }
    const out: { ic: any; rank: number }[] = [];
    for (const ic of LUCIDE_ICONS) {
      const i = ic.name.indexOf(q);
      if (i === -1) continue;
      const rank = ic.name === q ? 0 : i === 0 ? 1 : 2;
      out.push({ ic, rank });
    }
    out.sort((a, b) => a.rank - b.rank || a.ic.name.localeCompare(b.ic.name));
    return out.map((o) => o.ic);
  }

  function renderLucidePage() {
    if (moreBtn) {
      moreBtn.remove();
      moreBtn = null;
    }
    const end = Math.min(lucideShown + GALLERY_PAGE, lucideMatches.length);
    const frag = document.createDocumentFragment();
    for (let i = lucideShown; i < end; i++) {
      const ic = lucideMatches[i];
      const svgText = buildSvg(ic.node);
      const el = makeIconEl(svgDataUrl(svgText), ic.name, (clickedEl) => {
        galleryEl.querySelectorAll('.icon').forEach((n) => n.classList.remove('active'));
        clickedEl.classList.add('active');
        cb.onSelectIcon(svgText, ic.name);
      });
      frag.appendChild(el);
    }
    galleryEl.appendChild(frag);
    lucideShown = end;

    if (lucideShown < lucideMatches.length) {
      moreBtn = document.createElement('button');
      moreBtn.id = 'galleryMore';
      moreBtn.type = 'button';
      moreBtn.textContent = `Show ${Math.min(GALLERY_PAGE, lucideMatches.length - lucideShown)} more (${lucideMatches.length - lucideShown} hidden)`;
      moreBtn.addEventListener('click', renderLucidePage);
      galleryEl.appendChild(moreBtn);
    }
    updateCount();
  }

  function updateCount() {
    const total = lucideMatches.length;
    if (total === 0) {
      countEl.textContent = 'No icons match.';
    } else {
      const visible = Math.min(lucideShown, total);
      countEl.textContent = searchEl.value.trim()
        ? `${total} match${total === 1 ? '' : 'es'}` + (visible < total ? ` · showing ${visible}` : '')
        : `${total} icons` + (visible < total ? ` · showing ${visible}` : '');
    }
  }

  function rebuildGallery() {
    galleryEl.innerHTML = '';
    lucideShown = 0;
    lucideMatches = rankLucide(searchEl.value);
    searchClearEl.style.display = searchEl.value ? 'block' : 'none';
    renderLucidePage();
  }

  let searchTimer: number | null = null;
  searchEl.addEventListener('input', () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(rebuildGallery, 80);
  });
  searchClearEl.addEventListener('click', () => {
    searchEl.value = '';
    rebuildGallery();
    searchEl.focus();
  });

  // Initialize Lucide Gallery
  rebuildGallery();

  // --- Text Panel Setup ---
  const letterText = $<HTMLInputElement>('letterText');
  const fontSelect = $<HTMLSelectElement>('fontSelect');
  const fontUpload = $<HTMLInputElement>('fontUpload');

  letterText.addEventListener('input', () => {
    cb.onTextChange(letterText.value);
  });
  fontSelect.addEventListener('change', () => {
    cb.onFontSelect(fontSelect.value);
  });
  fontUpload.addEventListener('change', () => {
    const f = fontUpload.files?.[0];
    if (f) cb.onImportFont(f);
    fontUpload.value = '';
  });

  function addFontOption(font: FontOption) {
    const opt = document.createElement('option');
    opt.value = font.id;
    opt.textContent = font.name;
    fontSelect.appendChild(opt);
  }

  FONT_OPTIONS.forEach(addFontOption);
  loadBundledFonts(addFontOption);

  // --- Import mode tabs ---
  const importTabs = $('importTabs');
  importTabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
    if (t) cb.onImportMode(t.dataset.mode as any);
  });

  // --- Colors ---
  const ccount = $<HTMLSelectElement>('ccount');
  ccount.addEventListener('change', () => cb.onColorCount(+ccount.value));
  const smooth = $<HTMLInputElement>('smooth');
  smooth.addEventListener('input', () => cb.onSmoothing(+smooth.value));

  // --- Shape ---
  const shapeTypeTabs = $('shapeTypeTabs');
  const shapeSelect = $<HTMLSelectElement>('shapeSelect');

  shapeTypeTabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-style]') as HTMLElement | null;
    if (!t) return;
    const style = t.dataset.style;
    if (style === 'outline') {
      cb.onShape('outline');
    } else {
      cb.onShape(shapeSelect.value as BaseShapeKind);
    }
  });

  shapeSelect.addEventListener('change', () => {
    cb.onShape(shapeSelect.value as BaseShapeKind);
  });

  // --- Size sliders ---
  const width = $<HTMLInputElement>('width');
  width.addEventListener('input', () => cb.onWidth(+width.value));
  const topthick = $<HTMLInputElement>('topthick');
  topthick.addEventListener('input', () => cb.onTopThickness(+topthick.value));
  const imgdepth = $<HTMLInputElement>('imgdepth');
  imgdepth.addEventListener('input', () => cb.onImageDepth(+imgdepth.value));
  const tol = $<HTMLInputElement>('tol');
  tol.addEventListener('input', () => cb.onTolerance(+tol.value));
  const keychain = $<HTMLInputElement>('keychain');
  keychain.addEventListener('change', () => cb.onKeychain(keychain.checked));

  // --- View tabs ---
  const viewTabs = $('viewTabs');
  viewTabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
    if (t) cb.onView(t.dataset.view as ViewMode);
  });

  $<HTMLInputElement>('showswitch').addEventListener('change', (e) =>
    cb.onShowSwitch((e.target as HTMLInputElement).checked)
  );

  // --- Export and Utility actions ---
  $('export').addEventListener('click', () => cb.onExport());
  $('render').addEventListener('click', () => cb.onRenderPng());
  $('aiPrompt').addEventListener('click', () => cb.onAiPrompt());
  $('saveProj').addEventListener('click', () => cb.onSaveProject());
  const projFile = $<HTMLInputElement>('projFile');
  $('loadProj').addEventListener('click', () => projFile.click());
  projFile.addEventListener('change', () => {
    if (projFile.files?.[0]) cb.onLoadProject(projFile.files[0]);
    projFile.value = '';
  });

  let focusedColor = 0;

  function renderPalette(palette: PaletteEntry[]) {
    const pal = $('palette');
    if (palette.length === 0) {
      pal.innerHTML = '<div class="hint">Load an image/vector to pick colors.</div>';
      return;
    }
    if (focusedColor >= palette.length) focusedColor = 0;
    pal.innerHTML = '';
    palette.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'fil-row';
      row.innerHTML = `
        <span class="slot-no">${i + 1}</span>
        <span class="swatch" style="background:${rgbHex(entry.quantRgb)}" title="detected color"></span>
        <span class="arrow">→</span>
        <span class="fil-chip" title="filament" style="background:${rgbHex(entry.filamentRgb)}"></span>
        <span class="cov">${Math.round(entry.coverage * 100)}%</span>
        <span class="stepper" title="3D height (raises this color)">
          <button class="dn">−</button>
          <span class="lvl">${entry.heightLevel}</span>
          <button class="up">+</button>
        </span>`;
      row.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.stepper')) return;
        focusedColor = i;
        pal.querySelectorAll('.fil-row').forEach((x) => x.classList.remove('focused'));
        row.classList.add('focused');
      });
      row.querySelector<HTMLButtonElement>('.up')!.addEventListener('click', () =>
        cb.onHeight(i, entry.heightLevel + 1)
      );
      row.querySelector<HTMLButtonElement>('.dn')!.addEventListener('click', () =>
        cb.onHeight(i, entry.heightLevel - 1)
      );
      pal.appendChild(row);
    });

    // Filament palette: pick a roll for the selected slot.
    const lib = document.createElement('div');
    lib.className = 'lib';
    lib.innerHTML = `
      <div class="lib-label">Filament — pick a color for the selected slot</div>
      <div class="lib-row"></div>
    `;
    const libRow = lib.querySelector('.lib-row')!;
    FILAMENTS.forEach(([name, hex]) => {
      const chip = document.createElement('button');
      chip.className = 'lib-chip';
      chip.style.background = hex;
      chip.title = name;
      chip.addEventListener('click', () => {
        if (focusedColor >= 0 && focusedColor < palette.length) cb.onFilament(focusedColor, hex);
      });
      libRow.appendChild(chip);
    });
    pal.appendChild(lib);

    pal.querySelectorAll<HTMLElement>('.fil-row')[focusedColor]?.classList.add('focused');
  }

  function update(state: UiState) {
    statusEl.innerHTML = (state.building ? '<span class="spinner"></span> ' : '') + state.status;

    ccount.value = String(state.colorCount);
    smooth.value = String(state.smoothing);
    $('smoothVal').textContent = Math.round(state.smoothing * 100) + '%';
    width.value = String(state.capWidthMm);
    $('widthVal').textContent = state.capWidthMm + ' mm';
    topthick.value = String(state.topThickness);
    $('topthickVal').textContent = state.topThickness.toFixed(1) + ' mm';
    imgdepth.value = String(state.imageDepth);
    $('imgdepthVal').textContent = state.imageDepth.toFixed(1) + ' mm';
    tol.value = String(state.tolerance);
    $('tolVal').textContent = state.tolerance.toFixed(2) + ' mm';
    keychain.checked = state.keychain;
    $<HTMLInputElement>('removebg').checked = state.removeBg;
    $<HTMLInputElement>('showswitch').checked = state.showSwitch;

    // Update Import Mode tabs and panels
    for (const b of importTabs.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('active', b.dataset.mode === state.importMode);
    }
    $('imagePanel').hidden = state.importMode !== 'image';
    $('svgPanel').hidden = state.importMode !== 'svg';
    $('iconPanel').hidden = state.importMode !== 'icon';
    $('letterPanel').hidden = state.importMode !== 'text';

    // Hide/show image specific fields in colors section
    const showSmoothingAndBg = state.importMode === 'image';
    const ccountField = $('colorCountField');
    const smoothingField = $('smoothingField');
    if (ccountField) ccountField.style.display = showSmoothingAndBg ? 'grid' : 'none';
    if (smoothingField) smoothingField.style.display = showSmoothingAndBg ? 'grid' : 'none';

    // Update Shape controls
    const isOutline = state.baseShape === 'outline';
    for (const btn of shapeTypeTabs.querySelectorAll<HTMLElement>('button')) {
      btn.classList.toggle('active', btn.dataset.style === (isOutline ? 'outline' : 'shape'));
    }

    if (isOutline) {
      shapeSelect.disabled = true;
    } else {
      shapeSelect.disabled = false;
      shapeSelect.value = state.baseShape;
    }

    // Update View tabs
    for (const b of viewTabs.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('active', b.dataset.view === state.view);
    }

    const exportBtn = $<HTMLButtonElement>('export');
    exportBtn.disabled = !state.hasParts || state.building;

    renderPalette(state.palette);
  }

  return { update, hexRgb, addUploadedSvg };
}
