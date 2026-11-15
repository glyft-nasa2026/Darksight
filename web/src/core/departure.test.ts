// Tests for the departure from Earth in 3D (issue #192).
import { describe, expect, it } from 'vitest';
import { departureAt, departureFor, inclinedPlane } from './departure';
import type { V3 } from './lambert';
import { EXAMPLE_LANDER, planMission, PARKING_ALT_KM, R_EARTH, type OkPlan } from './mission';
import { padById } from './pads';

const deg = (a: V3, b: V3): number =>
  (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)))) * 180) / Math.PI;
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const UP: V3 = [0, 0, 1];
// Earth's pole tilted 23.4 degrees from the Moon's orbit's normal, towards -y.
const t = (23.4 * Math.PI) / 180;
const POLE: V3 = [0, -Math.sin(t), Math.cos(t)];

describe('inclinedPlane', () => {
  it('holds the direction and is inclined as asked to the equator, its normal on the preferred side', () => {
    const toward: V3 = [-300_000, 200_000, -20_000];
    const n = inclinedPlane(toward, POLE, 28.6, UP);
    expect(deg(n, toward)).toBeCloseTo(90, 9);
    expect(deg(n, POLE)).toBeCloseTo(28.6, 9);
    expect(n[2]).toBeGreaterThan(0);
  });

  it('picks, of the two planes, the one nearer the preferred plane', () => {
    const toward: V3 = [1, 0.2, 0];
    const n = inclinedPlane(toward, POLE, 28.6, UP);
    // Mirror the choice: the other plane is farther from UP.
    const a = toward.map((x) => x / Math.hypot(...toward)) as V3;
    const other: V3 = n.map((x, i) => 2 * ((n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) * a[i]) - x) as V3;
    expect(deg(n, UP)).toBeLessThanOrEqual(deg(other, UP) + 1e-9);
  });

  it('takes the least inclined plane when the direction is too far from the equator', () => {
    // 0.3 rad (17.2 degrees) from the pole: 72.8 degrees from the equator, beyond 28.6. The
    // least inclined plane that holds it is inclined 72.8 degrees.
    const toward: V3 = [0, -Math.sin(t + 0.3), Math.cos(t + 0.3)];
    const n = inclinedPlane(toward, POLE, 28.6, UP);
    expect(deg(n, toward)).toBeCloseTo(90, 6);
    expect(deg(n, POLE)).toBeCloseTo(90 - (0.3 * 180) / Math.PI, 6);
  });
});

describe('departureFor and departureAt', () => {
  const plan = planMission({
    site: { lat: -89.6866, lon: -162.81 }, touchdownMs: Date.parse('2026-11-21T16:04:00Z'),
    pad: padById('ksc-39a'), lander: EXAMPLE_LANDER, earthMoonKm: 380_000,
  }) as OkPlan;
  const tli = plan.steps.find((s) => s.id === 'tli')!.startMs;

  it('stays in the Moon\'s plane when Earth\'s pole is not known', () => {
    const d = departureFor(plan, null);
    expect(d.normal).toEqual(UP);
    expect(Math.abs(d.tliDir[2])).toBeLessThan(1e-12);
  });

  it('with the pole: inclined by the pad\'s latitude, holding the entry, and one unbroken path from the pad to the Moon', () => {
    const d = departureFor(plan, POLE);
    expect(deg(d.normal, POLE)).toBeCloseTo(plan.orbit.parkingIncDeg, 6);
    expect(deg(d.normal, d.entry)).toBeCloseTo(90, 6);
    expect(d.v1).not.toBeNull();
    // On the ground at launch, in the parking orbit at TLI.
    expect(Math.hypot(...departureAt(plan, d, plan.launchMs)!)).toBeCloseTo(R_EARTH, 6);
    expect(Math.hypot(...departureAt(plan, d, tli)!)).toBeCloseTo(R_EARTH + PARKING_ALT_KM, 6);
    // No jump at TLI, and the coast reaches the entry point.
    expect(dist(departureAt(plan, d, tli - 500)!, departureAt(plan, d, tli + 500)!)).toBeLessThan(12);
    expect(dist(departureAt(plan, d, d.entryMs - 1)!, d.entry)).toBeLessThan(1);
    expect(departureAt(plan, d, d.entryMs)).toBeNull();
    // The parking orbit stays in the plane.
    const p = departureAt(plan, d, tli - 3_600_000)!;
    expect(deg(p, d.normal)).toBeCloseTo(90, 6);
  });
});
