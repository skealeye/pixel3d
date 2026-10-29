import type { Model } from '../mesh';
import { colorScene, rgb01 } from './obj';
import type { MeshFileOptions } from './obj';

/** A node property: scalars by FBX type code, `d` / `i` arrays (stored uncompressed). */
type Prop =
  | { t: 'C' | 'I'; v: number }
  | { t: 'D'; v: number }
  | { t: 'L'; v: bigint }
  | { t: 'S'; v: string }
  | { t: 'R'; v: Uint8Array }
  | { t: 'd' | 'i'; v: ArrayLike<number> };
interface Node { name: string; props: Prop[]; kids: Node[] }

const VERSION = 7400;
const HEAD = 'Kaydara FBX Binary  \0\x1a\0';
// the constants Blender's exporter writes: the FBX SDK pairs the file id and time with the footer id
const FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];
const TIME = '1970-01-01 10:00:00:000';
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
/** Null record closing a node list (7.4: three uint32 and a uint8). */
const NULL_RECORD = 13;

const I = (v: number): Prop => ({ t: 'I', v });
const D = (v: number): Prop => ({ t: 'D', v });
const L = (v: bigint): Prop => ({ t: 'L', v });
const S = (v: string): Prop => ({ t: 'S', v });
const n = (name: string, props: Prop[], kids: Node[] = []): Node => ({ name, props, kids });
/** A `Properties70` entry: name, type, label, flags, then values. */
const P = (name: string, type: string, label: string, flags: string, ...values: Prop[]) => n('P', [S(name), S(type), S(label), S(flags), ...values]);
/** An object's name and class, as binary FBX stores them. */
const cls = (name: string, c: string) => `${name}\0\x01${c}`;

class Writer {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private dv = new DataView(this.buf.buffer);
  private enc = new TextEncoder();
  private room(k: number) {
    if (this.len + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + k) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
    this.dv = new DataView(b.buffer);
  }
  u8(v: number) { this.room(1); this.buf[this.len++] = v; }
  u32(v: number) { this.room(4); this.dv.setUint32(this.len, v, true); this.len += 4; }
  i32(v: number) { this.room(4); this.dv.setInt32(this.len, v, true); this.len += 4; }
  f64(v: number) { this.room(8); this.dv.setFloat64(this.len, v, true); this.len += 8; }
  i64(v: bigint) { this.room(8); this.dv.setBigInt64(this.len, v, true); this.len += 8; }
  setU32(at: number, v: number) { this.dv.setUint32(at, v, true); }
  bytes(b: ArrayLike<number>) { this.room(b.length); this.buf.set(b, this.len); this.len += b.length; }
  str(s: string) { this.bytes(this.enc.encode(s)); }
  zeros(k: number) { this.room(k); this.buf.fill(0, this.len, this.len + k); this.len += k; }
}

function writeProp(w: Writer, p: Prop) {
  w.str(p.t);
  switch (p.t) {
    case 'C': return w.u8(p.v ? 1 : 0);
    case 'I': return w.i32(p.v);
    case 'D': return w.f64(p.v);
    case 'L': return w.i64(p.v);
    case 'S': case 'R': {
      const b = typeof p.v === 'string' ? new TextEncoder().encode(p.v) : p.v;
      w.u32(b.length);
      return w.bytes(b);
    }
    case 'd': case 'i': {
      const size = p.t === 'd' ? 8 : 4;
      w.u32(p.v.length);
      w.u32(0); // encoding: raw
      w.u32(p.v.length * size);
      for (let k = 0; k < p.v.length; k++) (p.t === 'd' ? w.f64(p.v[k]!) : w.i32(p.v[k]!));
    }
  }
}

/** A node record: end offset, property count and length (uint32 for 7.4), name, properties, children. */
function writeNode(w: Writer, node: Node) {
  const start = w.len;
  w.zeros(12);
  w.u8(node.name.length);
  w.str(node.name);
  const props = w.len;
  for (const p of node.props) writeProp(w, p);
  w.setU32(start + 4, node.props.length);
  w.setU32(start + 8, w.len - props);
  for (const k of node.kids) writeNode(w, k);
  if (node.kids.length || !node.props.length) w.zeros(NULL_RECORD);
  w.setU32(start, w.len);
}

/** Flat face normals, one per triangle corner (ByPolygonVertex). */
function cornerNormals(v: Float32Array, t: Uint32Array): Float64Array {
  const out = new Float64Array(t.length * 3);
  for (let i = 0; i < t.length; i += 3) {
    const a = 3 * t[i]!, b = 3 * t[i + 1]!, c = 3 * t[i + 2]!;
    const ux = v[b]! - v[a]!, uy = v[b + 1]! - v[a + 1]!, uz = v[b + 2]! - v[a + 2]!;
    const wx = v[c]! - v[a]!, wy = v[c + 1]! - v[a + 1]!, wz = v[c + 2]! - v[a + 2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 3; k++) out.set([nx / len, ny / len, nz / len], 3 * (i + k));
  }
  return out;
}

/**
 * Binary FBX 7.4 of the model: one Mesh model per part (`<object>_<n>`, parts kept apart so their colors survive),
 * each with its own geometry and one lambert material per color (mono: one material). Coordinates unchanged (mm,
 * Z up), declared through GlobalSettings (UnitScaleFactor 0.1 cm). Deterministic.
 */
