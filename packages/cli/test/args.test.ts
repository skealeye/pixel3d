import { parseArgs } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CONVERT_OPTIONS, parseValue } from '../src/args';

describe('convert arguments', () => {
  it('-o is a short alias for --out', () => {
    const short = parseArgs({ args: ['a.png', '-o', 'models'], allowPositionals: true, options: CONVERT_OPTIONS });
    const long = parseArgs({ args: ['a.png', '--out', 'models'], allowPositionals: true, options: CONVERT_OPTIONS });
    expect(short.values.out).toBe('models');
    expect(short.values).toEqual(long.values);
    expect(short.positionals).toEqual(['a.png']);
  });

  it('--set values are JSON when they parse, else strings', () => {
    expect(parseValue('3')).toBe(3);
    expect(parseValue('round')).toBe('round');
  });
});
