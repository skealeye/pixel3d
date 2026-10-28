import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// An internal bug: the mesh stage throws something no user could act on.
vi.mock('../src/mesh', () => ({
  buildModel: () => { throw new TypeError('boom: cells is not iterable'); },
}));

const { convert, parsePreset } = await import('../src/index');

describe('convert: unexpected failure', () => {
  it('reports a plain error plus the underlying detail, and does not throw', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/potion.png', import.meta.url)));
    const { files, report } = await convert(bytes, parsePreset({ version: 1, settings: {}, colorRules: [] }), 'p');
    expect(files).toEqual([]);
    expect(report.error).toBe('The conversion failed: boom: cells is not iterable.');
    expect(report.detail).toMatch(/^TypeError: boom: cells is not iterable\n\s+at /);
  });
});
