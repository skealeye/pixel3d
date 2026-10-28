import { expect, it } from 'vitest';
import { VERSION } from '@pixel3d/core';

it('resolves @pixel3d/core through the alias', () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
