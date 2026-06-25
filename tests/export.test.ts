import { buildThreeMF } from '../src/export/threemfExport.ts';
import { unzipSync, strFromU8 } from 'fflate';

const tetra = (color: [number, number, number], name: string, z: number) => ({
  kind: 'cap' as const,
  colorRgb: color,
  name,
  numProp: 3,
  vertProperties: new Float32Array([0, 0, z, 10, 0, z, 0, 10, z, 0, 0, z + 10]),
  triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
});

const parts = [tetra([255, 0, 0], 'red', 5), tetra([0, 128, 255], 'blue', 8)];
const bytes = buildThreeMF(parts as any);

const files = unzipSync(bytes);
const names = Object.keys(files);
const model = strFromU8(files['3D/3dmodel.model']);

const checks: [string, boolean][] = [
  ['has [Content_Types].xml', names.includes('[Content_Types].xml')],
  ['has _rels/.rels', names.includes('_rels/.rels')],
  ['has 3D/3dmodel.model', names.includes('3D/3dmodel.model')],
  ['unit=millimeter', /unit="millimeter"/.test(model)],
  ['2 basematerials', (model.match(/<base /g) || []).length === 2],
  ['2 objects', (model.match(/<object /g) || []).length === 2],
  ['2 build items', (model.match(/<item /g) || []).length === 2],
  ['dropped to plate (min z=0)', /z="0"/.test(model)],
  ['blue color present', /displaycolor="#0080ffFF"/i.test(model)],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log((pass ? 'PASS ' : 'FAIL ') + label);
  if (!pass) ok = false;
}
console.log(ok ? '\nALL EXPORT CHECKS PASSED' : '\nEXPORT CHECKS FAILED');
process.exit(ok ? 0 : 1);
