// Tests for the mission model (T34). The expected numbers are from the formulas, worked out
// when the ticket was written (tasks/T34-mission.md, "Done when"), and from Apollo 11's timeline.
import { describe, expect, it } from 'vitest';
import {
  APOLLO_11_TIMES, EXAMPLE_LANDER, LUNAR_ORBIT_ALT_KM, MU_MOON, PARKING_ALT_KM, R_EARTH, R_MOON,
  burnSeconds, captureDv, descentOrbitDv, dvFor, earthMoonKmAt, halfPeriod, hohmannCoastS, missionAt, moonFixedInPlane, planDescent, approachSeconds, hyperbolaAt, hyperbolaTimeToRadius, MOON_SOI_KM,
  arrivalOrbit, lunarFrameInEarthPlane, planMission, propellantFor, SEQUENCE, simulateDescent, simulateGuidedDescent, HIGH_GATE_KM, ASCENT_LOSSES_KMS, transferFor, type MissionInput, type OkPlan,
} from './mission';
import { padById } from './pads';

const DAY_S = 86_400;
const R_PARK = R_EARTH + PARKING_ALT_KM;
const R_ORBIT = R_MOON + LUNAR_ORBIT_ALT_KM;
const MEAN_EARTH_MOON_KM = 384_400;

const near = (actual: number, expected: number, tolerance: number): void => {
  expect(Math.abs(actual - expected), `${actual} vs ${expected} ± ${tolerance}`).toBeLessThanOrEqual(tolerance);
};

describe('Earth to Moon', () => {
  it('TLI onto a Hohmann ellipse reaching 384,400 km: 3.135 km/s, coast 4.98 days', () => {
    const coast = hohmannCoastS(R_PARK, MEAN_EARTH_MOON_KM);
    near(coast / DAY_S, 4.98, 0.01);
    const t = transferFor(R_PARK, MEAN_EARTH_MOON_KM, coast);
    expect(t).not.toBeNull();
    near(t!.dvKmS, 3.135, 0.005);
    near(t!.apogeeKm, MEAN_EARTH_MOON_KM, 1);
    near(t!.vInfKmS, 0.832, 0.003);   // the Moon's 1.018 km/s less the ellipse's 0.187 at apogee
  });

  it('a shorter coast needs more Δv; one longer than Hohmann is out of range', () => {
    const hohmann = transferFor(R_PARK, MEAN_EARTH_MOON_KM, hohmannCoastS(R_PARK, MEAN_EARTH_MOON_KM))!;
    const apollo = transferFor(R_PARK, MEAN_EARTH_MOON_KM, APOLLO_11_TIMES.coastS)!;
    const faster = transferFor(R_PARK, MEAN_EARTH_MOON_KM, 2.5 * DAY_S)!;
    expect(apollo.dvKmS).toBeGreaterThan(hohmann.dvKmS);
    expect(faster.dvKmS).toBeGreaterThan(apollo.dvKmS);
    expect(apollo.apogeeKm).toBeGreaterThan(MEAN_EARTH_MOON_KM);
    near(apollo.coastS, APOLLO_11_TIMES.coastS, 1e-6);
    expect(transferFor(R_PARK, MEAN_EARTH_MOON_KM, 6 * DAY_S)).toBeNull();
    expect(transferFor(R_PARK, MEAN_EARTH_MOON_KM, 0.5 * DAY_S)).toBeNull();
  });
});

describe('Earth-Moon distance from the table', () => {
  it('is the length of the Earth vector, or null where the table has no data', () => {
    const at = (earthKm: [number, number, number]) => ({ vectorsAt: () => ({ sun: [1, 0, 0] as [number, number, number], earthKm }) });
    near(earthMoonKmAt(at([300_000, 0, 400_000]), 0)!, 500_000, 1e-6);
    expect(earthMoonKmAt(at([Number.NaN, Number.NaN, Number.NaN]), 0)).toBeNull();
  });
});

describe('At the Moon', () => {
  it('LOI into a 100 km circular orbit from v∞ = 0.8 km/s: 0.811 km/s', () => {
    near(captureDv(0.8, R_ORBIT), 0.811, 0.002);
  });

  it('DOI from 100 km circular to 100 × 15 km: 19.5 m/s; the 100 km orbit takes 117.8 min', () => {
    near(descentOrbitDv(R_ORBIT, R_MOON + 15) * 1000, 19.5, 0.2);
    near((2 * halfPeriod(MU_MOON, R_ORBIT)) / 60, 117.8, 0.2);
    near(okPlan().orbit.lunarOrbitPeriodS / 60, 117.8, 0.2);
  });

  it('half the 100 × 15 km descent orbit is within 1 % of Apollo 11\'s DOI to powered descent (56 min 51 s)', () => {
    const apollo = (102 * 3600 + 33 * 60 + 5.01) - (101 * 3600 + 36 * 60 + 14);
    near(halfPeriod(MU_MOON, (R_ORBIT + R_MOON + 15) / 2), apollo, apollo * 0.01);
  });
});

