import { describe, expect, it } from 'vitest';
import { BRIEF_PAD_COUNT, DEFAULT_PAD_ID, PADS, padById } from './pads';

describe('launch pads', () => {
  it('lists the brief’s seven pads first, then more pads in use, each once', () => {
    expect(PADS.slice(0, BRIEF_PAD_COUNT).map((p) => p.id)).toEqual(
      ['ksc-39a', 'ccsfs-slc40', 'csg-ela4', 'baikonur-31', 'jiuquan-sls2', 'wenchang-101', 'mahia-lc1']);
    expect(PADS.length).toBeGreaterThan(BRIEF_PAD_COUNT);
    expect(new Set(PADS.map((p) => p.id)).size).toBe(PADS.length);
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
    expect(padById('vsfb-slc4e').lon).toBeLessThan(-120);       // California: west
    expect(padById('sdsc-slp').lon).toBeGreaterThan(0);         // India: east
    expect(padById('tanegashima-lp1').lon).toBeGreaterThan(0);  // Japan: east
  });

  it('falls back to Kennedy LC-39A for an unknown or missing id', () => {
    expect(padById('nowhere').id).toBe(DEFAULT_PAD_ID);
    expect(padById(null).id).toBe(DEFAULT_PAD_ID);
    expect(padById(DEFAULT_PAD_ID).pad).toBe('LC-39A');
  });
});
