import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { GifWriter } from 'omggif';
import UPNG from 'upng-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { convert, initManifold, inspect, parsePreset } from '../src/index';
import type { Preset } from '../src/index';
import { mulberry32 } from '../src/pixelate';
import { assertManifold } from './util/assertManifold';
import { all, parseXml } from './util/xml';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const preset = (settings: unknown = {}, colourRules: unknown[] = []): Preset => parsePreset({ version: 1, settings, colourRules });

/** PNG from rows of colours; null = transparent. Each cell is drawn `k`×`k`. */
const png = (rows: (string | null)[][], k = 1): Uint8Array => {
  const h = rows.length * k, w = rows[0]!.length * k;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[Math.floor(y / k)]![Math.floor(x / k)];
    if (c) data.set([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255], (y * w + x) * 4);
  }
  return new Uint8Array(UPNG.encode([data.buffer], w, h, 0));
};
const fill = (w: number, h: number, c: string | null) => Array.from({ length: h }, () => new Array<string | null>(w).fill(c));

type Mesh = { vertProperties: Float32Array; triVerts: Uint32Array };
/** Every mesh in a file: an STL is one triangle soup (welded on exact float match); a 3MF holds one `<mesh>` per part. */
const meshesOf = (file: { name: string; bytes: Uint8Array }): Mesh[] => {
  if (file.name.endsWith('.stl')) {
    const dv = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
    const n = dv.getUint32(80, true);
    expect(file.bytes.byteLength).toBe(84 + 50 * n);
    const ids = new Map<string, number>(), v: number[] = [], t: number[] = [];
    for (let i = 0; i < n * 3; i++) {
      const at = 84 + 50 * Math.floor(i / 3) + 12 + 12 * (i % 3);
      const p = [0, 4, 8].map((o) => dv.getFloat32(at + o, true));
      const key = p.join(',');
      let id = ids.get(key);
      if (id === undefined) { id = ids.size; ids.set(key, id); v.push(...p); }
      t.push(id);
    }
    return [{ vertProperties: new Float32Array(v), triVerts: new Uint32Array(t) }];
  }
  const z = unzipSync(file.bytes);
  return Object.keys(z).filter((p) => p.endsWith('.model')).sort().flatMap((p) => all(parseXml(strFromU8(z[p]!)), 'mesh').map((m) => {
    const v = all(m, 'vertex').flatMap((e) => ['x', 'y', 'z'].map((a) => Number(e.attrs[a])));
    const t = all(m, 'triangle').flatMap((e) => ['v1', 'v2', 'v3'].map((a) => Number(e.attrs[a])));
    return { vertProperties: new Float32Array(v), triVerts: new Uint32Array(t) };
  }));
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Triangle count, enclosed volume (divergence theorem) and vertex bounds of a file, as stored. */
const statsOf = (file: { name: string; bytes: Uint8Array }) => {
  let triangles = 0, vol = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { vertProperties: v, triVerts: t } of meshesOf(file)) {
    triangles += t.length / 3;
    for (let i = 0; i < v.length; i++) { min[i % 3] = Math.min(min[i % 3]!, v[i]!); max[i % 3] = Math.max(max[i % 3]!, v[i]!); }
    for (let i = 0; i < t.length; i += 3) {
      const a = 3 * t[i]!, b = 3 * t[i + 1]!, c = 3 * t[i + 2]!;
      vol += (v[a]! * (v[b + 1]! * v[c + 2]! - v[b + 2]! * v[c + 1]!)
        - v[a + 1]! * (v[b]! * v[c + 2]! - v[b + 2]! * v[c]!)
        + v[a + 2]! * (v[b]! * v[c + 1]! - v[b + 1]! * v[c]!)) / 6;
    }
  }
  return { name: file.name, triangles, volume: r3(vol), bounds: { min: min.map(r3), max: max.map(r3) } };
};

beforeAll(async () => { await initManifold(); });

