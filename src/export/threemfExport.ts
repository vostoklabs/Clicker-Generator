// Author a 3MF that loads as a SINGLE object with N pre-colored, mating parts —
// the format the keycap generator uses, so Bambu Studio / OrcaSlicer import it
// clean with each part on its own filament slot. See DEV_PLAN.md §7.
//
//  - Each part is its own <object> (ids 2..N+1); a <components> wrapper (id N+2)
//    references them all -> "one object, N parts".
//  - <basematerials> gives spec-compliant slicers (PrusaSlicer) a color hint.
//  - Bambu/Orca read Metadata/model_settings.config, where each part maps to a
//    1-based filament slot (`extruder`). Parts sharing a color share a slot.
import { zipSync, strToU8 } from 'fflate';
import type { ClickerPart, PartGroup, RGB } from '../types';

const f = (n: number): string => String(Math.round(n * 1e4) / 1e4);

function hex(rgb: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}FF`;
}

/** Stable 1-based filament slot per unique color, in first-seen order. */
function assignExtruders(parts: ClickerPart[]): number[] {
  const slotByColor = new Map<string, number>();
  return parts.map((p) => {
    const key = p.colorRgb.join(',');
    let slot = slotByColor.get(key);
    if (slot === undefined) {
      slot = slotByColor.size + 1;
      slotByColor.set(key, slot);
    }
    return p.extruder ?? slot;
  });
}

function meshXml(p: ClickerPart, minZ: number): string {
  const np = p.numProp;
  const vp = p.vertProperties;
  const tv = p.triVerts;
  const verts: string[] = [];
  for (let i = 0; i < vp.length; i += np) {
    verts.push(`<vertex x="${f(vp[i])}" y="${f(vp[i + 1])}" z="${f(vp[i + 2] - minZ)}"/>`);
  }
  const tris: string[] = [];
  for (let i = 0; i < tv.length; i += 3) {
    tris.push(`<triangle v1="${tv[i]}" v2="${tv[i + 1]}" v3="${tv[i + 2]}"/>`);
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`;
}

export function buildThreeMF(parts: ClickerPart[]): Uint8Array {
  // Drop the whole assembly onto the build plate (min Z -> 0), keeping relative
  // positions.
  let minZ = Infinity;
  for (const p of parts) {
    for (let i = 2; i < p.vertProperties.length; i += p.numProp) {
      if (p.vertProperties[i] < minZ) minZ = p.vertProperties[i];
    }
  }
  if (!isFinite(minZ)) minZ = 0;

  const extruders = assignExtruders(parts);

  // Two movable objects, each a <components> wrapper over its colored sub-parts,
  // so the slicer lets you orient "clicker top" and "clicker base" independently.
  const groups: { id: PartGroup; label: string }[] = [
    { id: 'top', label: 'clicker_top' },
    { id: 'base', label: 'clicker_base' },
  ].filter((g) => parts.some((p) => p.group === g.id)) as { id: PartGroup; label: string }[];

  const baseMaterials = parts
    .map((p) => `<base name="${p.name}" displaycolor="${hex(p.colorRgb)}"/>`)
    .join('');
  const leafObjects = parts
    .map((p, i) => `<object id="${i + 2}" type="model" pid="1" pindex="${i}">${meshXml(p, minZ)}</object>`)
    .join('');

  const firstWrapperId = parts.length + 2;
  const wrapperObjects = groups
    .map((g, gi) => {
      const comps = parts
        .map((p, i) => (p.group === g.id ? `<component objectid="${i + 2}"/>` : ''))
        .join('');
      return `<object id="${firstWrapperId + gi}" type="model"><components>${comps}</components></object>`;
    })
    .join('');
  const buildItems = groups
    .map((_, gi) => `<item objectid="${firstWrapperId + gi}"/>`)
    .join('');

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US"` +
    ` xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"` +
    ` xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">` +
    `<resources>` +
    `<basematerials id="1">${baseMaterials}</basematerials>` +
    leafObjects +
    wrapperObjects +
    `</resources>` +
    `<build>${buildItems}</build>` +
    `</model>`;

  const objectCfg = groups
    .map((g, gi) => {
      const partsCfg = parts
        .map((p, i) =>
          p.group === g.id
            ? `<part id="${i + 2}" subtype="normal_part">` +
              `<metadata key="name" value="${p.name}"/>` +
              `<metadata key="extruder" value="${extruders[i]}"/>` +
              `</part>`
            : '',
        )
        .join('');
      return (
        `<object id="${firstWrapperId + gi}">` +
        `<metadata key="name" value="${g.label}"/>` +
        `<metadata key="extruder" value="1"/>` +
        partsCfg +
        `</object>`
      );
    })
    .join('');
  const modelSettings =
    `<?xml version="1.0" encoding="UTF-8"?>\n` + `<config>` + objectCfg + `</config>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="config" ContentType="text/xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0"` +
    ` Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
    },
    { level: 6 },
  );
}

export function downloadThreeMF(parts: ClickerPart[], fileName = 'clicker.3mf') {
  const bytes = buildThreeMF(parts);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'model/3mf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
