// Tests for the bend that joins the transfer to the arrival at the Moon (issue #192).
import { describe, expect, it } from 'vitest';
import { coastBend, type V3 } from './arrival';

const FROM = 1_000_000;
const TO = FROM + 3 * 86_400_000;   // a three-day coast
const GAP: V3 = [40_000, -60_000, 10_000];
const RATE: V3 = [0.3, -0.8, 0.1];

/** The rate of change of the bend, per second, by a central difference. */
const rate = (t: number): V3 => {
  const h = 1000;
  const a = coastBend(t - h, FROM, TO, GAP, RATE);
  const b = coastBend(t + h, FROM, TO, GAP, RATE);
  return [0, 1, 2].map((i) => (b[i] - a[i]) / 2) as V3;
};

describe('coastBend', () => {
  it('is zero at TLI and before it, and does not change there', () => {
    expect(coastBend(FROM - 5000, FROM, TO, GAP, RATE)).toEqual([0, 0, 0]);
    expect(coastBend(FROM, FROM, TO, GAP, RATE)).toEqual([0, 0, 0]);
    for (const v of rate(FROM + 1000)) expect(Math.abs(v)).toBeLessThan(1e-3);
  });

  it('reaches the gap at the sphere of influence, changing at the given rate, so there is no gap and no corner', () => {
    const end = coastBend(TO, FROM, TO, GAP, RATE);
    end.forEach((v, i) => expect(v).toBeCloseTo(GAP[i], 9));
    const r = rate(TO - 1000);
    r.forEach((v, i) => expect(v).toBeCloseTo(RATE[i], 3));
  });

  it('changes smoothly in between, without jumps', () => {
    let prev = coastBend(FROM, FROM, TO, GAP, RATE);
    for (let t = FROM; t <= TO; t += 600_000) {
      const p = coastBend(t, FROM, TO, GAP, RATE);
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(2000);
      prev = p;
    }
  });

  it('gives no bend when the times are the wrong way round', () => {
    expect(coastBend(FROM, TO, FROM, GAP, RATE)).toEqual([0, 0, 0]);
  });
});
