import { expect } from 'vitest';
import { initManifold } from '../../src/manifold';
import type { Part } from '../../src/mesh';

/** Rebuild a Manifold from the part's raw mesh: it must be a valid, closed, positive-volume solid. */
export async function assertManifold(part: Pick<Part, 'name' | 'mesh'>, genus?: number): Promise<void> {
  const { Manifold, Mesh } = await initManifold();
  const { vertProperties, triVerts } = part.mesh;
  expect(vertProperties.length % 3, `${part.name}: vertProperties`).toBe(0);
  expect(triVerts.length % 3, `${part.name}: triVerts`).toBe(0);
  expect(triVerts.length, `${part.name}: has triangles`).toBeGreaterThan(0);
  const m = new Manifold(new Mesh({ numProp: 3, vertProperties, triVerts }));
  try {
    expect(m.status(), `${part.name}: status`).toBe('NoError');
    expect(m.isEmpty(), `${part.name}: empty`).toBe(false);
    // genus = 1 - components + handles, so it can never fall below 1 - components
    const comps = m.decompose();
    const n = comps.length;
    for (const c of comps) c.delete();
    expect(m.genus(), `${part.name}: genus`).toBeGreaterThanOrEqual(1 - n);
    if (genus !== undefined) expect(m.genus(), `${part.name}: genus`).toBe(genus);
    expect(m.volume(), `${part.name}: volume`).toBeGreaterThan(0);
  } finally {
    m.delete();
  }
}
