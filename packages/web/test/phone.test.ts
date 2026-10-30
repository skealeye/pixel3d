import { describe, expect, it } from 'vitest';
import { isPhone } from '../src/phone';

describe('isPhone', () => {
  it('is true for a portrait or landscape phone', () => {
    expect(isPhone(390, 844)).toBe(true);
    expect(isPhone(844, 390)).toBe(true);
  });
  it('is true when only the width is small', () => expect(isPhone(700, 900)).toBe(true));
  it('is false for a desktop-sized window', () => expect(isPhone(701, 501)).toBe(false));
});
