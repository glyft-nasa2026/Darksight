// Tests for the departure from Earth in 3D (issue #192): Earth's axes and turning in the plan's
// frame, the launch window, and the path from the pad to the Moon's sphere of influence.
import { describe, expect, it } from 'vitest';
import type { Vec3 } from './ephemeris';
import {
  departureAt, departureFor, earthAxesAt, earthGroundAt, groundUnder, icrfToPlaneFor, onEarthAt,
  PARKING_MAX_LAPS, withLaunchWindow,
} from './departure';
import type { V3 } from './lambert';
import { ascentDvFor, EARTH_SPIN, EXAMPLE_LANDER, planMission, PARKING_ALT_KM, R_EARTH, type OkPlan } from './mission';
import { padById } from './pads';

const deg = (a: V3, b: V3): number =>
  (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)))) * 180) / Math.PI;
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A made-up sky: the Moon's orbit in the ecliptic (its pole 23.44 degrees from the ICRF's z),
// the Moon at ecliptic longitude `a` at touchdown. The real one is within 5 degrees of it.
const EPS = (23.44 * Math.PI) / 180;
const skyAt = (aDeg: number): { toMoon: Vec3; pole: Vec3 } => {
  const a = (aDeg * Math.PI) / 180;
  return { toMoon: [Math.cos(a), Math.sin(a) * Math.cos(EPS), Math.sin(a) * Math.sin(EPS)], pole: [0, -Math.sin(EPS), Math.cos(EPS)] };
};
const KSC = padById('ksc-39a');
const planFor = (touchdownMs: number): OkPlan => planMission({
  site: { lat: -89.6866, lon: -162.81 }, touchdownMs, pad: KSC, lander: EXAMPLE_LANDER, earthMoonKm: 380_000,
}) as OkPlan;
const TD = Date.parse('2026-11-21T16:04:00Z');
const startOf = (p: OkPlan, id: string): number => p.steps.find((s) => s.id === id)!.startMs;

describe('Earth in the plan\'s frame', () => {
  const frame = icrfToPlaneFor(planFor(TD), skyAt(40));

  it('has right-handed unit axes, its pole tilted about 23.4 degrees from the Moon\'s orbit pole, turning once a sidereal day', () => {
    const [x, y, z] = earthAxesAt(frame, TD);
    for (const v of [x, y, z]) expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    expect(dot(x, y)).toBeCloseTo(0, 12);
    expect(dist(cross(x, y), z)).toBeLessThan(1e-12);
    // 23.44 degrees at J2000; precession since has moved the pole about 0.15 degrees.
    expect(Math.abs(deg(z, [0, 0, 1]) - 23.44)).toBeLessThan(0.5);
    // A place on Earth comes back after one sidereal day, and is a quarter turn on after a quarter.
    const day = (2 * Math.PI) / EARTH_SPIN * 1000;
    const p0 = onEarthAt(frame, 28.6, -80.6, TD);
    expect(dist(p0, onEarthAt(frame, 28.6, -80.6, TD + day))).toBeLessThan(1e-5);
    expect(deg(cross(z, p0), cross(z, onEarthAt(frame, 28.6, -80.6, TD + day / 4)))).toBeCloseTo(90, 2);
  });

  it('finds the place under a point again (groundUnder undoes onEarthAt)', () => {
    for (const [lat, lon] of [[28.6083, -80.6044], [-33, 151], [5.24, -52.77], [67.9, 21.1]]) {
      const g = groundUnder(frame, onEarthAt(frame, lat, lon, TD + 12_345_678), TD + 12_345_678);
      expect(g.lat).toBeCloseTo(lat, 9);
      expect(g.lon).toBeCloseTo(lon, 9);
    }
  });
});