describe('Rocket equation', () => {
  it('propellant for a Δv, and the Δv back from that propellant, agree to 1e-9', () => {
    for (const [m0, dv, isp] of [[1908, 0.85, 320], [15_000, 2.0, 311], [500, 0.02, 230]]) {
      const prop = propellantFor(m0, dv, isp);
      near(dvFor(m0, m0 - prop, isp), dv, 1e-9);
    }
    expect(propellantFor(1000, 0, 300)).toBe(0);
  });

  it('burn time is propellant times exhaust speed over thrust', () => {
    // 100 kg at Isp 300 s (2,942 m/s exhaust) with 2,942 N of thrust: 100 s.
    near(burnSeconds(100, 300 * 9.80665, 300), 100, 1e-9);
  });
});

describe('Powered descent', () => {
  it('the gravity turn from 15 km checked for the ticket: 1.76 km/s, 4.8 min, 260 km, within 2 %', () => {
    // 4.62 m/s² of thrust per unit of starting mass, Isp 311 s: the thrust that just lands.
    const d = simulateDescent(15, 1000, 4621, 311, 1);
    near(d.dvKmS, 1.757, 1.757 * 0.02);
    near(d.durationS / 60, 4.82, 4.82 * 0.02);
    near(d.rangeKm, 259.7, 259.7 * 0.02);
  });

  it('Apollo 11’s lunar module from 15 km: within 20 % of its 12 min 34.9 s powered descent, Δv 1.9 to 2.3 km/s', () => {
    // 15,100 kg, 45.04 kN, Isp 311 s (docs/sources/issue-181.md). Ignition 102:33:05.01, landing 102:45:39.9.
    const apollo = (102 * 3600 + 45 * 60 + 39.9) - (102 * 3600 + 33 * 60 + 5.01);
    const d = simulateGuidedDescent(15, 15_100, 45_040, 311);
    near(d.durationS, apollo, apollo * 0.2);
    expect(d.dvKmS).toBeGreaterThan(1.9);
    expect(d.dvKmS).toBeLessThan(2.3);
    expect(d.endSpeedKmS * 1000).toBeLessThan(3);
    // Braking to the high gate takes most of it, as on Apollo.
    expect(d.brakingS / d.durationS).toBeGreaterThan(0.5);
  });

  it('the altitude falls through braking: never above the start, at the high gate when braking ends', () => {
    const d = simulateGuidedDescent(15, 1420, EXAMPLE_LANDER.thrustN, EXAMPLE_LANDER.ispS, true);
    for (const s of d.samples) expect(s.altKm).toBeLessThan(15.5);
    const atGate = d.samples.find((s) => s.tS >= d.brakingS)!;
    near(atGate.altKm, HIGH_GATE_KM, 1);
  });

  it('a strong engine and the example lander both start at 15 km, at full thrust, and touch down under 3 m/s', () => {
    for (const lander of [{ ...EXAMPLE_LANDER, thrustN: 9000 }, EXAMPLE_LANDER]) {
      const p = planDescent(1474, lander)!;
      expect(p.startAltKm).toBe(15);
      expect(p.throttle).toBe(1);
      expect(p.descent.endSpeedKmS * 1000).toBeLessThan(3);
      expect(p.descent.endAltKm).toBe(0);
      expect(p.descent.dvKmS).toBeGreaterThan(1.692);   // above the speed at periapsis: gravity losses
      expect(p.descent.dvKmS).toBeLessThan(2.3);
    }
    // The weaker engine fights gravity longer: a longer descent, more Δv.
    const strong = planDescent(1474, { ...EXAMPLE_LANDER, thrustN: 9000 })!.descent;
    const weak = planDescent(1474, EXAMPLE_LANDER)!.descent;
    expect(weak.durationS).toBeGreaterThan(strong.durationS);
    expect(weak.dvKmS).toBeGreaterThan(strong.dvKmS);
  });

  it('an engine that cannot lift the lander in the Moon’s gravity gives no plan', () => {
    expect(planDescent(1474, { ...EXAMPLE_LANDER, thrustN: 1500 })).toBeNull();
  });
});

