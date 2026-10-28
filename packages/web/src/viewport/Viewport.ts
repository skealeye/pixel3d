import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Model } from '@pixel3d/core';
import { previewMeshes, type Preview } from './previewMesh';
import { handleMeshes, type Handle } from './handles';

/** `step`: one grid square, mm (10 mm, or half an inch). */
export interface GridOptions { on: boolean; colour: string; opacity: number; step?: number }
type Size = { x: number; y: number; z: number };
type Vec3 = [number, number, number];

/** Cut faces of solid material show gold: with the near half clipped away, any back face we can see is the inside. */
const capHook = (sh: { fragmentShader: string }) => {
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <dithering_fragment>',
    '#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor = vec4(0.85, 0.64, 0.26, 1.0);',
  );
};

/**
 * The 3D view (ported from the mockup): Z up, a build plate with a grid, orbit controls, Cut view.
 * Renders on demand, and straight after every resize so the canvas never shows a stretched or cleared frame.
 *
 * The meshes sit in `pivot` in core's unrotated model frame; the pivot turns them to the export orientation (as the
 * mockup does) and `holder` centres the result with its lowest point on the bed. The drag handles sit in the pivot
 * too but are left out of the size and placement, so moving one never moves the model.
 */
export class Viewport {
  /** Frames drawn so far (for the e2e checks). */
  renders = 0;
  shown: 'none' | 'preview' | 'model' = 'none';
  /** Size of what is shown, mm, after rotation. */
  size: Size | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  private controls: OrbitControls;
  private holder = new THREE.Group();
  private pivot = new THREE.Group();
  private handleGroup = new THREE.Group();
  /** The model or preview meshes (never the handles). */
  private meshes: THREE.Object3D[] = [];
  private handleList: Handle[] = [];
  /** While a handle is dragged the model stays exactly where it is. */
  private hold = false;
  private rotation: Vec3 = [0, 0, 0];
  /** The core model's uncut box in the model frame (core `Model.bounds`); null for the preview, which has no cuts. */
  private uncut: THREE.Box3 | null = null;
  private ray = new THREE.Raycaster();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private cut = false;
  private gridOpts: GridOptions = { on: true, colour: '#8a7446', opacity: 0.7, step: 10 };
  private gridHelper: THREE.GridHelper | null = null;
  private ro: ResizeObserver;
  private dirty = true;
  /** Height of one pixel row in mm, so the cut runs through the middle of a row and never along pixel faces (which flickers). */
  private row = 1;

