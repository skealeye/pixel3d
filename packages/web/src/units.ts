/** Inches are display-only (spec §4.5, plan Global Constraints): settings and core always hold mm. */
export type Unit = 'mm' | 'in';

export const MM_PER_IN = 25.4;

/** mm → the unit shown. */
export const toUnit = (mm: number, u: Unit) => (u === 'in' ? mm / MM_PER_IN : mm);
/** The unit shown → mm. */
export const fromUnit = (v: number, u: Unit) => (u === 'in' ? v * MM_PER_IN : v);
/** A length shown in `u`: mm to 0.1, inches to 0.01. */
export const fmt = (v: number, u: Unit) => v.toFixed(u === 'in' ? 2 : 1);

/** The viewport grid: 10 mm squares, or half-inch squares in inches. */
export const gridStep = (u: Unit) => (u === 'in' ? MM_PER_IN / 2 : 10);
export const gridLabel = (u: Unit) => (u === 'in' ? 'Grid 0.5 in' : 'Grid 10 mm');