const SHACKLETON: MissionInput['site'] = { lat: -89.6866, lon: -162.81 };
const TOUCHDOWN = Date.parse('2026-11-21T16:04:00Z');
const input = (over: Partial<MissionInput> = {}): MissionInput => ({
  site: SHACKLETON, touchdownMs: TOUCHDOWN, pad: padById('ksc-39a'), lander: EXAMPLE_LANDER,
  earthMoonKm: 380_000, ...over,
});
const okPlan = (over: Partial<MissionInput> = {}): OkPlan => {
  const p = planMission(input(over));
  if (!p.ok) throw new Error(p.error);
  return p;
};

describe('The whole mission', () => {
  const plan = okPlan();

  it('touches down at the scenario\'s time exactly, and the steps are in order, end to start', () => {
    expect(plan.touchdownMs).toBe(TOUCHDOWN);
    expect(plan.steps[plan.steps.length - 1]).toMatchObject({ id: 'touchdown', startMs: TOUCHDOWN, endMs: TOUCHDOWN });
    expect(plan.steps[0].startMs).toBe(plan.launchMs);
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      expect(s.endMs, s.id).toBeGreaterThanOrEqual(s.startMs);
      if (i > 0) expect(s.startMs, s.id).toBe(plan.steps[i - 1].endMs);
    }
    // Every phase with a duration has a positive one.
    for (const id of ['launch', 'parking', 'coast', 'lunar-orbit', 'descent-orbit', 'powered-descent']) {
      const s = plan.steps.find((x) => x.id === id)!;
      expect(s.endMs - s.startMs, id).toBeGreaterThan(0);
    }
    for (const id of SEQUENCE) expect(plan.steps.some((s) => s.id === id)).toBe(true);
  });

  it('takes Apollo 11\'s phase lengths: launch about 4.3 days before touchdown', () => {
    const days = (plan.touchdownMs - plan.launchMs) / 1000 / DAY_S;
    expect(days).toBeGreaterThan(4.2);
    expect(days).toBeLessThan(4.4);
  });

  it('adds up the propellant: loaded = used + left, and the lander\'s Δv is the sum of its burns', () => {
    const t = plan.totals;
    near(t.propellantUsedKg + t.propellantLeftKg, t.propellantLoadedKg, 1e-6);
    const burns = plan.steps.filter((s) => s.by === 'lander').reduce((sum, s) => sum + (s.dvKmS ?? 0), 0);
    near(t.landerDvKmS, burns, 1e-9);
    expect(t.margin).toBeGreaterThan(0);
    expect(plan.runsOutMs).toBeNull();
  });

  it('ends on the site: within 0.01 degrees at touchdown, at rest, on the ground', () => {
    const s = missionAt(plan, TOUCHDOWN);
    expect(s.stepIndex).toBe(plan.steps.length - 1);
    near(s.ground!.lat, SHACKLETON.lat, 0.01);
    // Longitude is meaningless at the pole itself; here 0.31 degrees from it, compare on the ground.
    const dLon = (((s.ground!.lon - SHACKLETON.lon + 540) % 360) - 180) * Math.cos((SHACKLETON.lat * Math.PI) / 180);
    near(dLon, 0, 0.01);
    expect(s.altKm).toBe(0);
    expect(s.speedKmS).toBe(0);
    expect(s.rangeToGoKm).toBe(0);
  });

  it('lands on an equatorial site too, the Moon turning under the orbit until then', () => {
    const p = okPlan({ site: { lat: 0.67408, lon: 23.47297 } });
    const s = missionAt(p, p.touchdownMs);
    near(s.ground!.lat, 0.67408, 0.01);
    near(s.ground!.lon, 23.47297, 0.01);
    // A day earlier, in the 100 km orbit, the point under the craft is somewhere else.
    const before = missionAt(p, p.touchdownMs - DAY_S * 1000);
    expect(before.altKm).toBeCloseTo(LUNAR_ORBIT_ALT_KM, 6);
    expect(Math.abs(before.ground!.lon - 23.47297) + Math.abs(before.ground!.lat - 0.67408)).toBeGreaterThan(1);
  });

  it('is on the pad at launch, in the parking orbit at TLI, at 100 km after LOI', () => {
    near(missionAt(plan, plan.launchMs).altKm, 0, 1e-9);
    const tli = plan.steps.find((s) => s.id === 'tli')!.startMs;
    near(missionAt(plan, tli).altKm, PARKING_ALT_KM, 1e-6);
    const loi = plan.steps.find((s) => s.id === 'loi')!.startMs;
    const after = missionAt(plan, loi + 1000);
    expect(after.near).toBe('moon');
    near(after.altKm, LUNAR_ORBIT_ALT_KM, 1e-6);
    // Just before arrival the craft is at the Moon's distance, where the Moon is.
    const arriving = missionAt(plan, loi - 1);
    const [cx, cy] = arriving.earthPlane.craft;
    const [mx, my] = arriving.earthPlane.moon;
    near(Math.hypot(cx - mx, cy - my), 0, 1);
  });

  it('moves smoothly: no jump in the Moon-centred picture between the phases', () => {
    const ids = ['doi', 'powered-descent'] as const;
    for (const id of ids) {
      const t = plan.steps.find((s) => s.id === id)!.startMs;
      const a = missionAt(plan, t - 500).moonPlane!;
      const b = missionAt(plan, t + 500).moonPlane!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]), id).toBeLessThan(5);   // km in one second
    }
  });

  it('counts propellant down through the burns', () => {
    const at = (id: string): number => plan.steps.find((s) => s.id === id)!.startMs;
    const loaded = plan.totals.propellantLoadedKg;
    expect(missionAt(plan, at('coast') + 1).propellantLeftKg).toBe(loaded);
    expect(missionAt(plan, at('lunar-orbit') + 1).propellantLeftKg).toBeLessThan(loaded);
    near(missionAt(plan, TOUCHDOWN).propellantLeftKg, plan.totals.propellantLeftKg, 1e-6);
  });
});

