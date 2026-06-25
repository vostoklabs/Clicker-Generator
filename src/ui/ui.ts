import type { BaseShapeKind, EditMode, EdgeSetting, EdgeStyle, PaletteEntry, ViewMode, RGB } from '../types';
import { FILAMENTS } from '../types';
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
  currentIconName: string;
  colorMode: 'normal' | 'limited';
  limitedColors: RGB[];
  bodyColorRgb: RGB;
  paletteOverrides: RGB[];
  /** Explicit cap-backing/frame color set by clicking it on the model (else derived). */
  baseColorOverride: RGB | null;
  /** Component-specific overrides (key: 'top-color-{colorIndex}-{compIndex}') */
  partOverrides: Record<string, RGB>;
  /** Current edit mode for the 3D viewport. */
  editMode: EditMode;
  /** Edge modification settings (fillet / chamfer). */
  edgeSettings: EdgeSetting[];
  /** Current extrude height being dragged (for HUD display), null when not dragging. */
  extrudeHeight: number | null;
  /** Component-specific heights */
  componentHeights: Record<string, number>;
  /** Which parts are currently selected in the viewport (part names). */
  selectedParts: string[];
}

export interface UiCallbacks {
  onUpload(file: File): void;
  onSample(load: () => Promise<RgbaImage>): void;
  onColorCount(n: number): void;
  onSmoothing(v: number): void;
  onFilament(index: number, hex: string): void;
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
  onBodyColor(hex: string): void;

