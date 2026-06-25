// Sidebar UI. Plain DOM, no framework. Emits intent via callbacks; reflects
// state via update(). Color panel mirrors a filament-picker workflow: each
// detected color maps to a filament swatch + a height level (3D relief).
import type { BaseShapeKind, PaletteEntry, ViewMode } from '../types';
import type { SectionAxis } from '../viewer/viewer';

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
}

export interface UiCallbacks {
  onUpload(file: File): void;
  onSample(): void;
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

const rgbHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

export function createUi(sidebar: HTMLElement, statusEl: HTMLElement, cb: UiCallbacks) {
  sidebar.innerHTML = `
    <h1>Clicker Generator <span class="sub">image → printable clicker</span></h1>

    <div class="panel">
      <h2>1 · Image</h2>
      <div class="drop" id="drop">Drop an image, or <u>click to browse</u><br/><span style="font-size:11px">PNG with transparency works best — or let us cut the background</span></div>
      <input type="file" id="file" accept="image/*" hidden />
      <div class="btn-row" style="margin-top:10px">
        <button id="sample">Try a sample</button>
      </div>
      <label class="check"><input type="checkbox" id="removebg" /> Remove background</label>
    </div>

    <div class="panel">
      <h2>2 · Colors → filament</h2>
      <div class="row">
        <label>Colors</label>
        <input type="range" id="ccount" min="2" max="12" step="1" />
        <span class="val" id="ccountVal"></span>
      </div>
      <div class="row">
        <label>Smoothing</label>
        <input type="range" id="smooth" min="0" max="1" step="0.05" />
        <span class="val" id="smoothVal"></span>
      </div>
      <div class="palette" id="palette"><div class="hint">Load an image to pick colors.</div></div>
    </div>

    <div class="panel">
      <h2>3 · Shape & size</h2>
      <div class="row">
        <label>Base</label>
        <div class="seg" id="shape" style="flex:1">
          <button data-shape="outline">Outline</button>
          <button data-shape="circle">Circle</button>
          <button data-shape="square">Square</button>
        </div>
      </div>
      <div class="row">
        <label>Cap width</label>
        <input type="range" id="width" min="20" max="70" step="1" />
        <span class="val" id="widthVal"></span>
      </div>
      <div class="row">
        <label>Top thickness</label>
        <input type="range" id="topthick" min="1" max="4" step="0.1" />
        <span class="val" id="topthickVal"></span>
      </div>
      <div class="row">
        <label>Image depth</label>
        <input type="range" id="imgdepth" min="0.2" max="3" step="0.1" />
        <span class="val" id="imgdepthVal"></span>
      </div>
      <div class="row">
        <label>Fit tolerance</label>
        <input type="range" id="tol" min="0.2" max="0.8" step="0.05" />
        <span class="val" id="tolVal"></span>
      </div>
      <div class="hint">Backing behind the image, image cut depth, and cap↔body slip-fit gap.</div>
      <label class="check"><input type="checkbox" id="keychain" /> Keychain loop</label>
    </div>

    <div class="panel">
      <h2>4 · Preview & export</h2>
      <div class="row">
        <label>View</label>
        <div class="seg" id="view" style="flex:1">
          <button data-view="assembled">Assembled</button>
          <button data-view="exploded">Exploded</button>
          <button data-view="section">Section</button>
        </div>
      </div>
      <label class="check"><input type="checkbox" id="showswitch" /> Show MX switch</label>
      <div id="sectionCtl" style="display:none">
        <div class="row">
          <label>Cut axis</label>
          <div class="seg" id="secAxis" style="flex:1">
            <button data-axis="x">X</button>
            <button data-axis="y">Y</button>
            <button data-axis="z">Z</button>
          </div>
        </div>
        <div class="row">
          <label>Cut position</label>
          <input type="range" id="secPos" min="-1" max="1" step="0.02" value="0" />
        </div>
      </div>
      <button class="primary" id="export" style="width:100%; margin-top:6px">Download 3MF</button>
      <div class="btn-row" style="margin-top:8px">
        <button id="render">Save render PNG</button>
        <button id="aiPrompt">AI prompt</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button id="saveProj">Save project</button>
        <button id="loadProj">Load project</button>
        <input type="file" id="projFile" accept="application/json" hidden />
      </div>
      <div class="hint">Body holds a Cherry MX switch; cap snaps onto it. Print, then dial in fit.</div>
    </div>
  `;

  const $ = <T extends HTMLElement>(id: string) => sidebar.querySelector<T>('#' + id)!;

  // --- Image ---
  const drop = $('drop');
  const file = $<HTMLInputElement>('file');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    if (file.files?.[0]) cb.onUpload(file.files[0]);
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) cb.onUpload(f);
  });
  $('sample').addEventListener('click', () => cb.onSample());
  $<HTMLInputElement>('removebg').addEventListener('change', (e) =>
    cb.onRemoveBg((e.target as HTMLInputElement).checked),
  );

  // --- Colors ---
  const ccount = $<HTMLInputElement>('ccount');
  ccount.addEventListener('input', () => cb.onColorCount(+ccount.value));
  const smooth = $<HTMLInputElement>('smooth');
  smooth.addEventListener('input', () => cb.onSmoothing(+smooth.value));

  // --- Shape ---
  $('shape').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-shape]') as HTMLElement | null;
    if (t) cb.onShape(t.dataset.shape as BaseShapeKind);
  });
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

  // --- View / export ---
  let secAxis: SectionAxis = 'y';
  $('view').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
    if (t) cb.onView(t.dataset.view as ViewMode);
  });
  $<HTMLInputElement>('showswitch').addEventListener('change', (e) =>
    cb.onShowSwitch((e.target as HTMLInputElement).checked),
  );
  const secPos = $<HTMLInputElement>('secPos');
  $('secAxis').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-axis]') as HTMLElement | null;
    if (!t) return;
    secAxis = t.dataset.axis as SectionAxis;
    for (const b of sidebar.querySelectorAll<HTMLElement>('#secAxis button'))
      b.classList.toggle('active', b.dataset.axis === secAxis);
    cb.onSection(secAxis, +secPos.value);
  });
  secPos.addEventListener('input', () => cb.onSection(secAxis, +secPos.value));
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

  function renderPalette(palette: PaletteEntry[]) {
    const pal = $('palette');
    if (palette.length === 0) {
      pal.innerHTML = '<div class="hint">Load an image to pick colors.</div>';
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
        cb.onHeight(i, entry.heightLevel + 1),
      );
      row.querySelector<HTMLButtonElement>('.dn')!.addEventListener('click', () =>
        cb.onHeight(i, entry.heightLevel - 1),
      );
      pal.appendChild(row);
    });

    // Filament palette: pick a roll for the selected slot.
    const lib = document.createElement('div');
    lib.className = 'lib';
    lib.innerHTML =
      '<div class="lib-label">Filament — pick a color for the selected slot</div><div class="lib-row"></div>';
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

  let focusedColor = 0;

  function update(state: UiState) {
    statusEl.innerHTML = (state.building ? '<span class="spinner"></span> ' : '') + state.status;

    ccount.value = String(state.colorCount);
    $('ccountVal').textContent = String(state.colorCount);
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

    for (const b of sidebar.querySelectorAll<HTMLElement>('#shape button')) {
      b.classList.toggle('active', b.dataset.shape === state.baseShape);
    }
    for (const b of sidebar.querySelectorAll<HTMLElement>('#view button')) {
      b.classList.toggle('active', b.dataset.view === state.view);
    }
    ($('sectionCtl') as HTMLElement).style.display = state.view === 'section' ? '' : 'none';
    for (const b of sidebar.querySelectorAll<HTMLElement>('#secAxis button')) {
      b.classList.toggle('active', b.dataset.axis === secAxis);
    }

    const exportBtn = $<HTMLButtonElement>('export');
    exportBtn.disabled = !state.hasParts || state.building;

    renderPalette(state.palette);
  }

  return { update, hexRgb };
}