describe('Launch', () => {
  it('the launch Δv is the ideal one plus the cited 1.75 km/s of gravity and drag losses: about 9.1 km/s from Kennedy', () => {
    const launch = okPlan().steps.find((s) => s.id === 'launch')!;
    expect(ASCENT_LOSSES_KMS).toBe(1.75);
    // Ideal from Kennedy to 185 km: 7.79 km/s orbital speed less 0.41 km/s from Earth's turning.
    near(launch.dvKmS!, 7.38 + 1.75, 0.02);
  });
});

describe('Inputs the model refuses, and a lander that runs dry', () => {
  it('says why there is no plan', () => {
    expect(planMission(input({ lander: { ...EXAMPLE_LANDER, dryKg: 2000 } }))).toEqual({ ok: false, error: 'bad-input' });
    expect(planMission(input({ touchdownMs: Number.NaN }))).toEqual({ ok: false, error: 'bad-input' });
    expect(planMission(input({ lander: { ...EXAMPLE_LANDER, thrustN: 1500 } }))).toEqual({ ok: false, error: 'thrust-too-low' });
    expect(planMission(input({ times: { ...APOLLO_11_TIMES, coastS: 10 * DAY_S } }))).toEqual({ ok: false, error: 'coast-out-of-range' });
  });

  it('marks when the propellant runs out', () => {
    const p = okPlan({ lander: { ...EXAMPLE_LANDER, dryKg: 1700 } });
    expect(p.totals.margin).toBeLessThan(0);
    expect(p.runsOutMs).toBe(p.steps.find((s) => s.id === 'loi')!.startMs);
  });
});

