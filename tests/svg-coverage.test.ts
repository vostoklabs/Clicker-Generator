// Regression test for the "imported SVG comes out blank/one-colour" bug.
//
// buildClicker places colours smallest-coverage-first and subtracts each from the
// ones already placed, so the SMALLEST colour must win a shared boundary. parseSvg
// used to measure coverage by polygon POINT COUNT, so a full-canvas background
// rectangle (huge area, ~4 points) ranked as the "smallest" colour, got placed
// first, claimed the whole cap, and subtracted every real colour to nothing — the
// design vanished. Coverage must be AREA-based (matches the image pipeline, and
// types.ts: "fraction of foreground pixels").
//
// parseSvg needs a browser DOMParser; polyfill it with @xmldom/xmldom.
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
const { parseSvg } = await import('../src/image/logo.ts');

// Synthetic SVG: a full-canvas WHITE background (4 points, area 10000) plus a small
// but HIGH-POLY black design (48 points, area ≈ 113). Point-count coverage ranks the
// design as the bigger colour (wrong); area coverage ranks the background as bigger.
const N = 48, cx = 50, cy = 50, r = 6;
let d = '';
for (let i = 0; i < N; i++) {
  const a = (2 * Math.PI * i) / N;
  d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(3) + ' ' + (cy + r * Math.sin(a)).toFixed(3) + ' ';
}
d += 'Z';
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<path fill="#ffffff" d="M0 0 H100 V100 H0 Z"/>` +
  `<path fill="#000000" d="${d}"/>` +
  `</svg>`;

const rs = parseSvg(svg);
const bg = rs.regions.find((r) => r.quantRgb.join() === '255,255,255');
const design = rs.regions.find((r) => r.quantRgb.join() === '0,0,0');

const checks: [string, boolean][] = [
  ['both colours parsed', !!bg && !!design],
  // Core invariant: the big background must rank LARGER than the small design, so the
  // design is placed first and survives. (Old point-count code inverted this.)
  ['bg coverage > design coverage', !!bg && !!design && bg!.coverage > design!.coverage],
  // The tiny design must be a small fraction (area-based), so it wins the carve order.
  ['design coverage < 0.1 (area-based)', !!design && design!.coverage < 0.1],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log((pass ? 'PASS ' : 'FAIL ') + label);
  if (!pass) ok = false;
}
if (bg && design) {
  console.log(`  (bg=${(bg.coverage * 100).toFixed(1)}%  design=${(design.coverage * 100).toFixed(2)}%)`);
}
console.log(ok ? '\nALL SVG COVERAGE CHECKS PASSED' : '\nSVG COVERAGE CHECKS FAILED');
process.exit(ok ? 0 : 1);
