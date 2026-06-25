// Geometry worker: owns the Manifold WASM kernel and the validated MX assets.
// All CSG happens here so the UI thread never blocks. See DEV_PLAN.md §1, §6.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { parse3MF } from '../geometry/threemfImport';
import { buildClicker } from '../geometry/buildClicker';
import type { GeometryRequest, GeometryResponse, ClickerPart } from '../types';

type Wasm = Awaited<ReturnType<typeof Module>>;

let modulePromise: Promise<Wasm> | null = null;
let socket: any = null; // cached MX socket (negative), in mm
let stem: any = null; // cached MX stem (positive), in mm

async function getModule(): Promise<Wasm> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasm = await Module({ locateFile: () => wasmUrl });
      wasm.setup();
      return wasm;
    })();
  }
  return modulePromise;
}

function post(msg: GeometryResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function assetToSolid(wasm: any, buf: ArrayBuffer): { solid: any; info: string } {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: raw.vertProperties,
    triVerts: raw.triVerts,
  });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  const status = typeof solid.status === 'function' ? solid.status() : 'ok';
  const info = `${size.map((v: number) => v.toFixed(2)).join('×')} mm, Z[${bb.min[2].toFixed(
    2,
  )},${bb.max[2].toFixed(2)}], status=${status}`;
  return { solid, info };
}

self.onmessage = async (e: MessageEvent<GeometryRequest>) => {
  try {
    const wasm = await getModule();
    const msg = e.data;

    if (msg.type === 'init') {
      socket?.delete?.();
      stem?.delete?.();
      const a = assetToSolid(wasm, msg.socket);
      const b = assetToSolid(wasm, msg.stem);
      // The socket and stem are authored in independent local frames (separate
      // exports), so normalize each into the shared assembly frame — Z = 0 is the
      // switch-plate top (where the switch latches), switch axis at the XY origin:
      //  • Socket: center on its own bbox (the ~14 mm cutout is symmetric about the
      //    axis) and drop its TOP face to Z = 0 — ianku's updated socket has its flat
      //    top at the plate/latch plane; it cuts downward (−Z) into the body.
      //  • Stem: center on its own bbox (symmetric keycap mount). Keep its authored
      //    Z — the stem top is the cap-underside rest height above the plate, which
      //    is what makes the cap float proud of the body border.
      const sbb = a.solid.boundingBox();
      const scx = (sbb.min[0] + sbb.max[0]) / 2;
      const scy = (sbb.min[1] + sbb.max[1]) / 2;
      socket = a.solid.translate([-scx, -scy, -sbb.max[2]]);
      const tbb = b.solid.boundingBox();
      const tcx = (tbb.min[0] + tbb.max[0]) / 2;
      const tcy = (tbb.min[1] + tbb.max[1]) / 2;
      stem = b.solid.translate([-tcx, -tcy, 0]);
      a.solid.delete();
      b.solid.delete();

      // The switch is DISPLAY-ONLY (a preview toggle) — no CSG. Parse it raw and
      // shift it by the SAME XY as the stem, so it stays coaxial with the cap/socket;
      // keep its authored Z (its plate plane is Z = 0, matching the socket top).
      const sw = parse3MF(msg.switch);
      const v = sw.vertProperties;
      let zmin = Infinity;
      let zmax = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        v[i] -= tcx;
        v[i + 1] -= tcy;
        if (v[i + 2] < zmin) zmin = v[i + 2];
        if (v[i + 2] > zmax) zmax = v[i + 2];
      }
      const switchMesh = { vertProperties: v, triVerts: sw.triVerts, numProp: 3 as const };
      const switchInfo = `${(sw.triVerts.length / 3) | 0} tris, Z[${zmin.toFixed(2)},${zmax.toFixed(2)}]`;
      post({ type: 'initDone', socketInfo: a.info, stemInfo: b.info, switchInfo, switchMesh }, [
        switchMesh.vertProperties.buffer,
        switchMesh.triVerts.buffer,
      ]);
      return;
    }

    if (msg.type === 'buildClicker') {
      if (!socket || !stem) throw new Error('Assets not initialized');
      const parts: ClickerPart[] = buildClicker(
        wasm,
        socket,
        stem,
        msg.regions,
        msg.outline,
        msg.params,
      );
      const transfer: Transferable[] = [];
      for (const p of parts) transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      post({ type: 'parts', parts }, transfer);
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
};

post({ type: 'ready' });