export function toFBX(model: Model, opts: MeshFileOptions): Uint8Array {
  const { colors, objects } = colorScene(model, opts);
  let next = 1_000_000n;
  const id = () => next++;
  const matIds = colors.map(() => id());
  const objs: Node[] = [];
  const links: Node[] = [];
  const oo = (child: bigint, parent: bigint) => links.push(n('C', [S('OO'), L(child), L(parent)]));
  let models = 0;
  colors.forEach((hex, i) => {
    const c = rgb01(hex);
    objs.push(n('Material', [L(matIds[i]!), S(cls(`color_${i + 1}`, 'Material')), S('')], [
      n('Version', [I(102)]),
      n('ShadingModel', [S('lambert')]),
      n('MultiLayer', [I(0)]),
      n('Properties70', [], [
        P('DiffuseColor', 'Color', '', 'A', ...c.map(D)),
        P('Diffuse', 'Vector3D', 'Vector', '', ...c.map(D)),
      ]),
    ]));
  });
  for (const o of objects) {
    o.parts.forEach((p, k) => {
      const name = `${o.name}_${k + 1}`;
      const { vertProperties: v, triVerts: t } = p.mesh;
      const poly = Int32Array.from(t, (x, j) => (j % 3 === 2 ? -x - 1 : x));
      const geo = id(), mdl = id();
      objs.push(n('Geometry', [L(geo), S(cls(name, 'Geometry')), S('Mesh')], [
        n('Properties70', []),
        n('GeometryVersion', [I(124)]),
        n('Vertices', [{ t: 'd', v: Float64Array.from(v) }]),
        n('PolygonVertexIndex', [{ t: 'i', v: poly }]),
        n('LayerElementNormal', [I(0)], [
          n('Version', [I(101)]),
          n('Name', [S('')]),
          n('MappingInformationType', [S('ByPolygonVertex')]),
          n('ReferenceInformationType', [S('Direct')]),
          n('Normals', [{ t: 'd', v: cornerNormals(v, t) }]),
        ]),
        n('LayerElementMaterial', [I(0)], [
          n('Version', [I(101)]),
          n('Name', [S('')]),
          n('MappingInformationType', [S('AllSame')]),
          n('ReferenceInformationType', [S('IndexToDirect')]),
          n('Materials', [{ t: 'i', v: [0] }]),
        ]),
        n('Layer', [I(0)], [
          n('Version', [I(100)]),
          n('LayerElement', [], [n('Type', [S('LayerElementNormal')]), n('TypedIndex', [I(0)])]),
          n('LayerElement', [], [n('Type', [S('LayerElementMaterial')]), n('TypedIndex', [I(0)])]),
        ]),
      ]));
      objs.push(n('Model', [L(mdl), S(cls(name, 'Model')), S('Mesh')], [
        n('Version', [I(232)]),
        n('Properties70', [], [P('DefaultAttributeIndex', 'int', 'Integer', '', I(0))]),
        n('Shading', [{ t: 'C', v: 1 }]),
        n('Culling', [S('CullingOff')]),
      ]));
      oo(mdl, 0n);
      oo(geo, mdl);
      oo(matIds[p.mat]!, mdl);
      models++;
    });
  }
  const type = (t: string, count: number) => n('ObjectType', [S(t)], [n('Count', [I(count)])]);
  const stamp = n('CreationTimeStamp', [], [
    n('Version', [I(1000)]), n('Year', [I(1970)]), n('Month', [I(1)]), n('Day', [I(1)]),
    n('Hour', [I(10)]), n('Minute', [I(0)]), n('Second', [I(0)]), n('Millisecond', [I(0)]),
  ]);
  const int = (name: string, v: number) => P(name, 'int', 'Integer', '', I(v));
  const dbl = (name: string, v: number) => P(name, 'double', 'Number', '', D(v));
  const root: Node[] = [
    n('FBXHeaderExtension', [], [
      n('FBXHeaderVersion', [I(1003)]),
      n('FBXVersion', [I(VERSION)]),
      n('EncryptionType', [I(0)]),
      stamp,
      n('Creator', [S('pixel3d')]),
    ]),
    n('FileId', [{ t: 'R', v: Uint8Array.from(FILE_ID) }]),
    n('CreationTime', [S(TIME)]),
    n('Creator', [S('pixel3d')]),
    n('GlobalSettings', [], [
      n('Version', [I(1000)]),
      n('Properties70', [], [
        int('UpAxis', 2), int('UpAxisSign', 1), int('FrontAxis', 1), int('FrontAxisSign', -1), int('CoordAxis', 0), int('CoordAxisSign', 1),
        int('OriginalUpAxis', 2), int('OriginalUpAxisSign', 1),
        dbl('UnitScaleFactor', 0.1), dbl('OriginalUnitScaleFactor', 0.1),
      ]),
    ]),
    n('Documents', [], [
      n('Count', [I(1)]),
      n('Document', [L(id()), S(''), S('Scene')], [
        n('Properties70', [], [P('SourceObject', 'object', '', ''), P('ActiveAnimStackName', 'KString', '', '', S(''))]),
        n('RootNode', [L(0n)]),
      ]),
    ]),
    n('References', []),
    n('Definitions', [], [
      n('Version', [I(100)]),
      n('Count', [I(1 + 2 * models + colors.length)]),
      type('GlobalSettings', 1), type('Model', models), type('Geometry', models), type('Material', colors.length),
    ]),
    n('Objects', [], objs),
    n('Connections', [], links),
  ];

  const w = new Writer();
  w.str(HEAD);
  w.u32(VERSION);
  for (const node of root) writeNode(w, node);
  w.zeros(NULL_RECORD);
  w.bytes(FOOT_ID);
  w.zeros(4);
  w.zeros(16 - (w.len % 16) || 16);
  w.u32(VERSION);
  w.zeros(120);
  w.bytes(FOOT_MAGIC);
  return w.buf.slice(0, w.len);
}