  // New callbacks for vector modes
  onImportMode(mode: 'image' | 'svg' | 'icon' | 'text'): void;
  onSvgUpload(file: File): void;
  onSelectSvg(svgText: string, name: string): void;
  onSelectIcon(svgText: string, name: string): void;
  onTextChange(text: string): void;
  onFontSelect(fontId: string): void;
  onImportFont(file: File): void;
  onThemeChange(theme: string): void;
  onEditMode(mode: EditMode): void;
  onEdgeStyle(target: string, style: EdgeStyle): void;
  onEdgeStep(target: string, delta: number): void;
  onExtrudeStep(delta: number): void;
  onGenerate(): void;
}

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
  'star', 'heart', 'circle', 'bookmark', 'flag', 'check', 'x', 'plus', 'minus',
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
    <div class="app-header">
      <h1>Clicker Generator <span class="sub">vector/image → clicker</span></h1>
      <div class="header-actions">
      <button id="helpToggle" class="theme-btn help-btn" type="button" title="Show intro &amp; help" aria-label="Show intro and help">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </button>
      <button id="themeToggle" class="theme-btn" type="button" title="Toggle light/dark mode" aria-label="Toggle theme">
        <svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
        <svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      </div>
    </div>

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
      <div class="prow-stacked" id="smoothingField">
        <div class="prow-header">
          <label for="smooth">Smoothing</label>
          <input type="text" class="val" id="smoothVal" />
        </div>
        <input type="range" id="smooth" min="0" max="1" step="0.05" />
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
          <option value="hexagon">Hexagon</option>
          <option value="heart">Heart</option>
          <option value="star">Star</option>
          <option value="egg">Egg</option>
        </select>
      </div>
      <div class="prow-stacked">
        <div class="prow-header">
          <label for="width">Width</label>
          <input type="text" class="val" id="widthVal" />
        </div>
        <input type="range" id="width" min="20" max="70" step="1" />
      </div>
      <div class="prow-stacked">
        <div class="prow-header">
          <label for="topthick">Top thickness</label>
          <input type="text" class="val" id="topthickVal" />
        </div>
        <input type="range" id="topthick" min="1" max="4" step="0.1" />
      </div>
      <div class="prow-stacked">
        <div class="prow-header">
          <label for="imgdepth">Image depth</label>
          <input type="text" class="val" id="imgdepthVal" />
        </div>
        <input type="range" id="imgdepth" min="0.2" max="3" step="0.1" />
      </div>
      <div class="prow-stacked">
        <div class="prow-header">
          <label for="tol">Fit tolerance</label>
          <input type="text" class="val" id="tolVal" />
        </div>
        <input type="range" id="tol" min="0.2" max="0.8" step="0.05" />
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
      <div class="import-grid" id="importTabs" role="tablist">
        <button class="import-card active" data-mode="image" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </span>
          <span class="card-label">Image</span>
        </button>
        <button class="import-card" data-mode="svg" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </span>
          <span class="card-label">SVG</span>
        </button>
        <button class="import-card" data-mode="icon" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </span>
          <span class="card-label">Icon</span>
        </button>
        <button class="import-card" data-mode="text" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
            </svg>
          </span>
          <span class="card-label">Text</span>
        </button>
      </div>

      <!-- Image Panel -->
      <div id="imagePanel" class="mode-panel">
        <div class="drop" id="drop">
          Drop an image, or <u>click to browse</u><br/>
          <span style="font-size:10px; opacity:0.8; display:block; margin-top:4px;">PNG with transparency works best</span>
        </div>
        <input type="file" id="file" accept="image/*" hidden />
        <div class="switch-row">
          <span class="switch-label">Remove background</span>
          <label class="toggle"><input id="removebg" type="checkbox" /><span class="slider"></span></label>
        </div>
        <span class="sample-heading">Choose a sample image</span>
        <div class="sample-inline-grid" id="sampleGrid">
          ${SAMPLES.map((s, idx) => `
            <div class="sample-inline-item" data-idx="${idx}">
              <img src="${s.src}" alt="${s.name}" />
              <span>${s.name}</span>
            </div>
          `).join('')}
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
        <button class="primary" id="generateSvg" style="margin-top: 10px; width: 100%;">Generate</button>
      </div>

      <!-- Icon Panel -->
      <div id="iconPanel" class="mode-panel" hidden>
        <div id="iconSearchWrap">
          <input id="iconSearch" type="search" placeholder="Search Lucide icons…" autocomplete="off" spellcheck="false" />
          <button id="iconSearchClear" type="button" aria-label="Clear search">×</button>
        </div>
        <div id="iconCount"></div>
        <div id="gallery"></div>
        <button class="primary" id="generateIcon" style="margin-top: 10px; width: 100%;">Generate</button>
      </div>

      <!-- Text Panel -->
      <div id="letterPanel" class="mode-panel" hidden>
        <div class="field">
          <label for="letterText">Custom Text</label>
          <textarea id="letterText" rows="2" maxlength="30" autocomplete="off" spellcheck="false" style="width: 100%; resize: vertical; min-height: 48px;">Custom\nText</textarea>
        </div>
        <div class="field">
          <label>Font</label>
          <div id="fontGrid" class="font-grid"></div>
          <label class="upload">
            + Import font
            <input id="fontUpload" type="file" accept=".ttf,.otf,.json,font/ttf,font/otf,application/json" />
          </label>
        </div>
        <button class="primary" id="generateText" style="margin-top: 10px; width: 100%;">Generate</button>
      </div>
    </div>

    <div class="sidebar-sticky-footer">
      <button class="primary" id="export" style="width:100%; margin-bottom:10px">Download 3MF</button>
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
  // Inline sample grid: click a thumbnail to load it directly
  const sampleGrid = $('sampleGrid');
  sampleGrid.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.sample-inline-item') as HTMLElement | null;
    if (item) {
      const idx = parseInt(item.dataset.idx!);
      cb.onSample(SAMPLES[idx].load);
    }
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

  function addUploadedSvg(svgText: string, name: string, select = true) {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const el = makeIconEl(url, name, (clickedEl) => {
      uploadGalleryEl.querySelectorAll('.icon').forEach((n) => n.classList.remove('active'));
      clickedEl.classList.add('active');
      cb.onSelectSvg(svgText, name);
    });
    uploadGalleryEl.appendChild(el);
    refreshUploadEmptyState();
    if (select) el.click();
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
  const letterText = $<HTMLTextAreaElement>('letterText');
  const fontGrid = $('fontGrid');
  const fontUpload = $<HTMLInputElement>('fontUpload');
  let selectedFontBtn: HTMLElement | null = null;

  letterText.addEventListener('input', () => {
    cb.onTextChange(letterText.value);
  });
  fontUpload.addEventListener('change', () => {
    const f = fontUpload.files?.[0];
    if (f) cb.onImportFont(f);
    fontUpload.value = '';
  });

  function addFontOption(font: FontOption) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'font-grid-btn';
    btn.textContent = font.name;
    btn.style.fontFamily = `"${font.id.replace('bundled-', '')}", "${font.name}", sans-serif`;
    
    btn.addEventListener('click', () => {
      if (selectedFontBtn) selectedFontBtn.classList.remove('active');
      btn.classList.add('active');
      selectedFontBtn = btn;
      cb.onFontSelect(font.id);
    });
    fontGrid.appendChild(btn);
  }

  FONT_OPTIONS.forEach(addFontOption);
  loadBundledFonts(addFontOption);

  // --- Generate buttons ---
  $('generateSvg').addEventListener('click', () => cb.onGenerate());
  $('generateIcon').addEventListener('click', () => cb.onGenerate());
  $('generateText').addEventListener('click', () => cb.onGenerate());

  // --- Add loading overlay to viewport dynamically ---
  const viewport = $('viewport');
  if (viewport) {
    let overlay = $('loadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      overlay.setAttribute('hidden', '');
      overlay.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-text">Generating 3D model…</div>
      `;
      viewport.appendChild(overlay);
    }

    // --- Edit Mode Bar (Color / Extrude / Edges) ---
    const modeBar = document.createElement('div');
    modeBar.id = 'editModeBar';
    modeBar.className = 'edit-mode-bar';
    modeBar.innerHTML = `
      <button class="edit-mode-btn active" data-editmode="color" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
        Color
      </button>
      <button class="edit-mode-btn" data-editmode="extrude" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
        Extrude
      </button>
      <button class="edit-mode-btn" data-editmode="edges" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" ry="4"/></svg>
        Edges
      </button>
    `;
    viewport.appendChild(modeBar);
    modeBar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-editmode]') as HTMLElement | null;
      if (btn) cb.onEditMode(btn.dataset.editmode as EditMode);
    });

    // --- Extrude Panel ---
    const extrudePanel = document.createElement('div');
    extrudePanel.id = 'extrudePanel';
    extrudePanel.className = 'edges-panel';
    extrudePanel.setAttribute('hidden', '');
    extrudePanel.innerHTML = `
      <div class="edges-title">Extrude Part</div>
      <div id="extrudeLevelLabel" style="text-align:center; margin-top:8px; font-size:13px; color:var(--muted);">Level: 0</div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" class="btn" id="extrudeMinus" style="flex:1; font-size:18px;">-</button>
        <button type="button" class="btn" id="extrudePlus" style="flex:1; font-size:18px;">+</button>
      </div>
      <button type="button" class="btn primary" id="extrudeSync" style="margin-top:8px;">Sync Geometry</button>
    `;
    viewport.appendChild(extrudePanel);

    extrudePanel.querySelector('#extrudeMinus')?.addEventListener('click', () => cb.onExtrudeStep(-1));
    extrudePanel.querySelector('#extrudePlus')?.addEventListener('click', () => cb.onExtrudeStep(1));
    extrudePanel.querySelector('#extrudeSync')?.addEventListener('click', () => cb.onGenerate());

    // --- Edges Panel ---
    const edgesPanel = document.createElement('div');
    edgesPanel.id = 'edgesPanel';
    edgesPanel.className = 'edges-panel';
    edgesPanel.setAttribute('hidden', '');
    edgesPanel.innerHTML = `
      <div class="edges-title" id="edgesTitle">Edge Modifications</div>
      <div id="edgesContent"></div>
      <button type="button" class="btn primary" id="edgesSync" style="margin-top:8px;">Sync Geometry</button>
    `;
    viewport.appendChild(edgesPanel);

    edgesPanel.querySelector('#edgesSync')?.addEventListener('click', () => cb.onGenerate());

    edgesPanel.addEventListener('click', (e) => {
      const targetEl = e.target as HTMLElement;
      
      const styleBtn = targetEl.closest('.edge-style-btn') as HTMLElement | null;
      if (styleBtn) {
        const btnsRow = styleBtn.closest('.edge-style-btns') as HTMLElement;
        btnsRow.querySelectorAll('.edge-style-btn').forEach(b => b.classList.remove('active'));
        styleBtn.classList.add('active');
        const target = btnsRow.dataset.edge;
        const style = styleBtn.dataset.style as EdgeSetting['style'];
        if (target) cb.onEdgeStyle(target, style);
      }

      if (targetEl.classList.contains('edge-size-minus') || targetEl.classList.contains('edge-size-plus')) {
        const sizeRow = targetEl.closest('.edge-size-btns') as HTMLElement;
        const target = sizeRow.dataset.edge;
        const delta = targetEl.classList.contains('edge-size-minus') ? -0.2 : 0.2;
        if (target) cb.onEdgeStep(target, delta);
      }
    });
  }

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

  // --- Typeable value inputs: parse typed number, commit on Enter / blur ---
  function bindValInput(
    valId: string,
    slider: HTMLInputElement,
    callback: (v: number) => void,
    parse?: (raw: number) => number,
  ) {
    const el = $<HTMLInputElement>(valId);
    const commit = () => {
      const raw = parseFloat(el.value.replace(/[^0-9.\-]/g, ''));
      if (isNaN(raw)) return;
      const v = parse ? parse(raw) : raw;
      const clamped = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), v));
      slider.value = String(clamped);
      callback(clamped);
    };
    el.addEventListener('focus', () => el.select());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); el.blur(); }
    });
    el.addEventListener('blur', commit);
  }

  bindValInput('smoothVal', smooth, cb.onSmoothing, (v) => v / 100);
  bindValInput('widthVal', width, cb.onWidth);
  bindValInput('topthickVal', topthick, cb.onTopThickness);
  bindValInput('imgdepthVal', imgdepth, cb.onImageDepth);
  bindValInput('tolVal', tol, cb.onTolerance);

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
  // render PNG and AI prompt buttons removed per design
  $('saveProj').addEventListener('click', () => cb.onSaveProject());
  const projFile = $<HTMLInputElement>('projFile');
  $('loadProj').addEventListener('click', () => projFile.click());
  projFile.addEventListener('change', () => {
    if (projFile.files?.[0]) cb.onLoadProject(projFile.files[0]);
    projFile.value = '';
  });

  // --- Theme toggle ---
  $('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    cb.onThemeChange(next);
  });

  // --- Welcome / intro modal ---
  // Shown on every load (even on refresh) and re-openable via the header "?" button.
  function showWelcome() {
    // Avoid stacking duplicates if the help button is clicked repeatedly.
    if (document.querySelector('.welcome-overlay')) return;
    const wm = document.createElement('div');
    wm.className = 'welcome-overlay';
    wm.innerHTML = `
      <div class="welcome-card">
        <h2>Welcome to Clicker Generator 👋</h2>
        <p>Turn any image, SVG, icon, or text into a multi-color 3D printable clicker — ready for Bambu Studio or PrusaSlicer.</p>
        <div class="welcome-steps">
          <div class="welcome-step">
            <div class="welcome-step-num">1</div>
            <div class="welcome-step-text">
              <strong>Import your design</strong>
              <span>Drop an image or choose a sample, upload an SVG, pick a Lucide icon, or type custom text.</span>
            </div>
          </div>
          <div class="welcome-step">
            <div class="welcome-step-num">2</div>
            <div class="welcome-step-text">
              <strong>Configure the clicker</strong>
              <span>Pick colors &amp; filaments, choose a shape, adjust the size and depth.</span>
            </div>
          </div>
          <div class="welcome-step">
            <div class="welcome-step-num">3</div>
            <div class="welcome-step-text">
              <strong>Export &amp; print</strong>
              <span>Download the 3MF file and load it directly into your slicer — each color is a separate part.</span>
            </div>
          </div>
        </div>
        <div class="welcome-foot">
          <button class="primary" id="welcomeClose" style="min-width:150px">Get started →</button>
        </div>
      </div>
    `;
    document.body.appendChild(wm);
    const close = () => wm.remove();
    wm.querySelector('#welcomeClose')!.addEventListener('click', close);
    // Also dismiss on backdrop click.
    wm.addEventListener('click', (e) => {
      if (e.target === wm) close();
    });
  }

  // Always greet on load, and let the header "?" button bring it back.
  showWelcome();
  $('helpToggle').addEventListener('click', showWelcome);

  function getFilamentNameAndHex(rgb: RGB): [string, string] {
    let bestHex = rgbHex(rgb);
    let bestName = 'Custom Color';
    let bestD = Infinity;
    for (const [name, hex] of FILAMENTS) {
      const [fr, fg, fb] = hexRgb(hex);
      const dr = rgb[0] - fr;
      const dg = rgb[1] - fg;
      const db = rgb[2] - fb;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        bestHex = hex;
        bestName = name;
      }
    }
    return [bestName, bestHex];
  }

  // Robust floating swatch picker. Anchored at (clientX, clientY) — typically the
  // cursor or a trigger element's corner — then measured and clamped so it always
  // stays fully on-screen (the old version could land in the top-left corner).
  function showColorPopoverAt(
    clientX: number,
    clientY: number,
    currentHex: string,
    options: RGB[],
    handlers: { onSelect: (hex: string) => void; onClose?: () => void }
  ) {
    document.getElementById('sbColorPopover')?.remove();

    const popover = document.createElement('div');
    popover.id = 'sbColorPopover';
    popover.className = 'color-popover';
    document.body.appendChild(popover);

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      popover.remove();
      document.removeEventListener('mousedown', dismiss);
      handlers.onClose?.();
    };

    options.forEach((rgb) => {
      const hex = rgbHex(rgb);
      const [name] = getFilamentNameAndHex(rgb);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.background = hex;
      btn.title = name;
      if (hex.toLowerCase() === currentHex.toLowerCase()) btn.classList.add('active');
      btn.addEventListener('click', () => {
        handlers.onSelect(hex);
        close();
      });
      popover.appendChild(btn);
    });

    // Custom color: live-updates while dragging, stays open until dismissed.
    const custom = document.createElement('label');
    custom.className = 'cp-custom';
    custom.title = 'Custom color';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = /^#[0-9a-f]{6}$/i.test(currentHex) ? currentHex : '#888888';
    inp.addEventListener('input', () => handlers.onSelect(inp.value));
    custom.appendChild(inp);
    popover.appendChild(custom);

    // Measure now that it's populated, then clamp into the viewport.
    const w = popover.offsetWidth || 170;
    const h = popover.offsetHeight || 180;
    popover.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - w - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - h - 8))}px`;

    const dismiss = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node)) close();
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 50);
  }

  function showSidebarColorPicker(
    triggerEl: HTMLElement,
    currentHex: string,
    options: [string, string][],
    onSelect: (hex: string) => void
  ) {
    const rect = triggerEl.getBoundingClientRect();
    showColorPopoverAt(rect.left, rect.bottom + 6, currentHex, options.map(([, hex]) => hexRgb(hex)), {
      onSelect,
    });
  }

  function renderPalette(palette: PaletteEntry[], bodyColorRgb: RGB, colorMode?: 'normal' | 'limited', limitedColors?: RGB[]) {
    const pal = $('palette');
    pal.innerHTML = '';

    const chipsToRender: [string, string][] = [];
    if (colorMode === 'limited' && limitedColors && limitedColors.length > 0) {
      limitedColors.forEach((rgb) => {
        chipsToRender.push(getFilamentNameAndHex(rgb));
      });
    } else {
      FILAMENTS.forEach(([name, hex]) => {
        chipsToRender.push([name, hex]);
      });
    }

    // ALWAYS render the Clicker Body row.
    const bodyRow = document.createElement('div');
    bodyRow.className = 'fil-row body-row';
    bodyRow.innerHTML = `
      <span class="slot-no">Body</span>
      <span class="swatch" style="background:#787c82; opacity: 0.5;" title="default body color"></span>
      <span class="arrow">→</span>
      <button type="button" class="fil-chip" title="clicker body color" style="background:${rgbHex(bodyColorRgb)}"></button>
      <span class="cov">Clicker Base</span>
    `;

    const bodyChip = bodyRow.querySelector('.fil-chip')!;
    bodyChip.addEventListener('click', (e) => {
      e.stopPropagation();
      showSidebarColorPicker(bodyChip as HTMLElement, rgbHex(bodyColorRgb), chipsToRender, (hex) => {
        cb.onBodyColor(hex);
      });
    });

    pal.appendChild(bodyRow);

    if (palette.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Load an image/vector to pick colors.';
      pal.appendChild(hint);
    } else {
      palette.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'fil-row';
        row.innerHTML = `
          <span class="slot-no">${i + 1}</span>
          <span class="swatch" style="background:${rgbHex(entry.quantRgb)}" title="detected color"></span>
          <span class="arrow">→</span>
          <button type="button" class="fil-chip" title="filament" style="background:${rgbHex(entry.filamentRgb)}"></button>`;

        const chip = row.querySelector('.fil-chip')!;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          showSidebarColorPicker(chip as HTMLElement, rgbHex(entry.filamentRgb), chipsToRender, (hex) => {
            cb.onFilament(i, hex);
          });
        });

        pal.appendChild(row);
      });

      const tip = document.createElement('div');
      tip.className = 'hint model-recolor-tip';
      tip.textContent = 'Tip: click any color on the 3D model to recolor it.';
      pal.appendChild(tip);
    }
  }

  function update(state: UiState) {
    statusEl.innerHTML = (state.building ? '<span class="spinner"></span> ' : '') + state.status;

    if (state.colorMode === 'limited') {
      ccount.disabled = true;
      let existingOpt = ccount.querySelector(`option[value="${state.colorCount}"]`);
      if (!existingOpt) {
        const opt = document.createElement('option');
        opt.value = String(state.colorCount);
        opt.textContent = `${state.colorCount} Colors (Limited)`;
        ccount.appendChild(opt);
      }
      ccount.value = String(state.colorCount);
    } else {
      ccount.disabled = false;
      ccount.querySelectorAll('option').forEach(opt => {
        if (opt.textContent?.includes('Limited')) {
          opt.remove();
        }
      });
      ccount.value = String(state.colorCount);
    }

    const setVal = (id: string, text: string) => {
      const el = $<HTMLInputElement>(id);
      if (document.activeElement !== el) el.value = text;
    };
    smooth.value = String(state.smoothing);
    setVal('smoothVal', Math.round(state.smoothing * 100) + '%');
    width.value = String(state.capWidthMm);
    setVal('widthVal', state.capWidthMm + ' mm');
    topthick.value = String(state.topThickness);
    setVal('topthickVal', state.topThickness.toFixed(1) + ' mm');
    imgdepth.value = String(state.imageDepth);
    setVal('imgdepthVal', state.imageDepth.toFixed(1) + ' mm');
    tol.value = String(state.tolerance);
    setVal('tolVal', state.tolerance.toFixed(2) + ' mm');
    keychain.checked = state.keychain;
    $<HTMLInputElement>('removebg').checked = state.removeBg;
    $<HTMLInputElement>('showswitch').checked = state.showSwitch;

    // Update Import Mode tabs and panels
    for (const b of importTabs.querySelectorAll<HTMLElement>('[data-mode]')) {
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

    // Update Shape controls. Icons can't use the outline style (their thin
    // line-art makes a broken body), so the Outline tab is hidden for icon mode
    // and the body is always a solid shape.
    const outlineTab = shapeTypeTabs.querySelector<HTMLElement>('[data-style="outline"]');
    if (outlineTab) outlineTab.style.display = state.importMode === 'icon' ? 'none' : '';
    const treatAsOutline = state.baseShape === 'outline' && state.importMode !== 'icon';
    for (const btn of shapeTypeTabs.querySelectorAll<HTMLElement>('button')) {
      btn.classList.toggle('active', btn.dataset.style === (treatAsOutline ? 'outline' : 'shape'));
    }

    if (treatAsOutline) {
      shapeSelect.disabled = true;
    } else {
      shapeSelect.disabled = false;
      shapeSelect.value = state.baseShape === 'outline' ? 'circle' : state.baseShape;
    }

    // Update View tabs
    for (const b of viewTabs.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('active', b.dataset.view === state.view);
    }

    const exportBtn = $<HTMLButtonElement>('export');
    exportBtn.disabled = !state.hasParts || state.building;

    // Toggle loading overlay
    const overlay = $('loadingOverlay');
    if (overlay) {
      if (state.building) {
        overlay.removeAttribute('hidden');
        const textEl = overlay.querySelector('.loading-text');
        if (textEl) {
          textEl.textContent = state.status;
        }
      } else {
        overlay.setAttribute('hidden', '');
      }
    }

    renderPalette(state.palette, state.bodyColorRgb, state.colorMode, state.limitedColors);

    // Highlight the active icon in the Lucide gallery
    if (state.currentIconName) {
      galleryEl.querySelectorAll('.icon').forEach((n) => {
        n.classList.toggle('active', n.getAttribute('title') === state.currentIconName);
      });
    }

    // --- Edit mode bar ---
    const modeBarEl = document.getElementById('editModeBar');
    if (modeBarEl) {
      for (const b of modeBarEl.querySelectorAll<HTMLElement>('[data-editmode]')) {
        b.classList.toggle('active', b.dataset.editmode === state.editMode);
      }
    }

    // --- Extrude tooltip ---
    const extrudeTooltipEl = document.getElementById('extrudeTooltip');
    if (extrudeTooltipEl) {
      extrudeTooltipEl.classList.toggle('hidden', state.editMode !== 'extrude');
    }

    // --- Edit mode UI toggles ---
    const modeBarBtns = document.querySelectorAll('.edit-mode-btn');
    modeBarBtns.forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.editmode === state.editMode);
    });

    // --- Extrude panel ---
    const extrudePanelEl = document.getElementById('extrudePanel');
    if (extrudePanelEl) {
      if (state.editMode === 'extrude') {
        extrudePanelEl.removeAttribute('hidden');
        const plusBtn = extrudePanelEl.querySelector('#extrudePlus') as HTMLButtonElement;
        const minusBtn = extrudePanelEl.querySelector('#extrudeMinus') as HTMLButtonElement;
        const labelEl = extrudePanelEl.querySelector('#extrudeLevelLabel');
        
        if (state.selectedParts.length === 0) {
          if (plusBtn) plusBtn.disabled = true;
          if (minusBtn) minusBtn.disabled = true;
          if (labelEl) labelEl.textContent = 'Select a part';
        } else {
          if (plusBtn) plusBtn.disabled = false;
          if (minusBtn) minusBtn.disabled = false;
          if (labelEl) {
            const firstPart = state.selectedParts[0];
            const level = state.componentHeights[firstPart] ?? 0;
            labelEl.textContent = `Level: ${level.toFixed(1)}`;
          }
        }
      } else {
        extrudePanelEl.setAttribute('hidden', '');
      }
    }

    // --- Edges panel ---
    const edgesPanelEl = document.getElementById('edgesPanel');
    const edgesContentEl = document.getElementById('edgesContent');
    const edgesTitleEl = document.getElementById('edgesTitle');
    if (edgesPanelEl && edgesContentEl && edgesTitleEl) {
      if (state.editMode === 'edges') {
        edgesPanelEl.removeAttribute('hidden');
        
        // Build edge rows based on selected parts (or default globals if none selected)
        let targets = state.selectedParts.length > 0 ? state.selectedParts : ['capTop', 'baseTop', 'baseBottom'];
        edgesTitleEl.textContent = state.selectedParts.length > 0 ? 'Part Edges' : 'Global Edges';
        
        // Rebuild DOM only if targets changed (crude but effective)
        const currentTargets = Array.from(edgesContentEl.querySelectorAll('.edge-style-btns')).map(r => (r as HTMLElement).dataset.edge);
        if (targets.join(',') !== currentTargets.join(',')) {
          edgesContentEl.innerHTML = targets.map(t => {
            const label = t === 'capTop' ? 'Cap Top' : t === 'baseTop' ? 'Base Top' : t === 'baseBottom' ? 'Base Bottom' : t;
            return `
              <div class="edge-label" title="${t}" style="margin-bottom: 4px;">${label} <span class="edge-radius-label" style="color:var(--muted);"></span></div>
              <div class="edge-style-btns" data-edge="${t}" style="margin-bottom: 8px;">
                <button class="edge-style-btn active" data-style="none" type="button">None</button>
                <button class="edge-style-btn" data-style="fillet" type="button">Fillet</button>
                <button class="edge-style-btn" data-style="chamfer" type="button">Chamfer</button>
              </div>
              <div class="edge-size-btns" data-edge="${t}" style="display:flex; gap:8px; margin-bottom: 12px; display: none;">
                <button class="btn edge-size-minus" type="button" style="flex:1;">-</button>
                <button class="btn edge-size-plus" type="button" style="flex:1;">+</button>
              </div>
            `;
          }).join('');
        }
        
        // Sync button state from edgeSettings
        for (const target of targets) {
          const es = state.edgeSettings.find(s => s.target === target) || { target, style: 'none', radius: 1.0 };
          const btnsRow = edgesContentEl.querySelector(`.edge-style-btns[data-edge="${target}"]`) as HTMLElement;
          const sizeRow = edgesContentEl.querySelector(`.edge-size-btns[data-edge="${target}"]`) as HTMLElement;
          const labelRow = edgesContentEl.querySelector(`.edge-label[title="${target}"] .edge-radius-label`) as HTMLElement;
          
          if (btnsRow) {
            btnsRow.querySelectorAll('.edge-style-btn').forEach(b => {
              b.classList.toggle('active', (b as HTMLElement).dataset.style === es.style);
            });
          }
          if (sizeRow && labelRow) {
            if (es.style === 'none') {
               sizeRow.style.display = 'none';
               labelRow.textContent = '';
            } else {
               sizeRow.style.display = 'flex';
               labelRow.textContent = `(${es.radius.toFixed(1)} mm)`;
            }
          }
        }
      } else {
        edgesPanelEl.setAttribute('hidden', '');
      }
    }
  }

  return { 
    update, 
    hexRgb, 
    showColorPopoverAt, 
    addUploadedSvg, 
    addFontOption: (font: FontOption) => { 
      addFontOption(font); 
      // Click the newly added font to select it
      const lastBtn = fontGrid.lastElementChild as HTMLElement;
      if (lastBtn) lastBtn.click();
    } 
  };
}
