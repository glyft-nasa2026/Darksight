// Tests for the mission model (T34). The expected numbers are from the formulas, worked out
// when the ticket was written (tasks/T34-mission.md, "Done when"), and from Apollo 11's timeline.
import { describe, expect, it } from 'vitest';
import {
  APOLLO_11_TIMES, EXAMPLE_LANDER, LUNAR_ORBIT_ALT_KM, MU_MOON, PARKING_ALT_KM, R_EARTH, R_MOON,
  burnSeconds, captureDv, descentOrbitDv, dvFor, halfPeriod, hohmannCoastS, missionAt, planDescent,
  planMission, propellantFor, SEQUENCE, simulateDescent, transferFor, type MissionInput, type OkPlan,
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

describe('At the Moon', () => {
  it('LOI into a 100 km circular orbit from v∞ = 0.8 km/s: 0.811 km/s', () => {
    near(captureDv(0.8, R_ORBIT), 0.811, 0.002);
  });

  it('DOI from 100 km circular to 100 × 15 km: 19.5 m/s; the 100 km orbit takes 117.8 min', () => {
    near(descentOrbitDv(R_ORBIT, R_MOON + 15) * 1000, 19.5, 0.2);
    near((2 * halfPeriod(MU_MOON, R_ORBIT)) / 60, 117.8, 0.2);
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

  it('a strong engine starts at 15 km, throttled down, and ends at rest on the ground', () => {
    const p = planDescent(1400, { ...EXAMPLE_LANDER, thrustN: 9000 })!;
    expect(p.startAltKm).toBe(15);
    expect(p.throttle).toBeLessThan(1);
    expect(p.descent.endSpeedKmS * 1000).toBeLessThan(3);
    expect(p.descent.endAltKm * 1000).toBeLessThan(10);
    expect(p.descent.dvKmS).toBeGreaterThan(1.692);   // above the speed at periapsis: gravity losses
    expect(p.descent.dvKmS).toBeLessThan(2.2);
  });

  it('a weaker engine starts higher, at full thrust, and still ends at rest', () => {
    const p = planDescent(1474, EXAMPLE_LANDER)!;
    expect(p.startAltKm).toBeGreaterThan(15);
    expect(p.startAltKm).toBeLessThan(LUNAR_ORBIT_ALT_KM);
    expect(p.throttle).toBe(1);
    expect(p.descent.endSpeedKmS * 1000).toBeLessThan(3);
    expect(p.descent.endAltKm * 1000).toBeLessThan(10);
    expect(p.descent.dvKmS).toBeLessThan(2.2);
  });

  it('an engine too weak to stop even from 99 km gives no plan', () => {
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
