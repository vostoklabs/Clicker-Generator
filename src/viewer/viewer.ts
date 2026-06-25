import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ClickerPart, EditMode, MeshData, RGB, ViewMode } from '../types';

export type SectionAxis = 'x' | 'y' | 'z';

export interface Viewer {
  setParts(parts: ClickerPart[]): void;
  setView(mode: ViewMode): void;
  setSection(axis: SectionAxis, pos: number): void;
  setSwitch(mesh: MeshData | null): void;
  showSwitch(on: boolean): void;
  renderToPng(): Promise<Blob | null>;
  setTheme(theme: string): void;
  /** Register a callback fired when the user clicks a colored part of the model, or null if clicking empty space. */
  onPartPick(cb: (index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void): void;
  /** Live-recolor a single part's material (no rebuild — geometry is unchanged). */
  setPartColor(index: number, rgb: RGB): void;
  /** Mark a part as the active selection (highlight), or null to clear. */
  highlightPart(index: number | null): void;
  /** Mark multiple parts as active selection. */
  highlightParts(indices: number[]): void;
  /** Clear hover + selection highlights. */
  clearHighlight(): void;
  /** Switch viewport edit mode (color / extrude / edges). */
  setEditMode(mode: EditMode): void;
  /** Register extrude drag callback — called with part indices and new height level. */
  setComponentHeights(heights: Record<string, number>, stepHeight: number): void;
  dispose(): void;
}

// The grid sits a hair BELOW the model's bottom face (which lands at z = 0) so the
// solid bottom occludes it cleanly — coplanar at z = 0 causes z-fighting that bleeds
// grid lines up through the lower body.
const GRID_GAP = 1.0;

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
  // Parallel to `materials`/parts: the pickable meshes, each tagged with its part
  // index in userData so a raycast hit maps straight back to the part/material.
  const partMeshes: THREE.Mesh[] = [];
  const bounds = new THREE.Vector3(40, 40, 40);
  let sectionAxis: SectionAxis = 'y';
  let sectionPos = 0;

  const scene = new THREE.Scene();
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  scene.background = new THREE.Color(currentTheme === 'dark' ? 0x15171c : 0xf3f4f6);

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

  let gridZ = -20;
  let grid: THREE.GridHelper | null = null;

  function rebuildGrid(theme: string, z: number) {
    if (grid) scene.remove(grid);
    gridZ = z;
    const accentColor = theme === 'dark' ? 0x5b9dff : 0x2563eb;
    const gridColor = theme === 'dark' ? 0x2d3139 : 0xd1d5db;
    grid = new THREE.GridHelper(300, 30, accentColor, gridColor);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = gridZ;
    // Prevent grid lines from bleeding through model body:
    // draw the grid first and skip depth-writes so opaque geometry always wins.
    grid.renderOrder = -1;
    if (Array.isArray(grid.material)) {
      grid.material.forEach(m => { m.depthWrite = false; });
    } else {
      grid.material.depthWrite = false;
    }
    scene.add(grid);
  }

  rebuildGrid(currentTheme, gridZ);

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

  let placeholder: THREE.Group | null = null;
  framePlaceholder();

  let viewMode: ViewMode = 'assembled';
  let explodeOffset = 0;
  let switchMaterial: THREE.MeshStandardMaterial | null = null;

