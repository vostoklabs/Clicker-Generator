import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ClickerPart, MeshData, RGB, ViewMode } from '../types';

export type SectionAxis = 'x' | 'y' | 'z';

export interface Viewer {
  setParts(parts: ClickerPart[]): void;
  setView(mode: ViewMode): void;
  setSection(axis: SectionAxis, pos: number): void;
  setSwitch(mesh: MeshData | null): void;
  showSwitch(on: boolean): void;
  renderToPng(): Promise<Blob | null>;
  dispose(): void;
}

function partToGeometry(p: ClickerPart): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  let positions: Float32Array;
  if (p.numProp === 3) {
    positions = p.vertProperties;
  } else {
    const count = p.vertProperties.length / p.numProp;
    positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = p.vertProperties[i * p.numProp];
      positions[i * 3 + 1] = p.vertProperties[i * p.numProp + 1];
      positions[i * 3 + 2] = p.vertProperties[i * p.numProp + 2];
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(p.triVerts, 1));
  // Crease-split normals: keep the domed top / round walls smooth while keeping
  // hard edges crisp (preview shading only — matches the keycap generator).
  const creased = toCreasedNormals(geo, (35 * Math.PI) / 180);
  geo.dispose();
  return creased;
}

function color(rgb: RGB): THREE.Color {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}

export function createViewer(container: HTMLElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  // Section view: a single clipping plane swept along an axis.
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const materials: THREE.Material[] = [];
  const bounds = new THREE.Vector3(40, 40, 40);
  let sectionAxis: SectionAxis = 'y';
  let sectionPos = 0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1b1f);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    5000,
  );
  camera.up.set(0, 0, 1); // Z up (CAD)
  camera.position.set(60, -60, 45);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(40, -30, 70);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  const grid = new THREE.GridHelper(300, 30, 0x3a3a3a, 0x262626);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Root group is recentered for viewing; children keep relative positions.
  const root = new THREE.Group();
  scene.add(root);
  const capGroup = new THREE.Group();
  const bodyGroup = new THREE.Group();
  const switchGroup = new THREE.Group(); // the real MX switch — display-only, toggleable
  switchGroup.visible = false;
  root.add(capGroup, bodyGroup, switchGroup);

  let viewMode: ViewMode = 'assembled';
  let explodeOffset = 0;
  let switchMaterial: THREE.MeshStandardMaterial | null = null;

  function clearGroup(g: THREE.Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  function setParts(parts: ClickerPart[]) {
    clearGroup(capGroup);
    clearGroup(bodyGroup);
    materials.length = 0;

    for (const p of parts) {
      const mat = new THREE.MeshStandardMaterial({
        color: color(p.colorRgb),
        metalness: 0.0,
        roughness: 0.5,
        side: THREE.DoubleSide, // so the interior shows in section view
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(partToGeometry(p), mat);
      (p.kind === 'body' ? bodyGroup : capGroup).add(mesh);
    }

    // Recenter the whole assembly at origin for viewing. Frame on the cap+body only
    // (exclude the switch) so toggling the switch never shifts the view.
    root.position.set(0, 0, 0);
    capGroup.position.set(0, 0, 0);
    const box = new THREE.Box3().expandByObject(capGroup).expandByObject(bodyGroup);
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -center.y, -center.z);

    const size = box.getSize(new THREE.Vector3());
    bounds.copy(size);
    explodeOffset = size.z * 0.8 + 10;
    applyView();

    const radius = Math.max(size.x, size.y, size.z) * 1.4 + 10;
    camera.position.set(radius, -radius, radius * 0.75);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function updateClipPlane() {
    const n =
      sectionAxis === 'x'
        ? new THREE.Vector3(-1, 0, 0)
        : sectionAxis === 'z'
          ? new THREE.Vector3(0, 0, -1)
          : new THREE.Vector3(0, -1, 0);
    const half = (sectionAxis === 'x' ? bounds.x : sectionAxis === 'z' ? bounds.z : bounds.y) / 2;
    clipPlane.normal.copy(n);
    clipPlane.constant = sectionPos * half;
  }

  function applyView() {
    capGroup.position.z = viewMode === 'exploded' ? explodeOffset : 0;
    const section = viewMode === 'section';
    if (section) updateClipPlane();
    for (const m of materials) (m as THREE.MeshStandardMaterial).clippingPlanes = section ? [clipPlane] : [];
    if (switchMaterial) switchMaterial.clippingPlanes = section ? [clipPlane] : [];
  }

  function setView(mode: ViewMode) {
    viewMode = mode;
    applyView();
  }

  // The real MX switch, already placed in the assembly frame (display only). Smooth
  // shading and no crease-splitting — the mesh is dense (~hundreds of k tris).
  function setSwitch(mesh: MeshData | null) {
    clearGroup(switchGroup);
    switchMaterial = null;
    if (!mesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3)); // numProp = 3
    geo.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
    geo.computeVertexNormals();
    switchMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x2a2a30),
      metalness: 0.1,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    switchGroup.add(new THREE.Mesh(geo, switchMaterial));
    applyView(); // pick up section clipping if it's active
  }

  function showSwitch(on: boolean) {
    switchGroup.visible = on;
  }

  function setSection(axis: SectionAxis, pos: number) {
    sectionAxis = axis;
    sectionPos = pos;
    if (viewMode === 'section') updateClipPlane();
  }

  async function renderToPng(): Promise<Blob | null> {
    // Render one frame at 2× into an offscreen-sized target, then capture.
    const w = container.clientWidth;
    const h = container.clientHeight;
    const prevRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(Math.min(prevRatio * 2, 4));
    renderer.render(scene, camera);
    const blob = await new Promise<Blob | null>((res) =>
      renderer.domElement.toBlob((b) => res(b), 'image/png'),
    );
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(w, h);
    return blob;
  }

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  let raf = 0;
  (function animate() {
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    clearGroup(capGroup);
    clearGroup(bodyGroup);
    clearGroup(switchGroup);
    controls.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setParts, setView, setSection, setSwitch, showSwitch, renderToPng, dispose };
}