describe('The launch window and the path from the pad', () => {
  // Touchdown days and Moon directions apart, so the pad, the plane and Earth's turn all vary.
  const cases = [0, 1, 2, 3, 4, 5].map((i) => ({ plan: planFor(TD + i * 1.37 * 86_400_000), sky: skyAt(i * 61) }));

  it('lifts off from where the pad really is, into a plane that holds the pad and the arrival, heading east', () => {
    for (const { plan, sky } of cases) {
      const w = withLaunchWindow(plan, sky);
      expect(w.earth).toBeDefined();
      const frame = w.earth!.icrfToPlane;
      const d = departureFor(w);
      const pad = onEarthAt(frame, KSC.lat, KSC.lon, w.launchMs);
      expect(dist(departureAt(w, d, w.launchMs)!, pad.map((x) => x * R_EARTH) as V3)).toBeLessThan(0.01);
      expect(deg(d.normal, pad)).toBeCloseTo(90, 6);
      expect(deg(d.normal, d.entry)).toBeCloseTo(90, 6);
      // The inclination is the plane's, never less than the pad's latitude, and eastward.
      const pole = earthAxesAt(frame, w.launchMs)[2];
      expect(deg(d.normal, pole)).toBeCloseTo(w.orbit.parkingIncDeg, 6);
      expect(w.orbit.parkingIncDeg).toBeGreaterThanOrEqual(KSC.lat - 1e-6);
      const moved = departureAt(w, d, w.launchMs + 10_000)!;
      expect(dot(moved.map((v, i) => v - pad[i] * R_EARTH) as V3, cross(pole, pad))).toBeGreaterThan(0);
    }
  });

  it('moves only the launch: the ascent takes as long, the parking orbit half a lap to the most allowed, TLI and after unchanged', () => {
    for (const { plan, sky } of cases) {
      const w = withLaunchWindow(plan, sky);
      const lap = (2 * Math.PI) / plan.geometry.nPark * 1000;
      const parking = startOf(w, 'tli') - startOf(w, 'parking');
      expect(parking).toBeGreaterThanOrEqual(0.5 * lap - 31_000);
      expect(parking).toBeLessThanOrEqual(PARKING_MAX_LAPS * lap + 31_000);
      expect(startOf(w, 'launch')).toBe(w.launchMs);
      expect(startOf(w, 'parking') - w.launchMs).toBe(startOf(plan, 'parking') - plan.launchMs);
      expect(w.steps.slice(2)).toEqual(plan.steps.slice(2));
      expect(w.touchdownMs).toBe(plan.touchdownMs);
      // The ascent's Δv follows the inclination; the total follows the ascent.
      expect(w.steps[0].dvKmS).toBeCloseTo(ascentDvFor(w.orbit.parkingIncDeg), 12);
      expect(w.totals.launchVehicleDvKmS - plan.totals.launchVehicleDvKmS).toBeCloseTo(w.steps[0].dvKmS! - plan.steps[0].dvKmS!, 12);
    }
  });

  it('is one unbroken path from the pad to the Moon\'s sphere of influence', () => {
    for (const { plan, sky } of cases) {
      const w = withLaunchWindow(plan, sky);
      const d = departureFor(w);
      const tli = startOf(w, 'tli');
      expect(d.v1).not.toBeNull();
      expect(Math.hypot(...departureAt(w, d, tli)!)).toBeCloseTo(R_EARTH + PARKING_ALT_KM, 6);
      let prev = departureAt(w, d, w.launchMs)!;
      for (let t = w.launchMs + 60_000; t < d.entryMs; t += 60_000) {
        const p = departureAt(w, d, t)!;
        // Never faster than 11.1 km/s: a step of a minute is under 670 km.
        expect(dist(p, prev)).toBeLessThan(670);
        prev = p;
      }
      expect(dist(departureAt(w, d, d.entryMs - 1)!, d.entry)).toBeLessThan(1);
    }
  });

  it('puts the craft over the pad at launch, and over places of every longitude, no farther from the equator than the inclination', () => {
    const w = withLaunchWindow(cases[0].plan, cases[0].sky);
    const d = departureFor(w);
    const g0 = earthGroundAt(w, d, w.launchMs)!;
    expect(g0.lat).toBeCloseTo(KSC.lat, 6);
    expect(g0.lon).toBeCloseTo(KSC.lon, 6);
    const lons = new Set<number>();
    for (let t = w.launchMs; t <= startOf(w, 'tli'); t += 30_000) {
      const g = earthGroundAt(w, d, t)!;
      expect(Math.abs(g.lat)).toBeLessThanOrEqual(w.orbit.parkingIncDeg + 1e-6);
      lons.add(Math.floor((g.lon + 180) / 30));
    }
    expect(lons.size).toBeGreaterThanOrEqual(6);
  });

  it('without the table: no window, the departure in the Moon\'s plane, and no place under the craft', () => {
    const plan = planFor(TD);
    expect(plan.earth).toBeUndefined();
    const d = departureFor(plan);
    expect(d.normal).toEqual([0, 0, 1]);
    expect(Math.abs(d.tliDir[2])).toBeLessThan(1e-12);
    expect(earthGroundAt(plan, d, plan.launchMs)).toBeNull();
    // A due-east launch from the pad's latitude.
    expect(plan.orbit.parkingIncDeg).toBeCloseTo(KSC.lat, 12);
    expect(plan.steps[0].dvKmS).toBeCloseTo(ascentDvFor(KSC.lat), 12);
  });
});

describe('ascentDvFor', () => {
  it('gets the turning Earth\'s help times the cosine of the inclination: 0.408 km/s due east from Kennedy, none into a polar orbit', () => {
    expect(ascentDvFor(90) - ascentDvFor(KSC.lat)).toBeCloseTo(EARTH_SPIN * R_EARTH * Math.cos((KSC.lat * Math.PI) / 180), 12);
    expect(ascentDvFor(90) - ascentDvFor(KSC.lat)).toBeCloseTo(0.408, 3);
  });
});
