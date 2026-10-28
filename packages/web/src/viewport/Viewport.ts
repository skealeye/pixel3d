import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Model } from '@pixel3d/core';
import { previewMeshes, type Preview } from './previewMesh';

export interface GridOptions { on: boolean; colour: string; opacity: number }
type Size = { x: number; y: number; z: number };

/** Cut faces of solid material show gold: with the near half clipped away, any back face we can see is the inside. */
const capHook = (sh: { fragmentShader: string }) => {
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <dithering_fragment>',
    '#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor = vec4(0.85, 0.64, 0.26, 1.0);',
  );
};

/**
 * The 3D view (ported from the mockup): Z up, a build plate with a 10 mm grid, orbit controls, Cut view.
 * Renders on demand, and straight after every resize so the canvas never shows a stretched or cleared frame.
 */
export class Viewport {
  /** Frames drawn so far (for the e2e checks). */
  renders = 0;
  shown: 'none' | 'preview' | 'model' = 'none';
  size: Size | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  private controls: OrbitControls;
  private holder = new THREE.Group();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private cut = false;
  private gridOpts: GridOptions = { on: true, colour: '#8a7446', opacity: 0.7 };
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
      return new THREE.Mesh(geo, this.material(p.hex));
    });
    this.show(meshes, model.size, opts.row);
    this.shown = model.parts.length ? 'model' : 'none';
  }

  /** The fast preview (previewMesh.ts), shown until the core model replaces it. */
  setPreview(p: Preview | null) {
    if (!p) return this.clear();
    this.show(previewMeshes(p, (hex) => this.material(hex)), p.size, p.px.y);
    this.shown = 'preview';
  }

  clear() {
    this.show([], null);
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

  /** Frame whatever is on the bed: the default view suits a ~70 mm diagonal, larger models pull the camera back. */
  fitView() {
    const sz = this.size ? new THREE.Vector3(this.size.x, this.size.y, this.size.z) : new THREE.Vector3(40, 40, 3);
    const k = Math.max(1, sz.length() / 70);
    this.camera.position.set(55 * k, -95 * k, 85 * k);
    this.controls.target.set(0, 0, Math.min(sz.z / 2, 12));
    this.controls.update();
    this.dirty = true;
  }

  dispose() {
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.clearHolder();
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
    const g = (this.gridHelper = new THREE.GridHelper(200, 20, colour, colour));
    g.rotation.x = Math.PI / 2;
    const m = g.material as THREE.LineBasicMaterial;
    m.transparent = true;
    m.depthWrite = false;
    m.opacity = opacity;
    g.visible = on;
    this.scene.add(g);
  }

  private clearHolder() {
    for (const c of [...this.holder.children]) {
      this.holder.remove(c);
      if (c instanceof THREE.InstancedMesh) c.dispose();
      else if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
  }

  /** Swap the shown meshes, centre them on the plate with the lowest point on the bed, and place the cut plane. */
  private show(objects: THREE.Object3D[], size: Size | null, row?: number) {
    this.clearHolder();
    this.size = size;
    if (row) this.row = row;
    if (objects.length) {
      this.holder.add(...objects);
      this.holder.position.set(0, 0, 0);
      this.holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.holder), c = box.getCenter(new THREE.Vector3());
      this.holder.position.set(-c.x, -c.y, -box.min.z);
      this.holder.updateMatrixWorld(true);
      // through the middle of the pixel row nearest the centre
      const y0 = box.min.y - c.y, mid = (box.max.y - box.min.y) / 2;
      this.cutPlane.constant = -(y0 + (Math.floor(mid / this.row) + 0.5) * this.row);
    }
    this.dirty = true;
  }
}