  // ---- Part picking / hover / selection ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const HILITE = new THREE.Color(0x3b82f6);
  let hoveredIndex: number | null = null;
  let selectedIndices: number[] = [];
  let pickCb: ((index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void) | null = null;
  let downX = 0;
  let downY = 0;
  let downT = 0;

  // ---- Edit mode state ----
  let editMode: EditMode = 'color';

  let outlineMesh: THREE.LineSegments | null = null;
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false });

  function framePlaceholder() {
    root.position.set(0, 0, 0);
    const radius = 40 * 2.2 + 15;
    camera.position.set(radius, -radius, radius * 0.75);
    controls.target.set(0, 0, 11);
    controls.update();
  }

  function clearPlaceholder() {
    if (!placeholder) return;
    root.remove(placeholder);
    for (const child of placeholder.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    placeholder = null;
  }

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
    clearPlaceholder();
    clearGroup(capGroup);
    clearGroup(bodyGroup);
    materials.length = 0;
    partMeshes.length = 0;
    hoveredIndex = null;
    selectedIndices = [];

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const mat = new THREE.MeshStandardMaterial({
        color: color(p.colorRgb),
        metalness: 0.0,
        roughness: 0.5,
        side: THREE.DoubleSide, // so the interior shows in section view
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(partToGeometry(p), mat);
      mesh.userData.partIndex = i; // raycast hit -> part/material index
      partMeshes.push(mesh);
      (p.kind === 'body' ? bodyGroup : capGroup).add(mesh);
    }

    // Center X/Y, but place the bottom of the assembly at z = 0 so it sits on the grid.
    root.position.set(0, 0, 0);
    capGroup.position.set(0, 0, 0);
    const box = new THREE.Box3().expandByObject(capGroup).expandByObject(bodyGroup);
    const center = box.getCenter(new THREE.Vector3());
    // Shift X and Y to center, but shift Z so the bottom of the model lands at 0.
    root.position.set(-center.x, -center.y, -box.min.z);

    const size = box.getSize(new THREE.Vector3());
    bounds.copy(size);
    explodeOffset = size.z * 0.8 + 10;
    applyView();

    // Drop the grid just under the model's bottom (which lands at z = 0) so the
    // solid base occludes it instead of z-fighting with the coplanar bottom face.
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    rebuildGrid(activeTheme, -GRID_GAP);

    const radius = Math.max(size.x, size.y, size.z) * 2.2 + 15;
    camera.position.set(radius, -radius, radius * 0.75);
    controls.target.set(0, 0, size.z / 2);
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

  // Paint hover/selection glow via emissive (keeps each part's true base color).
  function applyHighlight() {
    if (outlineMesh) {
      outlineMesh.removeFromParent();
      outlineMesh.geometry.dispose();
      outlineMesh = null;
    }
    for (let i = 0; i < partMeshes.length; i++) {
      const isSelected = selectedIndices.includes(i);
      const isHovered = hoveredIndex === i;
      const m = materials[i] as THREE.MeshStandardMaterial;
      if (m) {
        if (isSelected || isHovered) {
          m.emissive.copy(HILITE);
          m.emissiveIntensity = isHovered ? 0.4 : 0.2;
        } else {
          m.emissiveIntensity = 0;
        }
      }
    }

    if (selectedIndices.length > 0) {
      const outlineGroup = new THREE.Group();
      for (const idx of selectedIndices) {
        const mesh = partMeshes[idx];
        if (mesh) {
          const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
          const subOutline = new THREE.LineSegments(edges, outlineMaterial);
          subOutline.position.copy(mesh.position);
          subOutline.quaternion.copy(mesh.quaternion);
          subOutline.scale.copy(mesh.scale);
          outlineGroup.add(subOutline);
        }
      }
      outlineMesh = outlineGroup as any;
      outlineMesh!.renderOrder = 999;
      partMeshes[selectedIndices[0]].parent?.add(outlineMesh!);
    } else if (hoveredIndex !== null && partMeshes[hoveredIndex]) {
      const mesh = partMeshes[hoveredIndex];
      const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
      outlineMesh = new THREE.LineSegments(edges, outlineMaterial) as any;
      outlineMesh!.renderOrder = 999;
      mesh.parent?.add(outlineMesh!);
    }
  }

  function pickIndexAt(clientX: number, clientY: number): number | null {
    if (partMeshes.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(partMeshes, false);
    for (const h of hits) {
      const idx = (h.object.userData as { partIndex?: number }).partIndex;
      if (typeof idx === 'number') return idx;
    }
    return null;
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons !== 0) return; // mid orbit/pan — don't fight the controls

    const idx = pickIndexAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = idx === null ? '' : 'pointer';
    if (idx !== hoveredIndex) {
      hoveredIndex = idx;
      applyHighlight();
    }
  };
  const onPointerLeave = () => {
    if (hoveredIndex !== null) {
      hoveredIndex = null;
      applyHighlight();
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
    downT = performance.now();
  };
  const onPointerUp = (e: PointerEvent) => {
    // Only a tap (not an orbit drag) counts as a part click.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    if (performance.now() - downT > 500) return;
    const idx = pickIndexAt(e.clientX, e.clientY);
    
    if (idx === null) {
      if (editMode === 'extrude' || editMode === 'edges') {
        // Click on empty space deselects
        selectedIndices = [];
        applyHighlight();
        pickCb?.(null, e.clientX, e.clientY, e.shiftKey);
      }
      return;
    }

    if (editMode === 'extrude' || editMode === 'edges') {
      if (e.shiftKey) {
        if (selectedIndices.includes(idx)) {
          selectedIndices = selectedIndices.filter(i => i !== idx);
        } else {
          selectedIndices.push(idx);
        }
      } else {
        selectedIndices = [idx];
      }
      applyHighlight();
      
      pickCb?.(idx, e.clientX, e.clientY, e.shiftKey);
    } else {
      // Color mode
      selectedIndices = [idx];
      applyHighlight();
      pickCb?.(idx, e.clientX, e.clientY, e.shiftKey);
    }
  };
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  function onPartPick(cb: (index: number | null, clientX: number, clientY: number, shiftKey: boolean) => void) {
    pickCb = cb;
  }
  function setPartColor(index: number, rgb: RGB) {
    const m = materials[index] as THREE.MeshStandardMaterial | undefined;
    if (m) m.color = color(rgb);
  }
  function highlightPart(index: number | null) {
    selectedIndices = index !== null ? [index] : [];
    applyHighlight();
  }
  function highlightParts(indices: number[]) {
    selectedIndices = indices;
    applyHighlight();
  }
  function clearHighlight() {
    selectedIndices = [];
    hoveredIndex = null;
    applyHighlight();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    clearGroup(capGroup);
    clearGroup(bodyGroup);
    clearGroup(switchGroup);
    controls.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  function setTheme(theme: string) {
    const bgColor = theme === 'dark' ? 0x15171c : 0xf3f4f6;
    scene.background = new THREE.Color(bgColor);
    rebuildGrid(theme, gridZ);
  }

  return {
    setParts,
    setView,
    setSection,
    setSwitch,
    showSwitch,
    renderToPng,
    setTheme,
    onPartPick,
    setPartColor,
    highlightPart,
    highlightParts,
    clearHighlight,
    setEditMode: (m: EditMode) => {
      editMode = m;
      if (editMode !== 'extrude' && editMode !== 'edges') {
        selectedIndices = [];
      }
      applyHighlight();
    },
    setComponentHeights: (heights: Record<string, number>, stepHeight: number) => {
      for (const mesh of partMeshes) {
        const partData = mesh.userData.partName;
        if (partData) {
          const level = heights[partData] ?? 0;
          mesh.position.z = level * stepHeight;
        }
      }
    },
    dispose,
  };
}
