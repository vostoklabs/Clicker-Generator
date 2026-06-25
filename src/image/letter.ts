import * as THREE from 'three';
import { FontLoader, Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import helvetikerRegular from 'three/examples/fonts/helvetiker_regular.typeface.json';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import optimerBold from 'three/examples/fonts/optimer_bold.typeface.json';
import optimerRegular from 'three/examples/fonts/optimer_regular.typeface.json';
import gentilisRegular from 'three/examples/fonts/gentilis_regular.typeface.json';
import gentilisBold from 'three/examples/fonts/gentilis_bold.typeface.json';
import droidSansRegular from 'three/examples/fonts/droid/droid_sans_regular.typeface.json';
import droidSansBold from 'three/examples/fonts/droid/droid_sans_bold.typeface.json';
import droidSansMonoRegular from 'three/examples/fonts/droid/droid_sans_mono_regular.typeface.json';
import droidSerifRegular from 'three/examples/fonts/droid/droid_serif_regular.typeface.json';
import droidSerifBold from 'three/examples/fonts/droid/droid_serif_bold.typeface.json';
import type { RegionSet, Ring, RGB } from '../types';

const fontLoader = new FontLoader();
const ttfLoader = new TTFLoader();

export interface FontOption {
  id: string;
  name: string;
  font: Font;
  imported?: boolean;
}

export const FONT_OPTIONS: FontOption[] = [];

const BUILT_IN_FONTS: [string, string, any][] = [
  ['helvetiker-regular', 'Helvetiker', helvetikerRegular],
  ['helvetiker-bold', 'Helvetiker Bold', helvetikerBold],
  ['optimer-regular', 'Optimer', optimerRegular],
  ['optimer-bold', 'Optimer Bold', optimerBold],
  ['gentilis-regular', 'Gentilis', gentilisRegular],
  ['gentilis-bold', 'Gentilis Bold', gentilisBold],
  ['droid-sans-regular', 'Droid Sans', droidSansRegular],
  ['droid-sans-bold', 'Droid Sans Bold', droidSansBold],
  ['droid-sans-mono-regular', 'Droid Sans Mono', droidSansMonoRegular],
  ['droid-serif-regular', 'Droid Serif', droidSerifRegular],
  ['droid-serif-bold', 'Droid Serif Bold', droidSerifBold],
];

for (const [id, name, data] of BUILT_IN_FONTS) {
  FONT_OPTIONS.push({ id, name, font: fontLoader.parse(data) });
}

const BUNDLED_TTF = [
  ['bebas-neue', 'Bebas Neue'],
  ['anton', 'Anton'],
  ['oswald', 'Oswald'],
  ['titillium-web', 'Titillium Web'],
  ['rajdhani', 'Rajdhani'],
  ['chakra-petch', 'Chakra Petch'],
  ['orbitron', 'Orbitron'],
  ['audiowide', 'Audiowide'],
  ['michroma', 'Michroma'],
  ['russo-one', 'Russo One'],
  ['righteous', 'Righteous'],
  ['bungee', 'Bungee'],
  ['share-tech-mono', 'Share Tech Mono'],
  ['vt323', 'VT323'],
  ['press-start-2p', 'Press Start 2P'],
  ['arvo', 'Arvo'],
  ['lobster', 'Lobster'],
  ['pacifico', 'Pacifico'],
];

let bundledLoaded = false;
export async function loadBundledFonts(onLoaded?: (option: FontOption) => void) {
  if (bundledLoaded) return;
  bundledLoaded = true;
  const baseUrl = import.meta.env.BASE_URL || '/';
  for (const [slug, name] of BUNDLED_TTF) {
    try {
      const buf = await fetch(`${baseUrl}fonts/${slug}.ttf`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      const parsedTTF = ttfLoader.parse(buf);
      const font = fontLoader.parse(parsedTTF);
      const option = { id: `bundled-${slug}`, name, font };
      FONT_OPTIONS.push(option);
      onLoaded?.(option);
    } catch (e: any) {
      console.warn(`Could not load font "${name}":`, e.message);
    }
  }
}

function uniqueFontId(base: string): string {
  const slug = base
    .replace(/\.[^.]+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'imported-font';
  let id = `imported-${slug}`;
  let suffix = 2;
  while (FONT_OPTIONS.some((font) => font.id === id)) {
    id = `imported-${slug}-${suffix}`;
    suffix++;
  }
  return id;
}

function fontNameFromData(data: any, fallback: string): string {
  return data.familyName || data.original_font_information?.fullName?.en || fallback;
}

export async function importFontFile(file: File): Promise<FontOption> {
  const isJson = /\.json$/i.test(file.name);
  const data = isJson
    ? JSON.parse(await file.text())
    : ttfLoader.parse(await file.arrayBuffer());
  const option = {
    id: uniqueFontId(file.name),
    name: fontNameFromData(data, file.name.replace(/\.[^.]+$/g, '')),
    font: fontLoader.parse(data),
    imported: true,
  };
  FONT_OPTIONS.push(option);
  return option;
}

export function parseLetter(text: string, fontId: string, maxLen = 4): RegionSet {
  const value = Array.from((text || '').trim()).slice(0, maxLen).join('');
  if (!value) throw new Error('Type a letter first.');

  const option = FONT_OPTIONS.find((font) => font.id === fontId) || FONT_OPTIONS[0];
  const shapes = option.font.generateShapes(value, 100);
  const contours: Ring[] = [];
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );

  for (const shape of shapes) {
    const extracted = shape.extractPoints(16);
    if (extracted.shape.length >= 3) {
      const ring: Ring = [];
      for (const p of extracted.shape) {
        box.expandByPoint(p);
        ring.push([p.x, p.y]);
      }
      contours.push(ring);
    }
    for (const hole of extracted.holes) {
      if (hole.length >= 3) {
        const ring: Ring = [];
        for (const p of hole) {
          box.expandByPoint(p);
          ring.push([p.x, p.y]);
        }
        contours.push(ring);
      }
    }
  }

  if (!contours.length) throw new Error('No drawable outlines found in this font.');

  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const maxSide = Math.max(dx, dy) || 1;
  const aspect = dy !== 0 ? dx / dy : 1;

  const normalizeRing = (r: Ring): Ring =>
    r.map(([x, y]) => [
      (x - cx) / maxSide,
      (y - cy) / maxSide // keep Y-up
    ]);

  const normContours = contours.map(normalizeRing);

  // Default text color is off-white (#f7f7f5)
  const regions = [{
    quantRgb: [247, 247, 245] as RGB,
    rings: normContours,
    coverage: 1.0
  }];

  return { regions, outline: normContours, aspect };
}