describe('convert: golden files (potion)', () => {
  const golden = new URL('./golden/', import.meta.url);
  const cases: [string, Preset][] = [
    ['default', preset()],
    ['random-halves', preset({ heights: { mode: 'random', seed: 42 }, sides: { mode: 'halves' }, export: { format: 'stl' } })],
    ['loop-magnets-3mf', preset({
      keychain: { type: 'loop' },
      magnets: { at: [{ fx: 0.5, fy: 0.6 }] },
      export: { format: '3mf', slicer: 'generic' },
    })],
  ];
  for (const [id, p] of cases) {
    it(`${id} matches test/golden/${id}.json, every mesh manifold`, async () => {
      const { files, report } = await convert(fixture('potion.png'), p, 'potion');
      expect(report.error).toBeUndefined();
      expect(files.length).toBeGreaterThan(0);
      expect(report.files).toEqual(files.map((f) => f.name));
      for (const f of files) for (const [i, m] of meshesOf(f).entries()) await assertManifold({ name: `${f.name}#${i}`, mesh: m });
      const stats = files.map(statsOf);
      const path = new URL(`${id}.json`, golden);
      if (process.env.UPDATE_GOLDEN || !existsSync(path)) {
        if (!process.env.UPDATE_GOLDEN) throw new Error(`missing golden ${id}.json: run with UPDATE_GOLDEN=1`);
        mkdirSync(golden, { recursive: true });
        writeFileSync(path, JSON.stringify(stats, null, 2) + '\n');
      }
      const want = JSON.parse(readFileSync(path, 'utf8')) as ReturnType<typeof statsOf>[];
      expect(stats.map((s) => s.name)).toEqual(want.map((s) => s.name));
      stats.forEach((s, i) => {
        const w = want[i]!;
        expect(s.triangles, `${s.name} triangles`).toBe(w.triangles);
        expect(Math.abs(s.volume - w.volume), `${s.name} volume ${s.volume} vs ${w.volume}`).toBeLessThanOrEqual(0.0011);
        [...s.bounds.min, ...s.bounds.max].forEach((b, k) =>
          expect(Math.abs(b - [...w.bounds.min, ...w.bounds.max][k]!), `${s.name} bounds`).toBeLessThanOrEqual(0.0011));
      });
    });
  }

  it('names files after the sanitised name: halves STL gives _front and _back', async () => {
    const { files, report } = await convert(fixture('potion.png'), cases[1]![1], 'po/ti\\on:*?"<>|');
    expect(files.map((f) => f.name)).toEqual(['potion_front.stl', 'potion_back.stl']);
    expect(report.name).toBe('potion');
    const blank = await convert(fixture('potion.png'), preset(), '  ::  ');
    expect(blank.files.map((f) => f.name)).toEqual(['model.3mf']);
  });
});

describe('convert: report', () => {
  it('lists palette heights, size and pieces; colour rules win over the height mode', async () => {
    const { palette } = await inspect(fixture('potion.png'));
    const hex = palette[0]!.hex;
    const { report } = await convert(fixture('potion.png'), preset({ heights: { mode: 'random', seed: 42 } }, [{ match: hex, tolPct: 0, height: 7 }]), 'p');
    expect(report.error).toBeUndefined();
    expect(report.palette.find((c) => c.hex === hex)!.height).toBe(7);
    expect(report.applied).toEqual([`${hex} → height 7`]);
    expect(report.dropped).toEqual([]);
    expect(report.size.x).toBeCloseTo(40, 3);
    expect(report.pieces).toBe(1);
    expect(report.warnings).toEqual([]);
  });

  it('a rule whose colour an earlier rule recoloured away is dropped with a readable line', async () => {
    const { palette } = await inspect(fixture('potion.png'));
    const hex = palette[0]!.hex;
    const { report } = await convert(fixture('potion.png'), preset({}, [
      { match: hex, tolPct: 0, recolour: '#123456' },
      { match: hex, tolPct: 0, height: 3 },
    ]), 'p');
    expect(report.applied).toEqual([`${hex} → recolour #123456`]);
    expect(report.dropped).toEqual([`${hex} → height 3`]);
    expect(report.palette.map((c) => c.hex)).toContain('#123456');
  });

  it('warns about separate pieces', async () => {
    const r = '#cc2222';
    const { files, report } = await convert(png([[null, null, null, null, null], [null, r, null, r, null], [null, null, null, null, null]], 4), preset(), 'two');
    expect(report.error).toBeUndefined();
    expect(files).toHaveLength(1);
    expect(report.pieces).toBe(2);
    expect(report.warnings).toContain('2 separate pieces');
  });

  it('passes the magnet pause height into the 3MF', async () => {
    const { files, report } = await convert(fixture('potion.png'), preset({
      base: { height: 6 }, magnets: { size: '6x2', at: [{ fx: 0.5, fy: 0.6 }], position: 'centre' }, export: { slicer: 'bambu' },
    }), 'm');
    expect(report.error).toBeUndefined();
    const z = unzipSync(files[0]!.bytes);
    expect(Object.keys(z)).toContain('Metadata/custom_gcode_per_layer.xml');
    expect(strFromU8(z['Metadata/custom_gcode_per_layer.xml']!)).toContain('M400 U1');
  });

  it('pixelates a photo automatically: at most `colours` colours', async () => {
    const { report } = await convert(fixture('gradient-photo.png'), preset({ pixelate: { colours: 4, across: 16 } }), 'photo');
    expect(report.error).toBeUndefined();
    expect(report.palette.length).toBeGreaterThan(0);
    expect(report.palette.length).toBeLessThanOrEqual(4);
  });
});

