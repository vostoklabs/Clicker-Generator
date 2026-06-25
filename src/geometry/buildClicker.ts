// Core clicker construction. Runs in the geometry worker with the Manifold WASM
// kernel. See DEV_PLAN.md §6 and the user's "process explained on my model" refs.
//
// Design (button-in-bezel):
//   BASE (body): a SOLID block. Cut a recessed WELL into the top (leaving a raised
//        border), then cut the MX socket into the well floor. The cap nests INSIDE
//        the well; the body's border surrounds it.
//   TOP (cap): flat image plate + stem underneath, sized to drop into the well with
//        a `tolerance` slip-fit. No skirt — the body border is the bezel.
//
//   plate (cap)  = the image footprint + frame
//   well         = plate + tolerance            (cap slips in)
//   body outer   = plate + tolerance + border   (the bezel wall)
//
// The image occupies only the top `imageDepth` mm over a solid `topThickness`
// backing. Colors are carved as non-overlapping inlays (priority by coverage, so
// small details stay crisp) and removed from the backing — clean even when flat.
//
// Frame: Z = 0 is the switch plate top. socket cuts downward; stem rises to +Z.
import type { BuildParams, BuildRegion, ClickerPart, PartGroup, Ring, RGB } from '../types';

type Wasm = any;
type Solid = any;
type Section = any;

