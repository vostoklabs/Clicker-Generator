// Shared types. See DEV_PLAN.md §4 for the full target data model; this is the
// walking-skeleton subset.

export type RGB = [number, number, number];

export const FILAMENTS: [string, string][] = [
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

/** A closed 2D ring (list of [x,y]); EvenOdd fill handles outer/hole nesting. */
export type Ring = [number, number][];

/** Normalized 2D geometry: silhouette fits within a unit box (longest side = 1),
 *  centered on origin, Y-up. Worker scales by capWidthMm. */
export interface RegionSet {
  /** One entry per palette color actually used. */
  regions: { quantRgb: RGB; components: { rings: Ring[]; coverage: number }[]; coverage: number }[];
  /** Union silhouette of all foreground pixels. */
  outline: Ring[];
  /** Aspect (width/height) of the source silhouette, for reference. */
  aspect: number;
}

/** A color slot for the image/svg/text. */
export interface PaletteEntry {
  quantRgb: RGB; // The original color grouped from the image/svg
  filamentRgb: RGB; // The assigned physical color
  coverage: number; // fraction of foreground pixels
}

export type BaseShapeKind = 'outline' | 'circle' | 'square' | 'hexagon' | 'heart' | 'star' | 'egg';
export type ViewMode = 'assembled' | 'exploded' | 'section';

/** Which interaction mode the viewport is in. */
export type EditMode = 'color' | 'extrude' | 'edges';

/** Which edge group or part to modify. E.g. 'baseTop', 'capTop', or a part name like 'top-color-0-1' */
export type EdgeTarget = string;

/** Edge modification style. */
export type EdgeStyle = 'none' | 'fillet' | 'chamfer';

/** One edge-modification entry. */
export interface EdgeSetting {
  target: EdgeTarget;
  style: EdgeStyle;
  radius: number; // mm
}

export type CropRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9';

/** Bambu-style image preprocessing. Adjustment values are multipliers, 1 = neutral. */
export interface PreprocessParams {
  cropRatio: CropRatio;
  keepBackground: boolean;
  thicknessMm: number;
  exposure: number;
  contrast: number;
  saturation: number;
  brightness: number;
  whiteBalance: number;
  highlights: number;
  shadows: number;
}

export const DEFAULT_PREPROCESS: PreprocessParams = {
  cropRatio: 'free',
  keepBackground: false,
  thicknessMm: 1,
  exposure: 1,
  contrast: 1,
  saturation: 1,
  brightness: 1,
  whiteBalance: 1,
  highlights: 1,
  shadows: 1,
};

/** Parameters the geometry worker needs to build the clicker (all mm).
 *  Design: the BODY is a solid block with a recessed well + raised border cut
 *  into the top; the cap nests INSIDE that well (button-in-bezel). */
export interface BuildParams {
  baseShape: BaseShapeKind;
  capWidthMm: number; // the cap (top) footprint; body = cap + tolerance + border
  topThickness: number; // solid base-color backing behind the image (min 1–2 mm)
  imageDepth: number; // how deep the colored image cuts in from the top
  imageMargin: number; // flat base-color frame between the image and the cap edge
  borderWidth: number; // raised body border around the cap (the bezel wall)
  capProud: number; // how far the cap top sticks up above the body border at rest (≈ travel → flush when pressed)
  tolerance: number; // slip-fit gap between cap outer wall and body well wall
  colorBleed: number; // tiny outward grow on each color so neighbors never leave a gap
  stepHeight: number; // mm per height level for raised color relief
  travel: number; // switch press travel the well must clear (~3.5–4 mm)
  floorThickness: number;
  keychainHole: boolean; // add a keyring loop on the body (+Y edge)
  baseFilamentRgb: RGB; // cap backing + stem color
  bodyColorRgb: RGB;
  /** Component-specific height levels (partName -> level integer) */
  componentHeights: Record<string, number>;
  /** Edge modifications (fillet / chamfer) for body and cap edges. */
  edgeSettings: EdgeSetting[];
}

/** Mesh payload (transferable). First 3 of each `numProp` stride are x,y,z. */
export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}

export type PartKind = 'cap' | 'body';
/** Which independently-movable object a part belongs to in the export. */
export type PartGroup = 'top' | 'base';

export interface ClickerPart extends MeshData {
  kind: PartKind;
  group: PartGroup;
  colorRgb: RGB;
  name: string;
  /** 1-based filament slot for slicer color assignment (shared per unique color). */
  extruder?: number;
}

/** A region with its resolved filament color, ready for the worker. */
export interface BuildRegion {
  filamentRgb: RGB;
  coverage: number; // fraction of foreground — drives carve priority (small detail wins)
  rings: Ring[];
  partName: string;
}

// ---- Worker messages ----
export type GeometryRequest =
  | { type: 'init'; socket: ArrayBuffer; stem: ArrayBuffer; switch: ArrayBuffer }
  | {
      type: 'buildClicker';
      regions: BuildRegion[];
      outline: Ring[];
      params: BuildParams;
    };

export type GeometryResponse =
  | { type: 'ready' }
  // `switchMesh` is the real MX switch, placed in the assembly frame for the preview
  // toggle (display only — never exported).
  | { type: 'initDone'; socketInfo: string; stemInfo: string; switchInfo: string; switchMesh: MeshData }
  | { type: 'parts'; parts: ClickerPart[] }
  | { type: 'error'; message: string };
