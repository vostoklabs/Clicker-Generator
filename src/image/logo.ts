import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { RegionSet, Ring, RGB } from '../types';

function parseColor(colorStr: string): RGB {
  try {
    const c = new THREE.Color(colorStr);
    return [
      Math.round(c.r * 255),
      Math.round(c.g * 255),
      Math.round(c.b * 255)
    ];
  } catch {
    return [255, 255, 255]; // fallback
  }
}

function strokeGeomToContours(geom: THREE.BufferGeometry): Ring[] {
  const pos = geom.getAttribute('position');
  if (!pos) return [];
  const idx = geom.getIndex();
  const contours: Ring[] = [];

  const getTri = idx
    ? (t: number) => [idx.array[t * 3], idx.array[t * 3 + 1], idx.array[t * 3 + 2]]
    : (t: number) => [t * 3, t * 3 + 1, t * 3 + 2];

  const nTris = (idx ? idx.array.length : pos.count) / 3;
  for (let t = 0; t < nTris; t++) {
    const [ia, ib, ic] = getTri(t);
    const ax = pos.getX(ia), ay = pos.getY(ia);
    const bx = pos.getX(ib), by = pos.getY(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic);

    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;

    if (area > 0) {
      contours.push([[ax, ay], [bx, by], [cx, cy]]);
    } else {
      contours.push([[ax, ay], [cx, cy], [bx, by]]);
    }
  }
  return contours;
}

export function parseSvg(svgText: string): RegionSet {
  const data = new SVGLoader().parse(svgText);
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );

  const groups = new Map<string, { rgb: RGB; rings: Ring[] }>();

  function addRings(rgb: RGB, rings: Ring[]) {
    const hex = rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    let g = groups.get(hex);
    if (!g) {
      g = { rgb, rings: [] };
      groups.set(hex, g);
    }
    g.rings.push(...rings);
  }

  for (const path of data.paths) {
    const style = path.userData?.style || {};
    const hasFill = style.fill && style.fill !== 'none';
    const hasStroke = style.stroke && style.stroke !== 'none';

    // Filled paths
    if (hasFill) {
      const rgb = parseColor(style.fill);
      const shapes = SVGLoader.createShapes(path);
      for (const shape of shapes) {
        const points = shape.getPoints(16);
        if (points.length >= 3) {
          if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
          const ring: Ring = [];
          for (const p of points) {
            box.expandByPoint(p);
            ring.push([p.x, p.y]);
          }
          addRings(rgb, [ring]);
        }
        for (const hole of shape.holes) {
          const hp = hole.getPoints(16);
          if (hp.length >= 3) {
            if (!THREE.ShapeUtils.isClockWise(hp)) hp.reverse();
            const ring: Ring = [];
            for (const p of hp) {
              box.expandByPoint(p);
              ring.push([p.x, p.y]);
            }
            addRings(rgb, [ring]);
          }
        }
      }
    }

    // Stroke-only paths
    if (hasStroke && !hasFill) {
      const rgb = parseColor(style.stroke);
      const strokeStyle = SVGLoader.getStrokeStyle(
        style.strokeWidth || 1,
        style.stroke,
        style.strokeLineCap || 'butt',
        style.strokeLineJoin || 'miter',
        style.strokeMiterLimit || 4
      );
      for (const sub of path.subPaths) {
        const pts = sub.getPoints(32);
        if (pts.length < 2) continue;
        const geom = SVGLoader.pointsToStroke(pts, strokeStyle);
        if (!geom) continue;
        const pos = geom.getAttribute('position');
        if (!pos || pos.count === 0) continue;
        for (let i = 0; i < pos.count; i++) {
          box.expandByPoint(new THREE.Vector2(pos.getX(i), pos.getY(i)));
        }
        const strokeRings = strokeGeomToContours(geom);
        addRings(rgb, strokeRings);
        geom.dispose();
      }
    }
  }

  const allRings: Ring[] = [];
  groups.forEach(g => allRings.push(...g.rings));

  if (allRings.length === 0) {
    throw new Error('No drawable paths found in this SVG.');
  }

  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const maxSide = Math.max(dx, dy) || 1;
  const aspect = dy !== 0 ? dx / dy : 1;

  const normalizeRing = (r: Ring): Ring =>
    r.map(([x, y]) => [
      (x - cx) / maxSide,
      -(y - cy) / maxSide // flip Y to match image tracer (Y-up)
    ]);

  const totalPoints = allRings.reduce((sum, r) => sum + r.length, 0);

  const regions = Array.from(groups.values()).map(g => {
    const normRings = g.rings.map(normalizeRing);
    const ringPoints = g.rings.reduce((sum, r) => sum + r.length, 0);
    return {
      quantRgb: g.rgb,
      rings: normRings,
      coverage: ringPoints / totalPoints
    };
  });

  const outline = allRings.map(normalizeRing);

  return { regions, outline, aspect };
}