describe('The landing site in the animation’s lunar-orbit frame (issue #105)', () => {
  const plan = okPlan();
  const step = (id: string) => plan.steps.find((s) => s.id === id)!;

  it('puts the site where the descent ends, at touchdown', () => {
    const [x, y, z] = moonFixedInPlane(plan, plan.touchdownMs, SHACKLETON.lat, SHACKLETON.lon);
    const end = missionAt(plan, plan.touchdownMs).moonPlane!;
    near(x, end[0], 1e-6);
    near(y, end[1], 1e-6);
    near(z, 0, 1e-6);
  });

  it('is the inverse of missionAt’s ground point, in lunar orbit and in the descent', () => {
    const times = [step('lunar-orbit').startMs + 1234e3, step('descent-orbit').startMs + 600e3,
      step('powered-descent').startMs + 60e3, plan.touchdownMs - 5e3];
    for (const t of times) {
      const st = missionAt(plan, t);
      const [x, y, z] = moonFixedInPlane(plan, t, st.ground!.lat, st.ground!.lon, st.altKm);
      near(x, st.moonPlane![0], 1e-6);
      near(y, st.moonPlane![1], 1e-6);
      near(z, 0, 1e-6);
    }
  });

  it('turns with the Moon: a day before touchdown the site has moved about 13 degrees', () => {
    const [x, y] = moonFixedInPlane(plan, plan.touchdownMs - DAY_S * 1000, SHACKLETON.lat, SHACKLETON.lon);
    const r = Math.hypot(x, y, moonFixedInPlane(plan, plan.touchdownMs - DAY_S * 1000, SHACKLETON.lat, SHACKLETON.lon)[2]);
    near(r, R_MOON, 1e-6);
    // Near the pole the site barely moves; check an equatorial site instead.
    const eq = okPlan({ site: { lat: 0, lon: 30 } });
    const [ex, ey, ez] = moonFixedInPlane(eq, eq.touchdownMs - DAY_S * 1000, 0, 30);
    const angle = (Math.acos(Math.max(-1, Math.min(1, ey / R_MOON))) * 180) / Math.PI;
    near(angle, (360 / 655.72) * 24, 0.01);
    near(Math.hypot(ex, ey, ez), R_MOON, 1e-6);
  });

  it('gives two sites different places on the Moon: the north pole is elsewhere relative to each', () => {
    const eq = okPlan({ site: { lat: 0, lon: 30 } });
    const poleSouth = moonFixedInPlane(plan, plan.touchdownMs, 90, 0);
    const poleEq = moonFixedInPlane(eq, eq.touchdownMs, 90, 0);
    // From Shackleton (0.3° from the south pole) the north pole is almost opposite the site;
    // from the equator it is a quarter turn away. The orbit's plane is the one the arrival leads
    // into (issue #192), so the pole is off it by the inclination.
    const cosInc = (p: OkPlan): number => Math.cos((p.orbit.lunarOrbitIncDeg * Math.PI) / 180);
    near(poleSouth[2], R_MOON * cosInc(plan), 1e-6);
    near(poleEq[2], R_MOON * cosInc(eq), 1e-6);
    near(poleSouth[1], -R_MOON, 0.1);
    near(poleEq[1], 0, 1e-6);
  });
});

describe('Arrival at the Moon: the hyperbola before LOI', () => {
  const plan = okPlan();
  const loi = plan.steps.find((s) => s.id === 'loi')!.startMs;
  const vInf = plan.orbit.vInfKmS;

  it('reaches the sphere of influence at the time it gives, and the periapsis at LOI', () => {
    const tS = hyperbolaTimeToRadius(MU_MOON, R_ORBIT, vInf, MOON_SOI_KM);
    near(hyperbolaAt(MU_MOON, R_ORBIT, vInf, -tS).r, MOON_SOI_KM, 1e-3);
    near(hyperbolaAt(MU_MOON, R_ORBIT, vInf, 0).r, R_ORBIT, 1e-9);
    // About 15 hours for v∞ 0.83 km/s (14.8 h).
    expect(tS / 3600).toBeGreaterThan(12);
    expect(tS / 3600).toBeLessThan(20);
  });

  it('is fastest at periapsis, and LOI is that speed less the circular speed', () => {
    const peri = hyperbolaAt(MU_MOON, R_ORBIT, vInf, 0).speedKmS;
    const loiDv = plan.steps.find((s) => s.id === 'loi')!.dvKmS!;
    near(peri - Math.sqrt(MU_MOON / R_ORBIT), loiDv, 1e-9);
    expect(hyperbolaAt(MU_MOON, R_ORBIT, vInf, -3600).speedKmS).toBeLessThan(peri);
  });

  it('draws the approach only inside the sphere of influence, and meets the 100 km orbit at LOI', () => {
    const start = loi - approachSeconds(plan) * 1000;
    expect(missionAt(plan, start - 60e3).approach).toBe(false);
    expect(missionAt(plan, start - 60e3).moonPlane).toBeNull();
    const inSoi = missionAt(plan, start + 60e3);
    expect(inSoi.approach).toBe(true);
    expect(inSoi.near).toBe('moon');
    near(Math.hypot(...inSoi.moonPlane!), MOON_SOI_KM, 200);
    const before = missionAt(plan, loi - 1).moonPlane!;
    const after = missionAt(plan, loi + 1).moonPlane!;
    near(Math.hypot(before[0] - after[0], before[1] - after[1]), 0, 0.01);
    near(missionAt(plan, loi - 1).altKm, LUNAR_ORBIT_ALT_KM, 0.01);
  });
});

