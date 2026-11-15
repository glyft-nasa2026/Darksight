import { describe, expect, it } from 'vitest';
import { DEFAULT_PAD_ID, PADS, padById } from './pads';

describe('launch pads', () => {
  it('lists the brief\'s seven pads, each once', () => {
    expect(PADS).toHaveLength(7);
    expect(new Set(PADS.map((p) => p.id)).size).toBe(7);
  });

  it('keeps every coordinate on Earth, longitude -180 to 180', () => {
    for (const p of PADS) {
      expect(p.lat, p.id).toBeGreaterThanOrEqual(-90);
      expect(p.lat, p.id).toBeLessThanOrEqual(90);
      expect(p.lon, p.id).toBeGreaterThanOrEqual(-180);
      expect(p.lon, p.id).toBeLessThanOrEqual(180);
    }
  });

  it('puts the pads in the right hemispheres (a sign slip would move a pad to another continent)', () => {
    expect(padById('ksc-39a').lon).toBeLessThan(0);          // Florida: west
    expect(padById('csg-ela4').lon).toBeLessThan(0);         // French Guiana: west
    expect(padById('baikonur-31').lon).toBeGreaterThan(0);   // Kazakhstan: east
    expect(padById('mahia-lc1').lat).toBeLessThan(0);        // New Zealand: south
    expect(padById('mahia-lc1').lon).toBeGreaterThan(0);
  });

  it('falls back to Kennedy LC-39A for an unknown or missing id', () => {
    expect(padById('nowhere').id).toBe(DEFAULT_PAD_ID);
    expect(padById(null).id).toBe(DEFAULT_PAD_ID);
    expect(padById(DEFAULT_PAD_ID).pad).toBe('LC-39A');
  });
});