describe('convert: degenerate images (Review Focus 1)', () => {
  const bad: [string, () => Uint8Array, RegExp][] = [
    // a GIF: UPNG's own 1×1 PNG doesn't decode
    ['1×1', () => {
      const buf = new Uint8Array(64);
      const n = new GifWriter(buf as unknown as Buffer, 1, 1, { palette: [0xff0000, 0x000000] });
      n.addFrame(0, 0, 1, 1, [0]);
      return buf.slice(0, n.end());
    }, /too small/i],
    ['fully transparent', () => png(fill(16, 16, null)), /transparent/i],
    ['single colour that is all background', () => png(fill(16, 16, '#3366cc')), /empty once the background is removed/],
    ['empty after background removal', () => {
      const rows = fill(16, 16, '#ffffff');
      for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) rows[y]![x] = '#f2f2f2';
      return png(rows);
    }, /empty once the background is removed/],
    ['corrupt bytes', () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), /could not be read/i],
    ['truncated PNG', () => png(fill(8, 8, '#ff0000')).slice(0, 40), /could not be read/i],
  ];
  for (const [what, bytes, msg] of bad) {
    it(`${what}: report.error, no files, no throw`, async () => {
      const { files, report } = await convert(bytes(), preset(), 'x');
      expect(files).toEqual([]);
      expect(report.files).toEqual([]);
      expect(report.error).toMatch(msg);
      expect(report.error).toMatch(/^[A-Z].*\.$/);
    });
  }

  it('a single-colour shape on transparent converts to a solid block', async () => {
    const g = '#22aa44';
    const { files, report } = await convert(png([[null, g, null], [g, g, g], [null, g, null]], 4), preset(), 'plus');
    expect(report.error).toBeUndefined();
    expect(files).toHaveLength(1);
    expect(report.palette.map((c) => c.hex)).toEqual([g]);
  });
});

describe('inspect', () => {
  it('reports the native grid, scale and palette by count', async () => {
    const r = await inspect(fixture('potion.png'));
    expect(r).toMatchObject({ width: 16, height: 16, scale: { sx: 4, sy: 4, ox: 0, oy: 0 }, looksLikePixelArt: true });
    expect(r.palette.length).toBeGreaterThan(1);
    const counts = r.palette.map((c) => c.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(r.palette.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
  });

  it('flags a photo as not pixel art', async () => {
    expect((await inspect(fixture('gradient-photo.png'))).looksLikePixelArt).toBe(false);
  });
});

describe('convert: large pixel art (Review Focus 5)', () => {
  /** 512×512 at native resolution: 16 colours in seeded blocks 3–11 px, so runs share no common factor and nothing shrinks. */
  const sprite = () => {
    const rnd = mulberry32(5);
    const cols = Array.from({ length: 16 }, (_, i) => `#${((i * 0x2f1b3d + 0x102030) & 0xffffff).toString(16).padStart(6, '0')}`);
    const cuts = () => { const c = [0]; while (c[c.length - 1]! < 512) c.push(c[c.length - 1]! + 3 + Math.floor(rnd() * 9)); return c; };
    const xs = cuts(), ys = cuts();
    const rows = fill(512, 512, null);
    for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
      const c = cols[Math.floor(rnd() * 16)]!;
      for (let y = ys[j]!; y < Math.min(512, ys[j + 1]!); y++) for (let x = xs[i]!; x < Math.min(512, xs[i + 1]!); x++) rows[y]![x] = c;
    }
    return png(rows);
  };

  it('a 512×512, 16-colour sprite converts in under 5 s', async () => {
    const bytes = sprite();
    const info = await inspect(bytes);
    expect(info).toMatchObject({ width: 512, height: 512, looksLikePixelArt: true });
    expect(info.palette).toHaveLength(16);
    const t0 = performance.now();
    const { files, report } = await convert(bytes, preset({ background: { enabled: false } }), 'big');
    const ms = performance.now() - t0;
    if (process.env.TIMING) console.info(`512×512 convert: ${ms.toFixed(0)} ms`);
    expect(report.error).toBeUndefined();
    expect(report.palette).toHaveLength(16);
    expect(files).toHaveLength(1);
    expect(ms).toBeLessThan(5000);
  }, 30_000);
});