export function buildClicker(
  wasm: Wasm,
  socket: Solid,
  stem: Solid,
  regions: BuildRegion[],
  outline: Ring[],
  params: BuildParams,
): ClickerPart[] {
  const { Manifold, CrossSection } = wasm;
  const trash: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    trash.push(o);
    return o;
  };

  // --- Switch assets: drive the Z stack AND the minimum cap size ---
  const socketBB = socket.boundingBox();
  const stemBB = stem.boundingBox();
  const socketDim = Math.max(
    socketBB.max[0] - socketBB.min[0],
    socketBB.max[1] - socketBB.min[1],
  );

  // --- Normalized image bbox (trace centers it; longest side = 1) ---
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of outline) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) {
    minX = -0.5;
    maxX = 0.5;
    minY = -0.5;
    maxY = 0.5;
  }
  const nW = maxX - minX || 1;
  const nH = maxY - minY || 1;

  // --- Sizing. Image fits INSIDE the frame; the cap must be wide enough that the
  //     well (cap + tolerance) contains the switch socket. ---
  const border = Math.max(0, params.imageMargin);
  const tol = Math.max(0.05, params.tolerance);
  // The cup must always expose a clear column over the switch — its footprint plus
  // the MX top housing plus clearance — so the switch drops in even when the outline
  // is concave (a notch) or the cap is small. The cap is sized to cover that column.
  const switchClear = socketDim + 3.0;
  const minCap = switchClear + 1.0;
  const isOutline = params.baseShape !== 'circle' && params.baseShape !== 'square';

  let imageScale = Math.max(2, params.capWidthMm - 2 * border);
  let imgW = nW * imageScale;
  let imgH = nH * imageScale;
  if (isOutline && Math.min(imgW, imgH) + 2 * border < minCap) {
    imageScale *= (minCap - 2 * border) / Math.min(imgW, imgH);
    imgW = nW * imageScale;
    imgH = nH * imageScale;
  }
  const sR = imageScale;

  const scaleRings = (rings: Ring[]): Ring[] =>
    rings.map((r) => r.map(([x, y]) => [x * sR, y * sR] as [number, number]));

  const removeHoles = (cs: Section): Section => {
    if (sectionIsEmpty(cs)) return cs;
    
    // Create a giant bounding rectangle that definitely covers the shape
    const rect = track(CrossSection.square([1000, 1000], true));
    
    // Invert the shape. The outer space becomes one giant solid, 
    // and internal holes become smaller separate solid islands.
    const inverted = track(rect.subtract(cs));
    
    // Break the inverted shape into its disconnected islands
    const islands = [...inverted.decompose()];
    
    if (islands.length <= 1) {
      return cs; // No holes found
    }
    
    // The outer space is the island with the largest area (~1,000,000)
    let maxArea = -1;
    let outerSpace = islands[0];
    for (let i = 0; i < islands.length; i++) {
      const area = islands[i].area();
      if (area > maxArea) {
        maxArea = area;
        outerSpace = islands[i];
      }
    }
    
    // Subtract the outer space from the giant rectangle to recover the shape,
    // but now with all internal holes filled!
    return track(rect.subtract(outerSpace));
  };

  const filledOutline = (): Section => {
    const validRings = scaleRings(outline).filter((r) => r.length >= 3);
    if (validRings.length === 0) {
      return track(CrossSection.square([sR, sR], true));
    }
    return track(new CrossSection(validRings, 'NonZero'));
  };

  const roundedRect = (w: number, h: number, r: number): Section => {
    const rr = Math.max(0.1, Math.min(r, Math.min(w, h) / 2 - 0.01));
    const core = track(
      CrossSection.square([Math.max(0.2, w - 2 * rr), Math.max(0.2, h - 2 * rr)], true),
    );
    return track(core.offset(rr, 'Round', 2.0, 64));
  };

  const grow = (sec: Section, d: number): Section =>
    d <= 0.001 ? sec : track(sec.offset(d, 'Round', 2.0, 64));
  const shrink = (sec: Section, d: number, fb: Section): Section => {
    if (d <= 0.01) return sec;
    const r = track(sec.offset(-d, 'Round', 2.0, 64));
    return sectionIsEmpty(r) ? fb : r;
  };

  // --- Cap plate footprint (the visible top; image + frame) ---
  let plate: Section;
  if (params.baseShape === 'circle') {
    const d = Math.max(Math.hypot(imgW, imgH) + 2 * border, minCap);
    plate = track(CrossSection.circle(d / 2, 160));
  } else if (params.baseShape === 'square') {
    const w = Math.max(imgW + 2 * border, minCap);
    const h = Math.max(imgH + 2 * border, minCap);
    plate = roundedRect(w, h, Math.min(w, h) * 0.22);
  } else {
    const rawPlate = track(filledOutline().offset(border, 'Round', 2.0, 48));
    const solidPlate = removeHoles(rawPlate);
    // Apply morphological closing (+offset followed by -offset) to smooth out 
    // deep scalloped indentations between letters. This prevents the clicker
    // from binding or sticking due to excessive friction in the sharp valleys.
    const smoothingRadius = 4.0;
    plate = track(solidPlate.offset(smoothingRadius, 'Round', 2.0, 48).offset(-smoothingRadius, 'Round', 2.0, 48));
  }

  const imageArea = shrink(plate, border, plate); // flat frame around the image
  // Well = cap footprint (slip-fit) UNIONED with a guaranteed clear column over the
  // switch, so a concave outline or small cap can never wall off the socket. The body
  // border then wraps whatever shape the well becomes — it bulges out only where a
  // notch would otherwise block the switch.
  const socketColumn = roundedRect(switchClear, switchClear, 2.5); // centered on the switch axis
  const wellFootprint = track(grow(plate, tol).add(socketColumn)); // cap slips in with `tol`
  const bodyFootprint = grow(wellFootprint, Math.max(0.4, params.borderWidth));

  // --- Z layout (shared assembly frame: Z = 0 is the switch-plate top) ---
  const cavityFloorZ = socketBB.max[2]; // socket top = plate plane (≈ 0); the well opens to it
  const slabBottomZ = stemBB.max[2]; // cap underside = stem top = rest float above the plate
  const backing = Math.max(0.8, params.topThickness);
  const imageDepth = Math.max(0.2, params.imageDepth);
  const slabTopZ = slabBottomZ + backing + imageDepth; // flat image surface (top)
  const imageBottomZ = slabBottomZ + backing; // colors live above this
  const travel = Math.max(0, params.travel);

  // The body border top sits `capProud` below the cap top, so pressing the cap down
  // by `travel` brings its top flush with the border (rest = a proud pressable button;
  // full press = flush — matching ianku's reference). capProud ≈ travel. (The old
  // clamp to capThickness made thin caps rest nearly flush — that was the bug.)
  const bodyBottomZ = socketBB.min[2] - params.floorThickness;
  const maxProud = Math.max(0.4, slabTopZ - cavityFloorZ - 1.0); // leave ≥1 mm of border
  const capProud = Math.max(0.4, Math.min(params.capProud, maxProud));
  const bodyTopZ = slabTopZ - capProud;
  const wellFloorZ = Math.min(cavityFloorZ, slabBottomZ - travel);

  // Cap skirt: a thin wall hanging from the cap perimeter down into the well. It
  // bridges the side gap the proud float opens up, so the switch isn't visible from
  // the side. It rides in the `tol` slip-gap (never touches the border) and
  // telescopes deeper as the cap is pressed. Reach `skirtOverlap` below the border
  // top, but stop short of crashing into the well floor at full press.
  const skirtThickness = 1.4;
  const skirtOverlap = 1.5;
  const skirtBottomZ = Math.max(wellFloorZ + travel + 0.5, bodyTopZ - skirtOverlap);
  const skirtLen = slabBottomZ - skirtBottomZ;

  const extrudeAt = (cs: Section, h: number, z: number): Solid =>
    track(track(Manifold.extrude(cs, h)).translate([0, 0, z]));

  const parts: ClickerPart[] = [];

  // --- Cap plate (backing + image layer), flat top, + stem underneath ---
  const cap: Solid = extrudeAt(plate, backing + imageDepth, slabBottomZ);

  // --- Image inlays: carved non-overlapping, smallest coverage first so detail
  //     colors win at shared boundaries. Clean even when all colors are flat.
  //     topSlab is exactly `imageDepth` tall so inlays end flush with the cap's
  //     top face (slabTopZ) — the top reads as ONE flat surface, not raised. ---
  const topSlab = extrudeAt(imageArea, imageDepth, imageBottomZ);
  const ordered = regions
    .map((r) => ({ r }))
    .sort((a, b) => (a.r.coverage ?? 1) - (b.r.coverage ?? 1));
  let placed: Solid | null = null; // union of inlays already carved (no overlap)
  let inlayUnion: Solid | null = null; // union of all inlays (removed from base)
  for (const { r } of ordered) {
    let cs: Section = track(new CrossSection(scaleRings(r.rings), 'NonZero'));
    if (params.colorBleed > 0.001) cs = grow(cs, params.colorBleed);
    const clipped = track(cs.intersect(imageArea));
    if (sectionIsEmpty(clipped)) continue;
    const prism = extrudeAt(clipped, imageDepth + 2, imageBottomZ - 1);
    let inlay: Solid = track(topSlab.intersect(prism));
    if (placed) inlay = track(inlay.subtract(placed)); // don't overlap earlier colors
    if (inlay.isEmpty()) continue;

    const level = Math.max(0, r.heightLevel ?? 0);
    if (level > 0) {
      const lift = extrudeAt(clipped, level * params.stepHeight, slabTopZ - 0.01);
      inlay = track(inlay.add(lift));
    }
    parts.push(toPart(inlay, 'cap', 'top', r.filamentRgb, r.partName));
    placed = placed ? track(placed.add(inlay)) : inlay;
    inlayUnion = inlayUnion ? track(inlayUnion.add(inlay)) : inlay;
  }

  // Base-color cap = plate − inlays, then ∪ stem ∪ perimeter skirt.
  let base: Solid = inlayUnion ? track(cap.subtract(inlayUnion)) : cap;
  base = track(base.add(stem));
  if (skirtLen > 0.4) {
    // Root issue: any 2-D ring-minus-stemZone is algebraically identical to
    // punching a notch in the border. The only notch-free approach is to ensure
    // the skirt base plate's outer edge is already OUTSIDE the stem zone, so no
    // material ever needs to be removed.
    //
    // Strategy: expand the skirt plate outward by unioning it with a rounded rect
    // that is (12 + 2×skirtThickness) wide — guaranteeing the ring's INNER edge
    // sits exactly at the 12 mm stem-clear boundary. The ring outer edge is wherever
    // the original plate or this guard square is larger (whichever is further out).
    // No subtraction → no notch → continuous border.
    //
    // Z flush: where skirtBasePlate exceeds the original cap plate we add a thin
    // backing fill so the skirt top has something solid above it (no ledge/gap).
    const stemGuard = 12 + 2 * skirtThickness; // inner edge lands exactly at ±6 mm
    const stemGuardCs = track(CrossSection.square([stemGuard, stemGuard], true));
    const skirtBasePlate = track(plate.add(stemGuardCs));
    const skirtInner = track(skirtBasePlate.offset(-skirtThickness, 'Round', 2.0, 64));
    if (!sectionIsEmpty(skirtInner)) {
      const skirtRing = track(skirtBasePlate.subtract(skirtInner));
      // +0.3 overlaps up into the plate so the union is volumetric (no coplanar seam).
      const skirt = extrudeAt(skirtRing, skirtLen + 0.3, skirtBottomZ);
      base = track(base.add(skirt));
      // Fill any area where skirtBasePlate extends beyond the original cap plate,
      // at the cap-underside level, so the skirt top is flush (no Z gap or step).
      const skirtExtension = track(skirtBasePlate.subtract(plate));
      if (!sectionIsEmpty(skirtExtension)) {
        // Extend the fill all the way from the skirt bottom to the cap top face
        // so the expanded area is level with the top surface — no step, no ledge.
        const capFill = extrudeAt(skirtExtension, slabTopZ - skirtBottomZ, skirtBottomZ);
        base = track(base.add(capFill));
      }
    }
  }
  parts.unshift(toPart(base, 'cap', 'top', params.baseFilamentRgb, 'top-base'));

  // --- Body: solid block − well − socket. The well is the cup the cap presses into;
  //     the border ring around it frames the proud cap (and the cap's skirt hides the
  //     gap). The socket is cut into the well floor (= plate plane) to grip the switch. ---
  const bodyBlock = extrudeAt(bodyFootprint, bodyTopZ - bodyBottomZ, bodyBottomZ);
  const well = extrudeAt(wellFootprint, bodyTopZ - wellFloorZ + 1, wellFloorZ);
  let body: Solid = track(track(bodyBlock.subtract(well)).subtract(socket));

  // Optional keychain loop: a disc tab on the +Y edge with a ring hole through it.
  if (params.keychainHole && !body.isEmpty()) {
    const bb = bodyFootprint.bounds();
    const loopR = 5.0;
    const holeR = 2.6;
    const cy = bb.max[1] + loopR * 0.35; // overlaps the body so it fuses
    const th = Math.max(2.5, Math.min(4.0, (bodyTopZ - bodyBottomZ) * 0.35));
    const zb = bodyBottomZ + 1.5;
    const loop = extrudeAt(track(CrossSection.circle(loopR, 64).translate([0, cy])), th, zb);
    const hole = extrudeAt(track(CrossSection.circle(holeR, 48).translate([0, cy])), th + 2, zb - 1);
    body = track(track(body.add(loop)).subtract(hole));
  }

  if (!body.isEmpty()) {
    parts.push(toPart(body, 'body', 'base', params.bodyColorRgb, 'base-body'));
  }

  for (const o of trash) {
    try {
      o.delete();
    } catch {
      /* already freed */
    }
  }

  return parts;

  function toPart(
    solid: Solid,
    kind: 'cap' | 'body',
    group: PartGroup,
    colorRgb: RGB,
    name: string,
  ): ClickerPart {
    const mesh = solid.getMesh();
    return {
      kind,
      group,
      colorRgb,
      name,
      numProp: mesh.numProp,
      vertProperties: new Float32Array(mesh.vertProperties),
      triVerts: new Uint32Array(mesh.triVerts),
    };
  }
}

function sectionIsEmpty(cs: Section): boolean {
  try {
    if (typeof cs.isEmpty === 'function') return cs.isEmpty();
    const b = cs.bounds();
    return !(b.max[0] > b.min[0] && b.max[1] > b.min[1]);
  } catch {
    return false;
  }
}
