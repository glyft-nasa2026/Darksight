// Tests for Lambert's problem and two-body propagation (issue #192). The expected numbers are
// from the circular-orbit and Hohmann formulas.
import { describe, expect, it } from 'vitest';
import { lambert, propagate, type V3 } from './lambert';
import { MU_EARTH, R_EARTH } from './mission';

const R = R_EARTH + 185;
const V_CIRC = Math.sqrt(MU_EARTH / R);
const PERIOD = 2 * Math.PI * Math.sqrt(R ** 3 / MU_EARTH);
const UP: V3 = [0, 0, 1];
const close = (a: V3, b: V3, km: number): void => {
  expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(km);
};

describe('propagate', () => {
  it('moves round a circular orbit: a quarter, a half and a whole period', () => {
    const r0: V3 = [R, 0, 0];
    const v0: V3 = [0, V_CIRC, 0];
    close(propagate(r0, v0, PERIOD / 4, MU_EARTH), [0, R, 0], 0.01);
    close(propagate(r0, v0, PERIOD / 2, MU_EARTH), [-R, 0, 0], 0.01);
    close(propagate(r0, v0, PERIOD, MU_EARTH), r0, 0.01);
  });

  it('reaches the apogee of a Hohmann ellipse in half its period', () => {
    const ra = 380_000;
    const a = (R + ra) / 2;
    const vp = Math.sqrt(MU_EARTH * (2 / R - 1 / a));
    const half = Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
    close(propagate([R, 0, 0], [0, vp, 0], half, MU_EARTH), [-ra, 0, 0], 1);
  });
});

describe('lambert', () => {
  it('finds the circular orbit from a quarter turn in a quarter period', () => {
    const s = lambert([R, 0, 0], [0, R, 0], PERIOD / 4, MU_EARTH, UP)!;
    close(s.v1, [0, V_CIRC, 0], 1e-6);
    close(s.v2, [-V_CIRC, 0, 0], 1e-6);
  });

  it('goes the way the normal says: the long way round for the opposite normal', () => {
    const s = lambert([R, 0, 0], [0, R, 0], PERIOD * 0.75, MU_EARTH, [0, 0, -1])!;
    close(s.v1, [0, -V_CIRC, 0], 1e-6);
  });

  it('solves an out-of-plane lunar transfer that propagate then flies to its end point', () => {
    // From a parking orbit to a point 380,000 km out, 9 degrees out of the plane, in 2.5 days.
    const r1: V3 = [-R, 0, 0];
    const r2: V3 = [370_000, 40_000, -60_000];
    const tof = 2.5 * 86_400;
    const s = lambert(r1, r2, tof, MU_EARTH, UP)!;
    expect(s).not.toBeNull();
    close(propagate(r1, s.v1, tof, MU_EARTH), r2, 1);
    // A translunar injection speed: about 10.9 km/s from low Earth orbit.
    expect(Math.hypot(...s.v1)).toBeGreaterThan(10.6);
    expect(Math.hypot(...s.v1)).toBeLessThan(11.1);
  });

  it('gives null for no time, a point at the centre, or two points exactly opposite', () => {
    expect(lambert([R, 0, 0], [0, R, 0], 0, MU_EARTH, UP)).toBeNull();
    expect(lambert([0, 0, 0], [0, R, 0], 100, MU_EARTH, UP)).toBeNull();
    expect(lambert([R, 0, 0], [-2 * R, 0, 0], 3000, MU_EARTH, UP)).toBeNull();
  });
});
