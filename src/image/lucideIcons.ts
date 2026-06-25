import * as lucide from 'lucide';

const SVG_HEADER = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
}

export interface LucideIconInfo {
  pascal: string;
  name: string;
  node: any;
}

function buildIconList(): LucideIconInfo[] {
  const seen = new Map<any, LucideIconInfo>();
  for (const [pascal, node] of Object.entries(lucide)) {
    if (!Array.isArray(node)) continue;
    if (!Array.isArray(node[0])) continue;
    if (seen.has(node)) continue;
    seen.set(node, { pascal, name: pascalToKebab(pascal), node });
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export const LUCIDE_ICONS = buildIconList();

export function buildSvg(node: any[]): string {
  let inner = '';
  for (const [tag, attrs] of node) {
    let a = '';
    for (const [k, v] of Object.entries(attrs as Record<string, any>)) {
      a += ` ${k}="${v}"`;
    }
    inner += `<${tag}${a}/>`;
  }
  return SVG_HEADER + inner + '</svg>';
}

export function svgDataUrl(svgText: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
}
