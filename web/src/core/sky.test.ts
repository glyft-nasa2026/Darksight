import { describe, expect, it } from 'vitest';
import cases from './__fixtures__/sky.json';
import type { Vec3 } from './ephemeris';
import {
  alignFrames, angleBetween, apply, applyInverse, earthFromIcrf, moonFromEarthIcrf, moonFromIcrf,
  moonOrbitIcrf, multiply, type Mat3,
} from './sky';

// Skyfield's own rotations (data-prep/make_stars.py): ICRF to MOON_ME_DE440_ME421, and to ITRS.
type Case = { t: string; moon: Mat3; earth: Mat3; earth_km_me: Vec3; earth_km_icrf: Vec3 };
const CASES = cases as Case[];
const RAD = Math.PI / 180;
const angle = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) / RAD;

describe('moonFromIcrf', () => {
  it.each(CASES)('matches DE440\'s mean-Earth frame within 0.02 degrees at $t', (c) => {
    expect(angleBetween(moonFromIcrf(Date.parse(c.t)), c.moon)).toBeLessThan(0.02);
  });
  it('is a rotation: rows are unit length and square to each other', () => {
    const m = moonFromIcrf(Date.UTC(2027, 0, 1));
    const mt: Mat3 = [0, 1, 2].map((i) => m.map((row) => row[i])) as Mat3;
    expect(angleBetween(multiply(m, mt), [[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeLessThan(1e-6);
  });
  it('turns once a sidereal month (27.32 days)', () => {
    const t = Date.UTC(2027, 0, 1);
    expect(angleBetween(moonFromIcrf(t), moonFromIcrf(t + 27.321661 * 86_400_000))).toBeLessThan(0.5);
    expect(angleBetween(moonFromIcrf(t), moonFromIcrf(t + 13.66 * 86_400_000))).toBeGreaterThan(170);
  });
});

describe('earthFromIcrf', () => {
  // earthFromIcrf takes UTC for UT1. Between the first leap seconds (1972) and 2050 the two stay
  // within a second, and the frames agree to 0.02 degrees. Outside, Skyfield's UT1 drifts from
  // our UTC: before 1972 it keeps TAI - UTC at 10 s, after about 2050 it extrapolates Delta T.
  // Its 37 s in 1905 is 0.16 degrees of Earth's turn.
  it.each(CASES)('matches Skyfield\'s ITRS at $t (0.02 degrees 1972-2050, 0.2 outside)', (c) => {
    const year = Number(c.t.slice(0, 4));
    const limit = year >= 1972 && year <= 2050 ? 0.02 : 0.2;
    expect(angleBetween(earthFromIcrf(Date.parse(c.t)), c.earth)).toBeLessThan(limit);
  });
});

describe('moonFromEarthIcrf', () => {
  it.each(CASES)('turns the Moon-fixed Earth vector back into the ICRF at $t', (c) => {
    const moon = moonFromEarthIcrf(c.earth_km_me, Date.parse(c.t));
    const want: Vec3 = [-c.earth_km_icrf[0], -c.earth_km_icrf[1], -c.earth_km_icrf[2]];
    expect(angle(moon, want)).toBeLessThan(0.02);
    expect(Math.hypot(...moon)).toBeCloseTo(Math.hypot(...want), 0);
  });
});

describe('moonOrbitIcrf', () => {
  it('finds the pole of a made-up orbit, and the direction to the Moon', () => {
    // A Moon going round the ICRF z axis, written as the Moon-fixed Earth vector the table holds.
    const period = 27.3 * 86_400_000;
    const at = (tMs: number): Vec3 => {
      const a = (2 * Math.PI * tMs) / period;
      return apply(moonFromIcrf(tMs), [-384_400 * Math.cos(a), -384_400 * Math.sin(a), 0]);
    };
    const t = Date.UTC(2027, 3, 5);
    const { toMoon, pole } = moonOrbitIcrf({ vectorsAt: (tMs) => ({ sun: [1, 0, 0], earthKm: at(tMs) }) }, t);
    const a = (2 * Math.PI * t) / period;
    expect(angle(toMoon, [Math.cos(a), Math.sin(a), 0])).toBeLessThan(1e-6);
    expect(angle(pole, [0, 0, 1])).toBeLessThan(1e-6);
  });
});

describe('alignFrames', () => {
  it('takes x onto x exactly and z onto z when both pairs are square', () => {
    const m = alignFrames([1, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0]);
    expect(angle(apply(m, [1, 0, 0]), [0, 1, 0])).toBeLessThan(1e-9);
    expect(angle(apply(m, [0, 0, 1]), [-1, 0, 0])).toBeLessThan(1e-9);
    expect(angle(applyInverse(m, [0, 1, 0]), [1, 0, 0])).toBeLessThan(1e-9);
  });
  it('makes a z that leans toward x square to it first', () => {
    const m = alignFrames([1, 0, 0], [0.3, 0, 1], [1, 0, 0], [0, 0, 1]);
    expect(angle(apply(m, [0, 0, 1]), [0, 0, 1])).toBeLessThan(1e-9);
    expect(angle(apply(m, [1, 0, 0]), [1, 0, 0])).toBeLessThan(1e-9);
  });
});