describe('The arrival leads into the lunar orbit (issue #192)', () => {
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const angleDeg = (a: number[], b: number[]): number =>
    (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / Math.hypot(a[0], a[1], a[2]) / Math.hypot(b[0], b[1], b[2])))) * 180) / Math.PI;

  it('arrivalOrbit: a plane through the site holding vInf, crossed heading south, and the craft comes in from -vInf', () => {
    const site: [number, number, number] = [0.3, -0.2, -0.93];
    const vInf: [number, number, number] = [-0.4, 0.9, 0];
    const r = R_MOON + LUNAR_ORBIT_ALT_KM;
    const a = arrivalOrbit(site, vInf, r, 0.9)!;
    const s = site.map((x) => x / Math.hypot(...site));
    near(Math.hypot(...a.travel), 1, 1e-12);
    near(dot(a.travel, s), 0, 1e-12);
    expect(a.travel[2]).toBeLessThanOrEqual(0);
    // vInf is in the plane: no part along the normal.
    const n = [s[1] * a.travel[2] - s[2] * a.travel[1], s[2] * a.travel[0] - s[0] * a.travel[2], s[0] * a.travel[1] - s[1] * a.travel[0]];
    near(dot(n, vInf), 0, 1e-12);
    // Far out on the way in (true anomaly -nuInf from periapsis) the craft is towards -vInf.
    const e = 1 + (r * 0.9 ** 2) / MU_MOON;
    const th = a.periapsisAngle - Math.acos(-1 / e);
    const far = [0, 1, 2].map((i) => Math.cos(th) * s[i] + Math.sin(th) * a.travel[i]);
    near(angleDeg(far, vInf.map((x) => -x)), 0, 1e-6);
    expect(arrivalOrbit([0, 0, -1], [0, 0, 2], r, 0.9)).toBeNull();
  });

  for (const [name, site] of [['Shackleton rim', SHACKLETON], ['an equatorial site', { lat: 0.67408, lon: 23.47297 }]] as const) {
    it(`${name}: the hyperbola comes in along the transfer, so the two join (within the impact parameter's few degrees)`, () => {
      const p = okPlan({ site });
      const loi = p.steps.find((s) => s.id === 'loi')!.startMs;
      const entry = loi - approachSeconds(p) * 1000 + 1;
      const [lx, ly, lz] = lunarFrameInEarthPlane(p);
      const toEarth = (m: [number, number]): number[] => [0, 1, 2].map((i) => m[0] * lx[i] + m[1] * ly[i]);
      // The craft's direction from the Moon on the hyperbola, in the transfer's frame...
      const rel = toEarth(missionAt(p, entry).moonPlane!);
      // ...against where the transfer comes in from: -vInf, in the plane, at LOI.
      const t = p.geometry.transfer;
      const ang = Math.PI + t.arriveNu;
      const vInf = [
        t.vInfRadialKmS * Math.cos(ang) - t.vInfAlongKmS * Math.sin(ang),
        t.vInfRadialKmS * Math.sin(ang) + t.vInfAlongKmS * Math.cos(ang),
        0,
      ];
      expect(angleDeg(rel, vInf.map((x) => -x))).toBeLessThan(6);
      // The frame is a rotation: unit, at right angles, right-handed.
      for (const v of [lx, ly, lz]) near(Math.hypot(...v), 1, 1e-12);
      near(dot(lx, ly), 0, 1e-12);
      const c = [lx[1] * ly[2] - lx[2] * ly[1], lx[2] * ly[0] - lx[0] * ly[2], lx[0] * ly[1] - lx[1] * ly[0]];
      near(angleDeg(c, lz), 0, 1e-6);
    });

    it(`${name}: still lands on the site, waiting in lunar orbit within half a lap of Apollo 11's wait`, () => {
      const p = okPlan({ site });
      const s = missionAt(p, p.touchdownMs);
      near(s.ground!.lat, site.lat, 0.01);
      const wait = (p.steps.find((x) => x.id === 'doi')!.startMs - p.steps.find((x) => x.id === 'loi')!.startMs) / 1000;
      near(wait, p.orbit.lunarOrbitS, 1e-3);
      expect(Math.abs(wait - APOLLO_11_TIMES.lunarOrbitS)).toBeLessThanOrEqual(p.orbit.lunarOrbitPeriodS / 2 + 1);
      expect(p.orbit.lunarOrbitIncDeg).toBeGreaterThanOrEqual(0);
      expect(p.orbit.lunarOrbitIncDeg).toBeLessThanOrEqual(180);
    });
  }
});