  constructor(private canvas: HTMLCanvasElement, private container: HTMLElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(devicePixelRatio);
    r.localClippingEnabled = true;
    this.scene.background = new THREE.Color('#16181c');
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.dirty = true));

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#3a3226', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.8);
    sun.position.set(60, -80, 140);
    const fill = new THREE.DirectionalLight('#ffffff', 0.6);
    fill.position.set(-80, 60, -40);
    this.scene.add(sun, fill);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#3b3324', roughness: 0.95 }));
    plate.position.z = -0.05;
    this.pivot.add(this.handleGroup);
    this.holder.add(this.pivot);
    this.scene.add(plate, this.holder);
    this.makeGrid();

    this.resize();
    this.fitView();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    r.setAnimationLoop(() => {
      if (this.controls.update() || this.dirty) this.render();
    });
  }

  /** The core model: one mesh per part, one flat-shaded material per colour. */
  setModel(model: Model, opts: { row?: number } = {}) {
    const meshes = model.parts.map((p) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.mesh.vertProperties, 3));
      geo.setIndex(new THREE.BufferAttribute(p.mesh.triVerts, 1));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.material(p.hex));
      m.userData.object = p.object;
      return m;
    });
    this.uncut = model.parts.length ? new THREE.Box3(new THREE.Vector3(...model.bounds.min), new THREE.Vector3(...model.bounds.max)) : null;
    this.show(meshes, opts.row);
    this.shown = model.parts.length ? 'model' : 'none';
  }

  /** The fast preview (previewMesh.ts), shown until the core model replaces it. */
  setPreview(p: Preview | null) {
    if (!p) return this.clear();
    this.uncut = null;
    this.show(previewMeshes(p, (hex) => this.material(hex)), p.px.y);
    this.shown = 'preview';
  }

  clear() {
    this.uncut = null;
    this.show([]);
    this.shown = 'none';
  }

  setCut(on: boolean) {
    this.cut = on;
    this.mats.forEach((m) => this.styleCut(m));
    this.dirty = true;
  }

  setGrid(opts: GridOptions) {
    this.gridOpts = { ...opts };
    this.makeGrid();
    this.dirty = true;
  }

  /** One grid square, mm. */
  get gridStep() { return this.gridOpts.step ?? 10; }

  /** The export orientation in quarter turns: about X, then Y, then Z (as core rotates). */
  setRotation(r: Vec3) {
    if (r.every((v, i) => v === this.rotation[i])) return;
    this.rotation = [r[0], r[1], r[2]];
    this.pivot.rotation.set((r[0] * Math.PI) / 2, (r[1] * Math.PI) / 2, (r[2] * Math.PI) / 2, 'ZYX');
    this.place();
  }

  /** The hole and magnet markers, in the model frame. */
  setHandles(list: Handle[]) {
    this.handleList = list;
    this.drawHandles();
  }

  /** Keep the model still and orbiting off while a handle is dragged; releasing places the model again. */
  setHold(on: boolean) {
    this.hold = on;
    this.controls.enabled = !on;
    if (!on) this.place();
  }

  /** Orbiting on or off (off while placing a magnet, so the click doesn't turn the view). */
  setOrbit(on: boolean) { this.controls.enabled = on; }

  setCursor(c: string) { this.canvas.style.cursor = c; }

  /** The model surface under a page point: where it is in the model frame and which object it belongs to. */
  pick(clientX: number, clientY: number): { x: number; y: number; object: string } | null {
    this.aim(clientX, clientY);
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    if (!hit) return null;
    const p = this.pivot.worldToLocal(hit.point.clone());
    return { x: p.x, y: p.y, object: (hit.object.userData.object as string | undefined) ?? 'main' };
  }

  /** The handle under a page point. */
  handleAt(clientX: number, clientY: number): { kind: 'hole' | 'magnet'; i: number } | null {
    this.aim(clientX, clientY);
    const hit = this.ray.intersectObjects(this.handleGroup.children, false)[0];
    return hit ? (hit.object.userData.handle as { kind: 'hole' | 'magnet'; i: number }) : null;
  }

  /** Where a page point meets the plane of the model's top, in the model frame (for dragging handles). */
  onTop(clientX: number, clientY: number): { x: number; y: number } | null {
    this.aim(clientX, clientY);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.pivot.getWorldQuaternion(new THREE.Quaternion()));
    const o = this.pivot.localToWorld(new THREE.Vector3(0, 0, this.top()));
    const pt = this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, o), new THREE.Vector3());
    if (!pt) return null;
    const p = this.pivot.worldToLocal(pt);
    return { x: p.x, y: p.y };
  }

  /**
   * The front body's largest X and the back body's smallest, in the model frame. The back is the front mirrored
   * (cuts included), so a back point x lies over the front point frontMaxX + backMinX - x.
   */
  frontMaxX(): number {
    return this.localBox((m) => m.userData.object !== 'back').max.x;
  }

  backMinX(): number {
    return this.localBox((m) => m.userData.object === 'back').min.x;
  }

  /** Model bounds in world space, handles left out (for the e2e checks). */
  bounds(): { min: Vec3; max: Vec3 } | null {
    if (!this.meshes.length) return null;
    const b = this.box();
    return { min: b.min.toArray(), max: b.max.toArray() };
  }

  /** Each handle's centre in page coordinates (for the e2e checks). */
  handleScreen(): { kind: string; i: number; x: number; y: number }[] {
    const r = this.canvas.getBoundingClientRect();
    this.holder.updateMatrixWorld(true);
    return this.handleGroup.children.map((o) => {
      const p = o.getWorldPosition(new THREE.Vector3()).project(this.camera);
      const h = o.userData.handle as { kind: string; i: number };
      return { kind: h.kind, i: h.i, x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    });
  }

  /** Frame whatever is on the bed: the default view suits a ~70 mm diagonal, larger models pull the camera back. */
  fitView() {
    const sz = this.size ? new THREE.Vector3(this.size.x, this.size.y, this.size.z) : new THREE.Vector3(40, 40, 3);
    const k = Math.max(1, sz.length() / 70);
    this.camera.position.set(55 * k, -95 * k, 85 * k);
    this.controls.target.set(0, 0, Math.min(sz.z / 2, 12));
    this.controls.update();
    this.dirty = true;
  }

  /** Materials in use and how many of them the cut plane clips (for the e2e checks). */
  stats() {
    let clipped = 0;
    this.mats.forEach((m) => { if (m.clippingPlanes?.length) clipped++; });
    return { materials: this.mats.size, clipped };
  }

  dispose() {
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.clearHolder();
    this.setHandles([]);
    this.mats.forEach((m) => m.dispose());
    this.controls.dispose();
    this.renderer.dispose();
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
    this.renders++;
    this.dirty = false;
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // ResizeObserver callbacks run after layout and before paint, so drawing here lands in the same frame
    this.render();
  }

  private material(hex: string) {
    let m = this.mats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, flatShading: true });
      m.onBeforeCompile = capHook;
      m.customProgramCacheKey = () => 'cap';
      this.styleCut(m);
      this.mats.set(hex, m);
    }
    return m;
  }

  private styleCut(m: THREE.Material) {
    m.clippingPlanes = this.cut ? [this.cutPlane] : null;
    m.side = this.cut ? THREE.DoubleSide : THREE.FrontSide;
    m.needsUpdate = true;
  }

  private makeGrid() {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      (this.gridHelper.material as THREE.Material).dispose();
    }
    const { on, colour, opacity } = this.gridOpts;
    const step = this.gridStep, n = Math.round(200 / step);
    const g = (this.gridHelper = new THREE.GridHelper(n * step, n, colour, colour));
    g.rotation.x = Math.PI / 2;
    const m = g.material as THREE.LineBasicMaterial;
    m.transparent = true;
    m.depthWrite = false;
    m.opacity = opacity;
    g.visible = on;
    this.scene.add(g);
  }

  private clearHolder() {
    for (const c of this.meshes) {
      this.pivot.remove(c);
      if (c instanceof THREE.InstancedMesh) c.dispose();
      else if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    this.meshes = [];
  }

  private drawHandles() {
    for (const c of [...this.handleGroup.children]) {
      this.handleGroup.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    if (this.meshes.length && this.handleList.length) this.handleGroup.add(...handleMeshes(this.handleList, this.top()));
    this.dirty = true;
  }

  /** Bounds of the meshes `which` picks, in the model frame. */
  private localBox(which: (m: THREE.Object3D) => boolean = () => true): THREE.Box3 {
    this.holder.updateMatrixWorld(true);
    const inv = this.pivot.matrixWorld.clone().invert(), box = new THREE.Box3();
    for (const m of this.meshes) if (which(m)) box.union(new THREE.Box3().setFromObject(m).applyMatrix4(inv));
    return box;
  }

  /** The top of the model in the model frame. */
  private top(): number {
    return this.meshes.length ? this.localBox().max.z : 0;
  }

  private aim(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.holder.updateMatrixWorld(true);
    this.ray.setFromCamera(ndc, this.camera);
  }

  /**
   * World bounds of the model: core's uncut box turned by the pivot (cuts never move the model, as in core), or the
   * preview meshes' own box.
   */
  private box(): THREE.Box3 {
    this.holder.updateMatrixWorld(true);
    if (this.uncut) return this.uncut.clone().applyMatrix4(this.pivot.matrixWorld);
    const box = new THREE.Box3();
    for (const m of this.meshes) box.expandByObject(m);
    return box;
  }

  /**
   * Centre the model on the plate with its lowest point on the bed (not while a handle is dragged), set the size,
   * place the cut plane through the middle of the pixel row nearest the centre, and lay the handles on top.
   */
  private place() {
    if (this.meshes.length) {
      if (!this.hold) {
        this.holder.position.set(0, 0, 0);
        const b = this.box(), c = b.getCenter(new THREE.Vector3());
        this.holder.position.set(-c.x, -c.y, -b.min.z);
      }
      const box = this.box(), sz = box.getSize(new THREE.Vector3());
      this.size = { x: sz.x, y: sz.y, z: sz.z };
      const mid = sz.y / 2;
      this.cutPlane.constant = -(box.min.y + (Math.floor(mid / this.row) + 0.5) * this.row);
    } else this.size = null;
    this.drawHandles();
    this.dirty = true;
  }

  /** Swap the shown meshes, then place them. */
  private show(objects: THREE.Object3D[], row?: number) {
    this.clearHolder();
    if (row) this.row = row;
    // keep only the materials still in use, so recolouring doesn't pile up shader programs
    const used = new Set<THREE.Material>();
    for (const o of objects) if (o instanceof THREE.Mesh) used.add(o.material as THREE.Material);
    for (const [hex, m] of this.mats) if (!used.has(m)) { m.dispose(); this.mats.delete(hex); }
    if (objects.length) {
      this.pivot.add(...objects);
      this.meshes = objects;
    }
    this.place();
  }
}
