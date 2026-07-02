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
import type { BuildParams, BuildRegion, ClickerPart, EdgeSetting, EdgeStyle, PartGroup, Ring, RGB } from '../types';

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

  // Traced outlines carry thousands of vertices, and round offsets (esp. the plate
  // closing) balloon that further. Every downstream offset/extrude/boolean scales with
  // vertex count, so collapsing near-collinear points to a print-invisible tolerance
  // (~0.04 mm at 35 mm scale) is the single biggest speed lever in the whole build.
  const simp = (s: Section, eps = 0.04): Section => {
    try {
      return typeof s.simplify === 'function' ? track(s.simplify(eps)) : s;
    } catch {
      return s;
    }
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
  const isOutline = params.baseShape === 'outline';

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

  const getRingArea = (ring: Ring): number => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(area / 2);
  };

  const filledOutline = (): Section => {
    const validRings = scaleRings(outline).filter((r) => r.length >= 3 && getRingArea(r) > 0.001);
    if (validRings.length === 0) {
      return track(CrossSection.square([sR, sR], true));
    }
    // Simplify the raw trace BEFORE any offset/boolean — the densest polygon in the
    // build, so trimming it here cascades a speedup through the entire pipeline.
    return simp(track(new CrossSection(validRings, 'NonZero')), 0.03);
  };

  const roundedRect = (w: number, h: number, r: number): Section => {
    const rr = Math.max(0.1, Math.min(r, Math.min(w, h) / 2 - 0.01));
    const core = track(
      CrossSection.square([Math.max(0.2, w - 2 * rr), Math.max(0.2, h - 2 * rr)], true),
    );
    return track(core.offset(rr, 'Round', 2.0, 32));
  };

  const grow = (sec: Section, d: number): Section =>
    d <= 0.001 ? sec : track(sec.offset(d, 'Round', 2.0, 32));
  const shrink = (sec: Section, d: number, fb: Section): Section => {
    if (d <= 0.01) return sec;
    const r = track(sec.offset(-d, 'Round', 2.0, 32));
    return sectionIsEmpty(r) ? fb : r;
  };

  // --- Shape Generators ---
  const makeHexagon = (r: number): Section => {
    const pts: Ring = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 6;
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    return track(new CrossSection([pts], 'NonZero'));
  };

  const makeStar = (r: number, points = 5): Section => {
    // Cute chubby star: short legs (high inner radius) with rounded tips AND valleys
    // — not a spiky communist star.
    const innerR = r * 0.56; // was 0.4 → long spikes; higher = shorter, fatter legs
    const pts: Ring = [];
    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI / points) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : innerR;
      pts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    const sharp = track(new CrossSection([pts], 'NonZero'));
    // Opening-then-closing (−rr, +2rr, −rr nets to zero size) rounds the convex tips
    // and the concave valleys while keeping the star's overall radius.
    const rr = r * 0.13;
    const a = track(sharp.offset(-rr, 'Round', 2.0, 64));
    const b = track(a.offset(2 * rr, 'Round', 2.0, 64));
    return track(b.offset(-rr, 'Round', 2.0, 64));
  };

  const makeHeart = (r: number): Section => {
    // Emoji-style heart: two genuinely round circular lobes on top, unioned with a
    // diamond (a square rotated 45°) whose lower edges form the bottom point. This
    // is the classic "two circles + square" construction. Built in raw units with
    // the point at the origin, then centered and scaled to fit within radius r.
    const h = 1 / Math.SQRT2; // half-diagonal of a unit-side square
    const lobeR = 0.5; // each top edge of the square is a lobe diameter
    const lobeX = h / 2; // lobe centers sit on the midpoints of the top edges
    const lobeY = 1.5 * h;
    const maxX = lobeX + lobeR; // raw bbox half-width
    const cy = (lobeY + lobeR) / 2; // raw bbox vertical centre
    const scale = r / Math.max(maxX, cy);
    const seg = 128;
    const circleRing = (ox: number): Ring => {
      const ring: Ring = [];
      for (let i = 0; i < seg; i++) {
        const a = (Math.PI * 2 * i) / seg;
        ring.push([
          (ox + lobeR * Math.cos(a)) * scale,
          (lobeY - cy + lobeR * Math.sin(a)) * scale,
        ]);
      }
      return ring;
    };
    const diamondRing: Ring = [
      [0, (0 - cy) * scale],
      [h * scale, (h - cy) * scale],
      [0, (2 * h - cy) * scale],
      [-h * scale, (h - cy) * scale],
    ];
    const diamond = track(new CrossSection([diamondRing], 'NonZero'));
    const lobeL = track(new CrossSection([circleRing(-lobeX)], 'NonZero'));
    const lobeR2 = track(new CrossSection([circleRing(lobeX)], 'NonZero'));
    return track(track(diamond.add(lobeL)).add(lobeR2));
  };

  const makeEgg = (r: number): Section => {
    // Chicken-egg profile: an upright oval, taller than wide, with a rounder/fatter
    // bottom and a narrower top. `width` sets the aspect ratio; `taper` tapers the
    // width from bottom (fatter) to top (narrower) so the widest point sits below
    // centre, like a real egg.
    const steps = 96;
    const width = 0.74; // half-width vs half-height (egg is taller than wide)
    const taper = 0.26; // top-vs-bottom narrowing
    const raw: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      const t = (Math.PI * 2 * i) / steps;
      const y = r * Math.sin(t);
      const x = r * width * Math.cos(t) * (1 - taper * Math.sin(t));
      raw.push([x, y]);
    }
    // Recenter on the area centroid so content at the origin (image + switch) sits at
    // the egg's visual centre of mass — the lower bulb — instead of the taller
    // geometric mid-line, which reads as sitting too high.
    let area = 0, cx = 0, cy = 0;
    for (let i = 0, j = raw.length - 1; i < raw.length; j = i++) {
      const cross = raw[j][0] * raw[i][1] - raw[i][0] * raw[j][1];
      area += cross;
      cx += (raw[j][0] + raw[i][0]) * cross;
      cy += (raw[j][1] + raw[i][1]) * cross;
    }
    area *= 0.5;
    cx /= 6 * area;
    cy /= 6 * area;
    const pts: Ring = raw.map(([x, y]) => [x - cx, y - cy]);
    return track(new CrossSection([pts], 'NonZero'));
  };

  // --- Cap plate footprint (the visible top; image + frame) ---
  let plate: Section;
  if (params.baseShape === 'outline') {
    const rawPlate = track(filledOutline().offset(border, 'Round', 2.0, 32));
    const solidPlate = removeHoles(rawPlate);
    // Apply morphological closing (+offset followed by -offset) to smooth out
    // deep scalloped indentations between letters. This prevents the clicker
    // from binding or sticking due to excessive friction in the sharp valleys.
    // Then simplify: the round closing fills perimeter arcs with hundreds of points
    // that every later op would carry — collapse them to a print-invisible tolerance.
    const smoothingRadius = 4.0;
    plate = simp(track(solidPlate.offset(smoothingRadius, 'Round', 2.0, 24).offset(-smoothingRadius, 'Round', 2.0, 24)), 0.05);
  } else {
    // The geometric shapes scale linearly with their radius, so rather than guessing
    // a circumscribing radius (which clips the image on concave shapes like the star
    // or heart), we scale the shape up just enough that the whole image PLUS the
    // border frame fits inside it.
    const genShape = (rr: number): Section => {
      switch (params.baseShape) {
        case 'square': return roundedRect(2 * rr, 2 * rr, 2 * rr * 0.22);
        case 'hexagon': return makeHexagon(rr);
        case 'heart': return makeHeart(rr);
        case 'star': return makeStar(rr);
        case 'egg': return makeEgg(rr);
        case 'circle':
        default: return track(CrossSection.circle(rr, 160));
      }
    };
    // Rectangle (half-extents) that must sit inside the plate: image + border, with a
    // floor so tiny images still produce a sensible cap.
    const halfW = Math.max(imgW / 2 + border, minCap / 2);
    const halfH = Math.max(imgH / 2 + border, minCap / 2);
    const unit = genShape(1); // test the image rect against the r = 1 shape
    const fits = (k: number): boolean => {
      const rect = track(CrossSection.square([(2 * halfW) / k, (2 * halfH) / k], true));
      const outside = track(rect.subtract(unit));
      return sectionIsEmpty(outside);
    };
    // Bracket an upper bound that fits, then binary-search the smallest radius.
    let hi = Math.max(1, Math.hypot(halfW, halfH));
    for (let i = 0; i < 40 && !fits(hi); i++) hi *= 2;
    let lo = 1e-3;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    plate = genShape(hi);
  }

  const imageArea = shrink(plate, border, plate); // flat frame around the image
  // Well = cap footprint (slip-fit) UNIONED with a guaranteed clear column over the
  // switch, so a concave outline or small cap can never wall off the socket. The body
  // border then wraps whatever shape the well becomes — it bulges out only where a
  // notch would otherwise block the switch.
  const socketColumn = roundedRect(switchClear, switchClear, 2.5); // centered on the switch axis
  const wellFootprint = simp(track(grow(plate, tol).add(socketColumn))); // cap slips in with `tol`
  const bodyFootprint = simp(grow(wellFootprint, Math.max(0.4, params.borderWidth)));

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
  // full press = flush). capProud ≈ travel.
  const bodyBottomZ = socketBB.min[2] - params.floorThickness;
  const maxProud = Math.max(0.4, slabTopZ - cavityFloorZ - 1.0); // leave ≥1 mm of border
  const capProud = Math.max(0.4, Math.min(params.capProud, maxProud));
  const bodyTopZ = slabTopZ - capProud;
  const wellFloorZ = Math.min(cavityFloorZ, slabBottomZ - travel);

  // Cap skirt: a thin wall hanging from the cap perimeter down into the well.
  // The bottom of the skirt (the border of the top part) aligns exactly with the bottom
  // of the stem so that the top part can stand completely flat on a table.
  const skirtThickness = 1.4;
  const skirtBottomZ = stemBB.min[2];
  const skirtLen = slabBottomZ - skirtBottomZ;

  const extrudeAt = (cs: Section, h: number, z: number): Solid => {
    if (sectionIsEmpty(cs)) {
      // Return a tiny cube far away or hidden inside, to avoid typing issues or we can just try to avoid calling it
      // Actually, Manifold handles empty cross sections by returning an empty solid IF we don't crash.
      // Wait, Manifold.extrude DOES crash on empty CrossSection. 
      // Let's create a tiny solid and subtract it from itself to get a true empty solid.
      const dummy = track(track(Manifold.extrude(track(CrossSection.circle(0.1, 3)), 0.1)).translate([0, 0, z]));
      return track(dummy.subtract(dummy));
    }
    return track(track(Manifold.extrude(cs, Math.max(0.01, h))).translate([0, 0, z]));
  };

  // Build the solid to SUBTRACT from a part to bevel (chamfer) one of its horizontal
  // edges, as a single-face true chamfer via scaled extrusion — no stepped staircase,
  // so it stays cheap. `outer` grows the cutter past the wall so it never shares a
  // coplanar face with it (coplanar faces z-fight in the preview).
  //
  // (The old per-step fillet path was removed: only the default fixed chamfers run now,
  // so anything non-'none' is treated as a chamfer.)
  const createEdgeBevelBlock = (footprint: Section, r: number, _style: EdgeStyle, zRef: number, isBottom: boolean): Solid | null => {
      const outer = grow(footprint, 0.6); // extends the cutter just beyond the wall

      const b = footprint.bounds();
      const W = b.max[0] - b.min[0];
      const H = b.max[1] - b.min[1];
      const cx = (b.min[0] + b.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2;

      const scaleX = W > 0.01 ? Math.max(0.01, (W - 2 * r) / W) : 1;
      const scaleY = H > 0.01 ? Math.max(0.01, (H - 2 * r) / H) : 1;

      // Center the 2D sections so extrude's scaleTop pivots about the footprint center.
      const centeredOuter = track(outer.translate([-cx, -cy]));
      const centeredFp = track(footprint.translate([-cx, -cy]));

      const boundingVolume = track(Manifold.extrude(centeredOuter, r + 0.02));
      const partVolume = track(Manifold.extrude(centeredFp, r + 0.02, 0, 0, [scaleX, scaleY]));

      let cutter = track(boundingVolume.subtract(partVolume));
      cutter = track(cutter.translate([cx, cy, 0]));

      if (isBottom) {
        // Mirror along Z so the chamfer slopes outwards toward the bottom face.
        cutter = track(
          cutter.translate([0, 0, -(r + 0.02) / 2])
            .scale([1, 1, -1])
            .translate([0, 0, (r + 0.02) / 2]),
        );
      }

      const stepZ = isBottom ? zRef - 0.02 : zRef - r;
      return track(cutter.translate([0, 0, stepZ]));
  };

  const parts: ClickerPart[] = [];

  // --- Cap plate (backing + image layer), flat top, + stem underneath ---
  const cap: Solid = extrudeAt(plate, backing + imageDepth, slabBottomZ);

  // --- Image inlays: carved non-overlapping, smallest coverage first so detail
  //     colors win at shared boundaries. Clean even when all colors are flat.
  //     topSlab is exactly `imageDepth` tall so inlays end flush with the cap's
  //     top face (slabTopZ) — the top reads as ONE flat surface, not raised. ---
  const ordered = regions
    .map((r) => ({ r }))
    .sort((a, b) => (a.r.coverage ?? 1) - (b.r.coverage ?? 1));
    
  let placed2D: Section | null = null; // 2D union of inlays already carved (no overlap)
  const holesByLevel = new Map<number, Section>();

  for (const { r } of ordered) {
    const validRings = scaleRings(r.rings).filter(ring => ring.length >= 3 && getRingArea(ring) > 0.001);
    if (validRings.length === 0) continue;
    let cs: Section = simp(track(new CrossSection(validRings, 'NonZero')), 0.03);
    if (params.colorBleed > 0.001) cs = grow(cs, params.colorBleed);
    const clipped = track(cs.intersect(imageArea));
    if (sectionIsEmpty(clipped)) continue;
    
    // Prevent overlapping with smaller parts processed earlier
    let fp = clipped;
    if (placed2D) fp = track(fp.subtract(placed2D));
    if (sectionIsEmpty(fp)) continue;
    
    placed2D = placed2D ? track(placed2D.add(fp)) : fp;

    const level = params.componentHeights?.[r.partName] ?? 0;
    const heightShift = level * params.stepHeight;
    const topZ = slabTopZ + Math.max(0, heightShift);
    const bottomZ = imageBottomZ + Math.min(0, heightShift);
    
    let inlay: Solid = extrudeAt(fp, topZ - bottomZ, bottomZ);
    if (inlay.isEmpty()) continue;

    // Round (fillet) or bevel (chamfer) the TOP edge of this color part only if the
    // user explicitly configured it in Edges mode. Default: no rounding on inlays —
    // only the outer cap frame and body edges get the default fillet.
    const es = params.edgeSettings?.find(s => s.target === r.partName);
    if (es && es.style !== 'none' && es.radius >= 0.05) {
      // The bevel can't exceed roughly half the part's height, so on a flat color
      // layer it stays subtle; extrude the part first for a bigger fillet.
      const radius = Math.min(es.radius, (topZ - bottomZ) * 0.49, 3.0);
      if (radius >= 0.05) {
        const modBlock = createEdgeBevelBlock(fp, radius, es.style, topZ, false);
        if (modBlock) inlay = track(inlay.subtract(modBlock));
      }
    }

    parts.push(toPart(inlay, 'cap', 'top', r.filamentRgb, r.partName));
    
    // Group the 2D footprint by its level to carve a single hole per height level
    const existing = holesByLevel.get(level);
    holesByLevel.set(level, existing ? track(existing.add(fp)) : fp);
  }

  // Base-color cap = plate − holes, then ∪ stem ∪ perimeter skirt.
  let base: Solid = cap;
  for (const [level, hole2D] of holesByLevel.entries()) {
    const heightShift = level * params.stepHeight;
    const bottomZ = imageBottomZ + Math.min(0, heightShift);
    const holePrism = extrudeAt(hole2D, slabTopZ - bottomZ + 0.02, bottomZ - 0.01);
    base = track(base.subtract(holePrism));
  }
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
    const skirtInner = track(skirtBasePlate.offset(-skirtThickness, 'Miter', 2.0));
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
  let body: Solid = bodyBlock;

  // Apply edge modifications (fillet / chamfer) to the body block first,
  // before adding the keychain loop and bridge, so that the bevel block
  // subtraction does not cut a groove through the keychain loop/bridge.
  body = applyEdges(body, params.edgeSettings, bodyFootprint, bodyBottomZ, bodyTopZ, wellFloorZ);

  // Optional keychain loop: a disc tab on the +Y edge with a ring hole through it.
  if (params.keychainHole) {
    const bb = bodyFootprint.bounds();
    const loopR = 5.0;
    const holeR = 2.6;
    const cy = bb.max[1] + loopR * 0.35; // overlaps the body so it fuses
    const th = Math.max(2.5, Math.min(4.0, (bodyTopZ - bodyBottomZ) * 0.35));
    const zb = bodyBottomZ;

    // Create a circular loop and a short bridge into the +Y edge. Keep the bridge
    // local to the loop: spanning it to the opposite body bound can leave an
    // unwanted strip after the well is subtracted.
    const loopCircle = track(CrossSection.circle(loopR, 64).translate([0, cy]));
    const bodyDepth = Math.max(0, bb.max[1] - bb.min[1]);
    const bridgeDepth = Math.min(bodyDepth, loopR * 1.1);
    const bridgeBottomY = bb.max[1] - bridgeDepth;
    const bridgeHeight = cy - bridgeBottomY;
    const bridge = track(CrossSection.square([loopR * 2, bridgeHeight], true).translate([0, bridgeBottomY + bridgeHeight / 2]));
    const loopFootprint = track(loopCircle.add(bridge));

    const loop = extrudeAt(loopFootprint, th, zb);
    const hole = extrudeAt(track(CrossSection.circle(holeR, 48).translate([0, cy])), th + 2, zb - 1);
    body = track(track(body.add(loop)).subtract(hole));
  }

  // Subtract the well and socket afterwards to ensure the interior cavity is clean
  body = track(track(body.subtract(well)).subtract(socket));

  if (!body.isEmpty()) {
    parts.push(toPart(body, 'body', 'base', params.bodyColorRgb, 'base-body'));
  }

  // --- Cap edge modifications. 'capTop' is the global cap-top edge; 'top-base' is
  //     the cap frame selected directly in Edges mode. Both round the cap's top rim. ---
  if (parts.length > 0) {
    const basePartIdx = parts.findIndex(p => p.name === 'top-base');
    if (basePartIdx >= 0) {
      for (const es of params.edgeSettings) {
        if ((es.target === 'capTop' || es.target === 'top-base') && es.style !== 'none') {
          const r = Math.min(es.radius, (backing + imageDepth) * 0.4, 2.5);
          if (r > 0.05) {
            const modBlock = createEdgeBevelBlock(plate, r, es.style, slabTopZ, false);
            if (modBlock) {
              base = track(base.subtract(modBlock));
              parts[basePartIdx] = toPart(base, 'cap', 'top', params.baseFilamentRgb, 'top-base');
            }
          }
        }
      }
    }
  }

  for (const o of trash) {
    try {
      o.delete();
    } catch {
      /* already freed */
    }
  }

  return parts;

  /** Apply fillet/chamfer edge modifications to the body solid.
   *  Targets: 'clickerBase' is the merged global control that bevels the body's top
   *  AND bottom edges together; 'baseTop'/'baseBottom' remain for older saved projects;
   *  'base-body' is the body part selected directly in Edges mode (rounds its top rim).
   *  Cap and inlay targets are handled elsewhere. */
  function applyEdges(
    bodyIn: Solid,
    edgeSettings: EdgeSetting[],
    footprint: Section,
    bottomZ: number,
    topZ: number,
    _wellFloorZ: number,
  ): Solid {
    let result = bodyIn;
    for (const es of edgeSettings) {
      if (es.style === 'none' || es.radius < 0.05) continue;
      const doBodyTop = es.target === 'baseTop' || es.target === 'base-body' || es.target === 'clickerBase';
      const doBodyBottom = es.target === 'baseBottom' || es.target === 'clickerBase';
      if (!doBodyTop && !doBodyBottom) continue; // cap / inlay targets handled elsewhere
      const r = Math.min(es.radius, (topZ - bottomZ) * 0.3, 2.5);
      if (r < 0.05) continue;

      if (doBodyTop) {
        const modBlock = createEdgeBevelBlock(footprint, r, es.style, topZ, false);
        if (modBlock) result = track(result.subtract(modBlock));
      }
      if (doBodyBottom) {
        const modBlock = createEdgeBevelBlock(footprint, r, es.style, bottomZ, true);
        if (modBlock) result = track(result.subtract(modBlock));
      }
    }
    return result;
  }

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
