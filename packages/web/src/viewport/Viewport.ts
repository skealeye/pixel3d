import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MX, type Model } from '@pixel3d/core';
import { previewMeshes, type Preview } from './previewMesh';
import { handleMeshes, type Handle } from './handles';
import { press } from './press';

/** `step`: one grid square, mm (10 mm, or half an inch). */
export interface GridOptions { on: boolean; color: string; opacity: number; step?: number }
type Size = { x: number; y: number; z: number };
type Vec3 = [number, number, number];
export type ClickerView = 'assembled' | 'apart';
type Box = { min: Vec3; max: Vec3 };

/** What a dimmed part's color is pulled toward: the app background. */
const DIM_TOWARD = '#1b1e23';

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
 * mockup does) and `holder` centers the result with its lowest point on the bed. The drag handles sit in the pivot
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
  /** One color (Export: One color): every part shows in this color; null shows each part's own. */
  private mono: string | null = null;
  /** The highlighted palette color (R26), or null. */
  private hl: string | null = null;
  private cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private cut = false;
  private gridOpts: GridOptions = { on: true, color: '#8a7446', opacity: 0.7, step: 10 };
  private gridHelper: THREE.GridHelper | null = null;
  private ro: ResizeObserver;
  private dirty = true;
  /** Height of one pixel row in mm, so the cut runs through the middle of a row and never along pixel faces (which flickers). */
  private row = 1;
  /** The clicker shown (core `Model.clicker`, its printed box and switch count), or null for a flat model. */
  private clk: { info: NonNullable<Model['clicker']>; printed: THREE.Box3; switches: number } | null = null;
  private clkView: ClickerView = 'assembled';
  /** The see-through stand-in switches of the Assembled view (not part of the model). */
  private ghostGroup = new THREE.Group();
  private ghostMat = new THREE.MeshStandardMaterial({ color: '#9fb6cc', transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.4 });
  private lastFrame = 0;

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
    this.pivot.add(this.handleGroup, this.ghostGroup);
    this.holder.add(this.pivot);
    this.scene.add(plate, this.holder);
    this.makeGrid();

    this.resize();
    this.fitView();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    r.setAnimationLoop((t: number) => {
      const dt = Math.min(0.05, (t - (this.lastFrame || t)) / 1000);
      this.lastFrame = t;
      if (this.clk && this.clkView === 'assembled' && press.step(dt)) this.movePress();
      if (this.controls.update() || this.dirty) this.render();
    });
  }

  /**
   * The core model: one mesh per part, one flat-shaded material per color. A clicker (`model.clicker`) is shown
   * Assembled or Apart (`setClickerView`); `switches` places its stand-in switches.
   */
  setModel(model: Model, opts: { row?: number; switches?: number } = {}) {
    const meshes = model.parts.map((p) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.mesh.vertProperties, 3));
      geo.setIndex(new THREE.BufferAttribute(p.mesh.triVerts, 1));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.material(p.hex, p.name));
      m.userData.object = p.object;
      m.userData.hex = p.hex;
      m.userData.part = p.name;
      return m;
    });
    this.uncut = model.parts.length ? new THREE.Box3(new THREE.Vector3(...model.bounds.min), new THREE.Vector3(...model.bounds.max)) : null;
    this.clk = model.clicker && this.uncut ? { info: model.clicker, printed: this.uncut.clone(), switches: opts.switches ?? 1 } : null;
    this.show(meshes, opts.row);
    this.shown = model.parts.length ? 'model' : 'none';
  }

  /** Assembled (the cap seated on the switch at rest, over a stand-in switch) or Apart (as printed, cap beside the body). */
  setClickerView(view: ClickerView) {
    if (view === this.clkView) return;
    this.clkView = view;
    if (!this.clk) return;
    this.layoutClicker();
    this.place();
    this.fitView();
  }

  /** The clicker as shown, in world space (for the e2e checks). */
  clicker(): { view: ClickerView; at: number; rest: number; cap: Box; body: Box; ghosts: number } | null {
    const c = this.clk;
    if (!c) return null;
    this.holder.updateMatrixWorld(true);
    const box = (object: string): Box => {
      const b = new THREE.Box3();
      for (const m of this.meshes) if (m.userData.object === object) b.expandByObject(m);
      return { min: b.min.toArray(), max: b.max.toArray() };
    };
    return { view: this.clkView, at: press.at, rest: c.info.restZ + this.holder.position.z, cap: box('cap'), body: box('body'), ghosts: this.ghostGroup.children.length };
  }

  /** The fast preview (previewMesh.ts), shown until the core model replaces it. */
  setPreview(p: Preview | null) {
    if (!p) return this.clear();
    this.uncut = null;
    this.clk = null;
    this.show(previewMeshes(p, (hex, part) => this.material(hex, part)), p.px.y);
    this.shown = 'preview';
  }

  clear() {
    this.uncut = null;
    this.clk = null;
    this.show([]);
    this.shown = 'none';
  }

  setCut(on: boolean) {
    this.cut = on;
    this.mats.forEach((m) => this.styleCut(m));
    this.ghostMat.clippingPlanes = on ? [this.cutPlane] : null;
    this.ghostMat.needsUpdate = true;
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

  /** Each handle's center in page coordinates (for the e2e checks). */
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

  /** The camera position, world space (for the e2e checks). */
  cameraAt(): Vec3 { return this.camera.position.toArray(); }

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
    this.ghostMat.dispose();
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

  /** Show every part in one color (the Export panel's One color), or null for each part's own color. */
  setMono(hex: string | null) {
    if (hex === this.mono) return;
    this.mono = hex;
    this.restyle();
  }

  /**
   * Highlight one palette color (the Select tool's selection, R26): its parts glow a little and every other part,
   * base and loop included, is dimmed. Null shows every part normally. One color mode ignores it.
   */
  setHighlight(hex: string | null) {
    if (hex === this.hl) return;
    this.hl = hex;
    this.restyle();
  }

  /** The highlighted color, and how many meshes are lit and dimmed (for the e2e checks). */
  highlight() {
    let lit = 0, dim = 0;
    for (const o of this.meshes) {
      const mode = o instanceof THREE.Mesh ? (o.material as THREE.Material).userData.mode : undefined;
      if (mode === 'lit') lit++;
      else if (mode === 'dim') dim++;
    }
    return { hex: this.hl, lit, dim };
  }

  /** Give every mesh the material its color, part, One color and the highlight call for; free the ones left over. */
  private restyle() {
    const used = new Set<THREE.Material>();
    for (const o of this.meshes) {
      if (!(o instanceof THREE.Mesh) || typeof o.userData.hex !== 'string') continue;
      o.material = this.material(o.userData.hex, o.userData.part ?? o.userData.hex);
      used.add(o.material);
    }
    for (const [k, m] of this.mats) if (!used.has(m)) { m.dispose(); this.mats.delete(k); }
    this.dirty = true;
  }

  /** The shared material for a part: `hex` is its color, `part` its core name ('base', 'loop' or a palette hex). */
  private material(hex: string, part: string = hex) {
    const mode = this.mono ? 'normal' : !this.hl ? 'normal' : part.toLowerCase() === this.hl.toLowerCase() ? 'lit' : 'dim';
    const shown = this.mono ?? hex;
    const key = `${mode}:${shown}`;
    let m = this.mats.get(key);
    if (!m) {
      const color = new THREE.Color(shown);
      // dimmed: toward the background, not transparent (transparency sorts badly and spoils Cut view)
      if (mode === 'dim') color.lerp(new THREE.Color(DIM_TOWARD), 0.65);
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
      if (mode === 'lit') { m.emissive = new THREE.Color(shown); m.emissiveIntensity = 0.35; }
      m.userData.mode = mode;
      m.onBeforeCompile = capHook;
      m.customProgramCacheKey = () => 'cap';
      this.styleCut(m);
      this.mats.set(key, m);
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
    const { on, color, opacity } = this.gridOpts;
    const step = this.gridStep, n = Math.round(200 / step);
    const g = (this.gridHelper = new THREE.GridHelper(n * step, n, color, color));
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
   * Center the model on the plate with its lowest point on the bed (not while a handle is dragged), set the size,
   * place the cut plane through the middle of the pixel row nearest the center, and lay the handles on top.
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
    // keep only the materials still in use, so recoloring doesn't pile up shader programs
    const used = new Set<THREE.Material>();
    for (const o of objects) if (o instanceof THREE.Mesh) used.add(o.material as THREE.Material);
    for (const [hex, m] of this.mats) if (!used.has(m)) { m.dispose(); this.mats.delete(hex); }
    if (objects.length) {
      this.pivot.add(...objects);
      this.meshes = objects;
    }
    this.layoutClicker();
    this.place();
  }

  /**
   * Lay a clicker out for the view: Apart is core's printed layout; Assembled moves the cap by `capShift` onto the
   * body with its underside at `restZ` (less the press depth), and adds a stand-in switch per switch. The model's box
   * is the one at rest, so pressing never moves the model.
   */
  private layoutClicker() {
    for (const g of [...this.ghostGroup.children]) {
      this.ghostGroup.remove(g);
      (g as THREE.Mesh).geometry.dispose();
    }
    const c = this.clk;
    if (!c) { press.reset(); return; }
    const caps = this.meshes.filter((m) => m.userData.object === 'cap');
    if (this.clkView === 'apart') {
      press.reset();
      for (const m of caps) m.position.set(0, 0, 0);
      this.uncut = c.printed.clone();
      return;
    }
    press.travel = c.info.restZ - c.info.pressedZ;
    const [sx, sy] = c.info.capShift;
    const rest = new THREE.Box3(), cap = new THREE.Box3();
    for (const m of this.meshes) {
      const g = (m as THREE.Mesh).geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!.clone();
      if (m.userData.object === 'cap') { b.translate(new THREE.Vector3(sx, sy, c.info.restZ)); cap.union(b); }
      rest.union(b);
    }
    for (const m of caps) m.position.set(sx, sy, c.info.restZ - press.at);
    this.uncut = rest;
    // switches at keyboard pitch along the art's long side, centered (core clicker.ts switchSpots); the cap's box is the art's
    const w = cap.max.x - cap.min.x, h = cap.max.y - cap.min.y, long = w >= h;
    const cx = (cap.min.x + cap.max.x) / 2, cy = (cap.min.y + cap.max.y) / 2;
    // the top housing steps in at seat + 4 so it stays inside the cap's pocket (ceiling 14.0) when pressed
    const seat = MX.floor + MX.depth, stemTop = seat + MX.above, step = seat + 4, top = seat + 6.6;
    const box = (dx: number, dy: number, z0: number, z1: number, x: number, y: number) =>
      new THREE.BoxGeometry(dx, dy, z1 - z0).translate(x, y, (z0 + z1) / 2);
    for (let i = 0; i < c.switches; i++) {
      const o = (i - (c.switches - 1) / 2) * MX.pitch;
      const [x, y] = long ? [cx + o, cy] : [cx, cy + o];
      // the lower housing in the shaft, the stepped top housing above the seat, and the stem that rides down with the cap
      const lower = new THREE.Mesh(box(14, 14, seat - 5, seat, x, y), this.ghostMat);
      const upper = new THREE.Mesh(box(15.6, 15.6, seat, step, x, y), this.ghostMat);
      const crown = new THREE.Mesh(box(13.5, 13.5, step, top, x, y), this.ghostMat);
      const stem = new THREE.Mesh(box(4, 4, top, stemTop, x, y), this.ghostMat);
      stem.userData.stem = true;
      stem.position.z = -press.at;
      this.ghostGroup.add(lower, upper, crown, stem);
    }
  }

  /** Follow the press preview: the cap and the stand-in stems move down by `press.at`. */
  private movePress() {
    const c = this.clk;
    if (!c) return;
    for (const m of this.meshes) if (m.userData.object === 'cap') m.position.z = c.info.restZ - press.at;
    for (const g of this.ghostGroup.children) if (g.userData.stem) g.position.z = -press.at;
    this.dirty = true;
  }
}
