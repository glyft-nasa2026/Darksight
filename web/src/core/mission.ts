// Mission simulation (T34): from a launch pad on Earth to touchdown at a site on the Moon, at a
// chosen time. A planning model, not a flight-dynamics solution:
//   - Earth to Moon by patched conics: a circular parking orbit, an impulsive translunar
//     injection (TLI) onto an ellipse that reaches the Moon's distance in the chosen coast time,
//     and the arrival speed relative to the Moon (v-infinity), with the Moon's sphere of
//     influence treated as a point.
//   - At the Moon: impulsive lunar orbit insertion (LOI) into a 100 km circular polar orbit,
//     impulsive descent orbit insertion (DOI) down to the descent start, and a numerically
//     integrated gravity-turn powered descent (thrust against the velocity) to the surface.
//   - Times run backwards from touchdown, which is the landing scenario's time exactly.
// The Moon has no atmosphere: no drag, no refraction. Nothing here touches the DOM or network.

import type { Ephemeris } from './ephemeris';
import type { Pad } from './pads';
import type { Site } from './types';

// ---------------------------------------------------------------------------------------------
// Constants (docs/sources/T34.md)
// ---------------------------------------------------------------------------------------------

/** km³/s², JPL DE440 (JPL Astrodynamic Parameters). */
export const MU_EARTH = 398600.435507;
/** km³/s², JPL DE440 (JPL Astrodynamic Parameters). */
export const MU_MOON = 4902.800118;
/** km, WGS 84 equatorial radius. */
export const R_EARTH = 6378.137;
/** km, docs/data-contract.md. */
export const R_MOON = 1737.4;
/** km/s², standard gravity, for specific impulse. */
export const G0 = 9.80665e-3;
/** rad/s: one sidereal day, 86164.09054 s (JPL Astrodynamic Parameters). */
export const EARTH_SPIN = (2 * Math.PI) / 86164.09054;
/** rad/s: the Moon's sidereal rotation, 655.72 h (NASA Moon fact sheet). */
export const MOON_SPIN = (2 * Math.PI) / (655.72 * 3600);

/** Parking orbit around Earth, km above the equatorial radius (Apollo 11 flew about 185 km). */
export const PARKING_ALT_KM = 185;
/** Circular lunar orbit before descent, km (the brief and Apollo). */
export const LUNAR_ORBIT_ALT_KM = 100;
/** The lowest descent start, km: periapsis of the descent orbit (the brief and Apollo). */
export const DESCENT_START_ALT_KM = 15;
/**
 * Gravity, drag and steering losses on the way to low Earth orbit, km/s: the middle of the
 * "typically 1.5–2 km/s" of the delta-v budget (issue #181; docs/sources/issue-181.md).
 */
export const ASCENT_LOSSES_KMS = 1.75;
/** The Moon's sphere of influence, km: a (m/M)^(2/5) with a = 384,400 km. Inside it the craft is drawn on its arrival hyperbola. */
export const MOON_SOI_KM = 66_100;

/** How long each phase takes before the burns, in seconds. */
export type MissionTimes = { ascentS: number; parkingS: number; coastS: number; lunarOrbitS: number };

/**
 * Apollo 11's, from NASA's timeline (SP-4029): liftoff 000:00:00, Earth orbit insertion
 * 000:11:39.41, S-IVB second burn ignition 002:44:16.2, translunar injection 002:50:13.03,
 * lunar orbit insertion ignition 075:49:50.37, descent orbit insertion ignition 101:36:14.
 */
export const APOLLO_11_TIMES: MissionTimes = {
  ascentS: 699.41,
  parkingS: 9156.79,
  coastS: 262777.34,
  lunarOrbitS: 92783.63,
};

/** The lander, from separation after TLI. It does LOI, DOI and the powered descent itself. */
export type Lander = { massKg: number; dryKg: number; ispS: number; thrustN: number };

/**
 * An example lander about the size of Intuitive Machines' Nova-C: 1,908 kg at launch, 675 kg dry,
 * 3,100 N main engine. Its specific impulse is not published; 320 s is an example value for a
 * methane and oxygen engine. Edit all four to match a real lander.
 */
export const EXAMPLE_LANDER: Lander = { massKg: 1908, dryKg: 675, ispS: 320, thrustN: 3100 };

// ---------------------------------------------------------------------------------------------
// Orbits
// ---------------------------------------------------------------------------------------------

export const circularSpeed = (mu: number, r: number): number => Math.sqrt(mu / r);
export const visViva = (mu: number, r: number, a: number): number => Math.sqrt(mu * (2 / r - 1 / a));
/** Half the period of an orbit with semi-major axis a, seconds. */
export const halfPeriod = (mu: number, a: number): number => Math.PI * Math.sqrt(a ** 3 / mu);

const clamp1 = (x: number): number => Math.max(-1, Math.min(1, x));

/** Eccentric anomaly for a mean anomaly M on an ellipse of eccentricity e (Newton's method). */
function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.sign(M) * Math.PI || Math.PI;
  for (let i = 0; i < 50; i++) {
    const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return E;
}

/** True anomaly from the eccentric anomaly, same sign. */
function trueAnomaly(E: number, e: number): number {
  return 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2));
}

/** Seconds from perigee to radius r on the outbound half of an ellipse (a, e). */
function timeToRadius(mu: number, a: number, e: number, r: number): number {
  const E = Math.acos(clamp1((1 - r / a) / e));
  return (E - e * Math.sin(E)) / Math.sqrt(mu / a ** 3);
}

/**
 * Seconds from periapsis to radius r on a hyperbola round a body of gravity mu, with periapsis
 * rp and speed at infinity vInf (km/s). Patched conics: the arrival at the Moon.
 */
export function hyperbolaTimeToRadius(mu: number, rp: number, vInf: number, r: number): number {
  const a = mu / vInf ** 2;            // |a|
  const e = 1 + rp / a;
  const H = Math.acosh(Math.max(1, (r / a + 1) / e));
  return (e * Math.sinh(H) - H) / Math.sqrt(mu / a ** 3);
}

/** Position on that hyperbola t seconds from periapsis (negative before it): radius, true anomaly, speed. */
export function hyperbolaAt(mu: number, rp: number, vInf: number, tS: number): { r: number; nu: number; speedKmS: number } {
  const a = mu / vInf ** 2;
  const e = 1 + rp / a;
  const M = Math.sqrt(mu / a ** 3) * tS;
  let H = Math.asinh(M / e);
  for (let i = 0; i < 50; i++) {
    const step = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
    H -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  const r = a * (e * Math.cosh(H) - 1);
  const nu = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
  return { r, nu, speedKmS: Math.sqrt(vInf ** 2 + (2 * mu) / r) };
}

export type Transfer = {
  a: number; e: number;
  apogeeKm: number;      // apogee distance from Earth's centre
  dvKmS: number;         // TLI, from the circular parking orbit
  vInfKmS: number;       // speed relative to the Moon on arrival
  arriveNu: number;      // true anomaly on arrival, radians
  coastS: number;
};

/** The quickest coast the model allows (apogee 100 times the Moon's distance), seconds. */
export function fastestCoastS(rPark: number, rMoon: number): number {
  const ra = 100 * rMoon;
  return timeToRadius(MU_EARTH, (rPark + ra) / 2, (ra - rPark) / (ra + rPark), rMoon);
}

/** The slowest: a Hohmann transfer, whose apogee is at the Moon's distance. Seconds. */
export function hohmannCoastS(rPark: number, rMoon: number): number {
  return halfPeriod(MU_EARTH, (rPark + rMoon) / 2);
}

/**
 * The transfer ellipse from a circular parking orbit of radius rPark (km) that reaches the
 * Moon's distance rMoon (km) coastS seconds after TLI. Null when no such ellipse is in range.
 * Patched conics: the Moon is taken to move on a circle in the transfer's plane.
 */
export function transferFor(rPark: number, rMoon: number, coastS: number): Transfer | null {
  if (!(rMoon > rPark && coastS > 0)) return null;
  const slowest = hohmannCoastS(rPark, rMoon);
  const fastest = fastestCoastS(rPark, rMoon);
  if (coastS > slowest * (1 + 1e-12) || coastS < fastest) return null;
  const tof = (ra: number): number =>
    timeToRadius(MU_EARTH, (rPark + ra) / 2, (ra - rPark) / (ra + rPark), rMoon);
  let lo = rMoon;            // longest coast
  let hi = 100 * rMoon;      // shortest
  for (let i = 0; i < 200 && hi - lo > 1e-9 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (tof(mid) > coastS) lo = mid;
    else hi = mid;
  }
  const ra = (lo + hi) / 2;
  const a = (rPark + ra) / 2;
  const e = (ra - rPark) / (ra + rPark);
  const p = a * (1 - e * e);
  const v = visViva(MU_EARTH, rMoon, a);
  const vt = Math.sqrt(MU_EARTH * p) / rMoon;
  const vr = Math.sqrt(Math.max(0, v * v - vt * vt));
  const vMoon = circularSpeed(MU_EARTH, rMoon);
  return {
    a, e, apogeeKm: ra,
    dvKmS: visViva(MU_EARTH, rPark, a) - circularSpeed(MU_EARTH, rPark),
    vInfKmS: Math.hypot(vr, vMoon - vt),
    arriveNu: Math.acos(clamp1((p / rMoon - 1) / e)),
    coastS,
  };
}

/**
 * The Earth-Moon distance (km) at tMs, from the Sun and Earth table, or null where the table has
 * no data there (a decade not loaded yet).
 */
export function earthMoonKmAt(eph: Pick<Ephemeris, 'vectorsAt'>, tMs: number): number | null {
  const [x, y, z] = eph.vectorsAt(tMs).earthKm;
  const d = Math.hypot(x, y, z);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Lunar orbit insertion: from v-infinity (km/s) into a circular orbit of radius r (km). */
export function captureDv(vInfKmS: number, r: number): number {
  return Math.sqrt(vInfKmS ** 2 + (2 * MU_MOON) / r) - circularSpeed(MU_MOON, r);
}

/** Descent orbit insertion: from a circular orbit of radius rOrbit to periapsis radius rPeri. */
export function descentOrbitDv(rOrbit: number, rPeri: number): number {
  return circularSpeed(MU_MOON, rOrbit) - visViva(MU_MOON, rOrbit, (rOrbit + rPeri) / 2);
}

// ---------------------------------------------------------------------------------------------
// Rocket equation
// ---------------------------------------------------------------------------------------------

/** Propellant (kg) a burn of dvKmS uses, starting at m0 kg. */
export function propellantFor(m0: number, dvKmS: number, ispS: number): number {
  return m0 * (1 - Math.exp(-dvKmS / (ispS * G0)));
}

/** Δv (km/s) from burning down from m0 to m1 kg. */
export function dvFor(m0: number, m1: number, ispS: number): number {
  return ispS * G0 * Math.log(m0 / m1);
}

/** Seconds at full thrust to burn propKg. */
export function burnSeconds(propKg: number, thrustN: number, ispS: number): number {
  return (propKg * ispS * G0 * 1000) / thrustN;
}

// ---------------------------------------------------------------------------------------------
// Powered descent
// ---------------------------------------------------------------------------------------------

export type DescentSample = {
  tS: number;        // since ignition
  altKm: number;
  angle: number;     // radians travelled round the Moon's centre since ignition
  speedKmS: number;
  massKg: number;
};

export type Descent = {
  end: 'ground' | 'stopped';   // reached the ground still moving, or stopped above it
  durationS: number;
  dvKmS: number;
  propellantKg: number;
  angle: number;               // radians from ignition to the end
  rangeKm: number;             // ground distance from ignition to the end
  endAltKm: number;
  endSpeedKmS: number;
  samples: DescentSample[];    // every second, and the end (only when asked for)
};

const DT = 0.25;               // integration step, s
const MAX_DESCENT_S = 3 * 3600;

/**
 * A gravity turn from the periapsis of a LUNAR_ORBIT_ALT_KM × startAltKm orbit: thrust (the
 * lander's, times throttle) always against the velocity, integrated with fourth-order
 * Runge-Kutta in the orbit's plane, until the lander reaches the ground or stops above it.
 */
export function simulateDescent(
  startAltKm: number, m0Kg: number, thrustN: number, ispS: number, throttle: number, keepSamples = false,
): Descent {
  const rp = R_MOON + startAltKm;
  const a = (R_MOON + LUNAR_ORBIT_ALT_KM + rp) / 2;
  const force = (thrustN * throttle) / 1000;   // kg km/s²
  const mdot = force / (ispS * G0);            // kg/s
  // State: radius, angle travelled, radial and along-track speed, mass. Plain numbers, not
  // arrays: planDescent runs this some 70 times a plan.
  let r = rp;
  let ang = 0;
  let vr = 0;
  let vt = visViva(MU_MOON, rp, a);
  let m = m0Kg;
  let ar = 0;
  let at = 0;
  const accel = (r1: number, vr1: number, vt1: number, m1: number): void => {
    const v = Math.sqrt(vr1 * vr1 + vt1 * vt1);
    const k = v > 0 && m1 > 0 ? force / m1 / v : 0;
    ar = -MU_MOON / (r1 * r1) + (vt1 * vt1) / r1 - k * vr1;
    at = (-vr1 * vt1) / r1 - k * vt1;
  };
  const samples: DescentSample[] = [];
  const sample = (tS: number): void => {
    samples.push({ tS, altKm: r - R_MOON, angle: ang, speedKmS: Math.hypot(vr, vt), massKg: m });
  };
  if (keepSamples) sample(0);

  const h = DT / 2;
  let t = 0;
  let end: 'ground' | 'stopped' = 'ground';
  let nextSample = 1;
  // At the start the lander is faster than a circular orbit there and rises a little; once it is
  // falling, an end to the fall means the engine has stopped it above the ground.
  let falling = false;
  while (t < MAX_DESCENT_S) {
    // Fourth-order Runge-Kutta.
    accel(r, vr, vt, m);
    const k1r = vr, k1a = vt / r, k1u = ar, k1w = at;
    const r2 = r + k1r * h, vr2 = vr + k1u * h, vt2 = vt + k1w * h, mHalf = m - mdot * h;
    accel(r2, vr2, vt2, mHalf);
    const k2r = vr2, k2a = vt2 / r2, k2u = ar, k2w = at;
    const r3 = r + k2r * h, vr3 = vr + k2u * h, vt3 = vt + k2w * h;
    accel(r3, vr3, vt3, mHalf);
    const k3r = vr3, k3a = vt3 / r3, k3u = ar, k3w = at;
    const r4 = r + k3r * DT, vr4 = vr + k3u * DT, vt4 = vt + k3w * DT;
    accel(r4, vr4, vt4, m - mdot * DT);
    const k4r = vr4, k4a = vt4 / r4, k4u = ar, k4w = at;
    const nr = r + (DT / 6) * (k1r + 2 * k2r + 2 * k3r + k4r);
    const na = ang + (DT / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    const nvr = vr + (DT / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    const nvt = vt + (DT / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    const nm = m - mdot * DT;

    if (nr <= R_MOON || nm <= 0) {
      // Reached the ground during this step: stop at the crossing.
      const f = nr < r ? (r - R_MOON) / (r - nr) : 1;
      ang += (na - ang) * f;
      vr += (nvr - vr) * f;
      vt += (nvt - vt) * f;
      m += (nm - m) * f;
      r = R_MOON;
      t += DT * f;
      end = 'ground';
      break;
    }
    r = nr; ang = na; vr = nvr; vt = nvt; m = nm;
    t += DT;
    // Stopped above the ground: horizontal speed gone, the fall halted (even while still drifting
    // sideways), or under 1 m/s. Near zero speed "against the velocity" flips every step and the
    // integration would fake a hover, so the lander counts as stopped there.
    if (vr < -1e-3) falling = true;
    if (vt <= 0 || (falling && vr >= 0) || Math.hypot(vr, vt) < 1e-3) {
      end = 'stopped';
      break;
    }
    if (keepSamples && t >= nextSample) {
      sample(t);
      nextSample += 1;
    }
  }
  if (keepSamples && samples[samples.length - 1].tS !== t) sample(t);
  return {
    end,
    durationS: t,
    dvKmS: dvFor(m0Kg, m, ispS),
    propellantKg: m0Kg - m,
    angle: ang,
    rangeKm: ang * R_MOON,
    endAltKm: Math.max(0, r - R_MOON),
    endSpeedKmS: Math.hypot(vr, vt),
    samples,
  };
}

/** Where braking hands over to the approach: the "high gate" altitude, km (issue #181). */
export const HIGH_GATE_KM = 2;
/** Braking ends when the along-track speed is down to this, km/s. */
const BRAKING_END_KMS = 0.05;
/** How fast the altitude loop follows its profile in braking, rad/s (a time constant of 33 s). */
const ALT_LOOP = 0.03;
/** The landing phase's descent rate: altitude over this many seconds, between 1 and 30 m/s. */
const LANDING_RATE_S = 40;
/** The landing phase's speed loops' time constant, s. */
const LANDING_TAU_S = 4;
/** A touchdown under this is a landing, km/s. */
export const LANDED_KMS = 0.003;

/**
 * A guided powered descent from the periapsis of a LUNAR_ORBIT_ALT_KM × startAltKm orbit, in the
 * phases Apollo flew (Bennett 1970, NASA TM X-58040; issue #181):
 *
 * - Braking, at full thrust: mostly against the motion, the rest up or down so the altitude
 *   follows a profile that falls with the along-track speed, from startAltKm to HIGH_GATE_KM.
 * - Approach and landing, throttled: the last along-track speed taken out, then straight down at
 *   the altitude over LANDING_RATE_S, from 30 m/s to 1 m/s at the ground.
 *
 * The thrust is worked out at the start of each step and held through it (fourth-order
 * Runge-Kutta in the orbit's plane, as simulateDescent). Ends at the ground; a lander whose
 * engine can't hold it up comes down fast, which planDescent rejects.
 */
export function simulateGuidedDescent(
  startAltKm: number, m0Kg: number, thrustN: number, ispS: number, keepSamples = false,
): Descent & { brakingS: number } {
  const rp = R_MOON + startAltKm;
  const a = (R_MOON + LUNAR_ORBIT_ALT_KM + rp) / 2;
  const fMax = thrustN / 1000;                 // kg km/s²
  const exhaust = ispS * G0;                   // km/s
  let r = rp;
  let ang = 0;
  let vr = 0;
  let vt = visViva(MU_MOON, rp, a);
  let m = m0Kg;
  const vt0 = vt;
  const span = startAltKm - HIGH_GATE_KM;
  let braking = true;
  let brakingS = 0;
  // The thrust force held through a step, radial and along-track, and the mass flow.
  let fr = 0;
  let ft = 0;
  let mdot = 0;
  const steer = (): void => {
    const hNow = r - R_MOON;
    const aMax = fMax / m;
    const gNet = MU_MOON / (r * r) - (vt * vt) / r;   // upward thrust that holds the height
    let ar: number;
    let at: number;
    if (braking && vt > BRAKING_END_KMS && hNow > HIGH_GATE_KM / 4) {
      const s = Math.max(0, vt / vt0);
      const hRef = HIGH_GATE_KM + span * s * s;
      const vrRef = ((2 * span * s) / vt0) * -aMax;   // the profile's rate at full braking
      ar = gNet + ALT_LOOP * ALT_LOOP * (hRef - hNow) + 2 * ALT_LOOP * (vrRef - vr);
      ar = Math.max(-aMax, Math.min(aMax, ar));
      at = -Math.sqrt(Math.max(0, aMax * aMax - ar * ar));
    } else {
      braking = false;
      const vzCmd = -Math.max(0.001, Math.min(0.03, hNow / LANDING_RATE_S));
      at = -vt / LANDING_TAU_S;
      ar = gNet + (vzCmd - vr) / LANDING_TAU_S;
      const mag = Math.hypot(ar, at);
      if (mag > aMax) { ar *= aMax / mag; at *= aMax / mag; }
      if (ar < 0) ar = 0;
    }
    fr = ar * m;
    ft = at * m;
    mdot = Math.hypot(fr, ft) / exhaust;
  };
  let dr = 0, da = 0, du = 0, dw = 0;
  const deriv = (r1: number, vr1: number, vt1: number, m1: number): void => {
    dr = vr1;
    da = vt1 / r1;
    du = -MU_MOON / (r1 * r1) + (vt1 * vt1) / r1 + fr / m1;
    dw = (-vr1 * vt1) / r1 + ft / m1;
  };
  const samples: DescentSample[] = [];
  const sample = (tS: number): void => {
    samples.push({ tS, altKm: r - R_MOON, angle: ang, speedKmS: Math.hypot(vr, vt), massKg: m });
  };
  if (keepSamples) sample(0);
  const h = DT / 2;
  let t = 0;
  let nextSample = 1;
  while (t < MAX_DESCENT_S) {
    steer();
    if (braking) brakingS = t;
    deriv(r, vr, vt, m);
    const k1r = dr, k1a = da, k1u = du, k1w = dw;
    deriv(r + k1r * h, vr + k1u * h, vt + k1w * h, m - mdot * h);
    const k2r = dr, k2a = da, k2u = du, k2w = dw;
    deriv(r + k2r * h, vr + k2u * h, vt + k2w * h, m - mdot * h);
    const k3r = dr, k3a = da, k3u = du, k3w = dw;
    deriv(r + k3r * DT, vr + k3u * DT, vt + k3w * DT, m - mdot * DT);
    const k4r = dr, k4a = da, k4u = du, k4w = dw;
    const nr = r + (DT / 6) * (k1r + 2 * k2r + 2 * k3r + k4r);
    const na = ang + (DT / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    const nvr = vr + (DT / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    const nvt = vt + (DT / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    const nm = m - mdot * DT;
    if (nr <= R_MOON || nm <= 0) {
      const f = nr < r ? (r - R_MOON) / (r - nr) : 1;
      ang += (na - ang) * f;
      vr += (nvr - vr) * f;
      vt += (nvt - vt) * f;
      m += (nm - m) * f;
      r = R_MOON;
      t += DT * f;
      break;
    }
    r = nr; ang = na; vr = nvr; vt = nvt; m = nm;
    t += DT;
    if (keepSamples && t >= nextSample) {
      sample(t);
      nextSample += 1;
    }
  }
  if (keepSamples && samples[samples.length - 1].tS !== t) sample(t);
  return {
    end: 'ground',
    durationS: t,
    dvKmS: dvFor(m0Kg, m, ispS),
    propellantKg: m0Kg - m,
    angle: ang,
    rangeKm: ang * R_MOON,
    endAltKm: Math.max(0, r - R_MOON),
    endSpeedKmS: Math.hypot(vr, vt),
    samples,
    brakingS,
  };
}

export type DescentPlan = {
  startAltKm: number;
  throttle: number;        // 0..1 of the lander's thrust through braking (full)
  doiDvKmS: number;
  massAtIgnitionKg: number;
  descent: Descent;
};

/**
 * The gravity turn that ends at rest on the ground, for a lander of massAfterLoiKg in the
 * 100 km orbit. From 15 km when the engine is strong enough, throttled down to the one thrust
 * that lands exactly. A weaker engine starts higher, at full thrust, the descent orbit's
 * periapsis raised until the lander stops at the ground. Null when even a start just under
 * 100 km doesn't stop in time.
 */
export function planDescent(massAfterLoiKg: number, lander: Lander): DescentPlan | null {
  const rOrbit = R_MOON + LUNAR_ORBIT_ALT_KM;
  const h = DESCENT_START_ALT_KM;
  const doiDv = descentOrbitDv(rOrbit, R_MOON + h);
  const mass = massAfterLoiKg - propellantFor(massAfterLoiKg, doiDv, lander.ispS);
  // Guided from 15 km, as Apollo flew (issue #181). An engine that can't hold the lander up near
  // the ground comes down fast: no landing.
  // An engine that cannot lift the lander in the Moon's gravity at ignition cannot hover or land.
  if (lander.thrustN / 1000 <= mass * (MU_MOON / (R_MOON * R_MOON))) return null;
  const descent = simulateGuidedDescent(h, mass, lander.thrustN, lander.ispS, true);
  if (descent.endAltKm > 0 || descent.endSpeedKmS >= LANDED_KMS) return null;
  return { startAltKm: h, throttle: 1, doiDvKmS: doiDv, massAtIgnitionKg: mass, descent };
}

// ---------------------------------------------------------------------------------------------
// The mission
// ---------------------------------------------------------------------------------------------

export type StepId =
  | 'launch' | 'parking' | 'tli' | 'coast' | 'loi' | 'lunar-orbit' | 'doi' | 'descent-orbit'
  | 'powered-descent' | 'touchdown';

/** One phase or burn. A burn treated as instant has startMs === endMs. */
export type Step = {
  id: StepId;
  startMs: number;
  endMs: number;
  by: 'launch vehicle' | 'lander' | null;     // who burns; null for a coast
  dvKmS: number | null;
  burnS: number | null;                        // null when the burn isn't modelled
  propellantKg: number | null;                 // the lander's only
  massAfterKg: number | null;                  // the lander's only
  altKm: number | null;                        // the orbit's or path's altitude at the end
};

/** The five steps of the brief's flight sequence. */
export const SEQUENCE: readonly StepId[] = ['launch', 'tli', 'loi', 'powered-descent', 'touchdown'];

export type MissionInput = {
  site: Site;                  // where to land
  touchdownMs: number;         // when
  pad: Pad;
  lander: Lander;
  earthMoonKm: number;         // Earth-Moon distance on arrival (from the Sun and Earth table)
  times?: MissionTimes;        // Apollo 11's when left out
};

export type MissionError = 'bad-input' | 'coast-out-of-range' | 'thrust-too-low';

type Geometry = {
  rPark: number; nPark: number;
  transfer: Transfer; nTransfer: number;
  earthMoonKm: number; nMoon: number;
  rOrbit: number; nOrbit: number;
  thetaDoi: number; thetaPdi: number;
  descentA: number; descentE: number; nDescent: number;
  descent: Descent;
  site: [number, number, number];       // unit vector to the site, Moon-fixed, at touchdown
  travel: [number, number, number];     // unit vector of travel at the site (south along it)
  massAfterLoi: number; massAfterDoi: number; dryKg: number;
};

export type MissionPlan =
  | { ok: false; error: MissionError }
  | {
    ok: true;
    launchMs: number;
    touchdownMs: number;
    steps: Step[];
    totals: {
      launchVehicleDvKmS: number; landerDvKmS: number;
      propellantLoadedKg: number; propellantUsedKg: number; propellantLeftKg: number;
      margin: number;                    // left / loaded; negative when it runs out
    };
    orbit: {
      parkingAltKm: number; parkingIncDeg: number;
      transferApogeeKm: number; vInfKmS: number; earthMoonKm: number; coastS: number;
      lunarOrbitAltKm: number; lunarOrbitIncDeg: number; lunarOrbitPeriodS: number;
      descentStartAltKm: number; throttle: number; descentRangeKm: number;
      touchdownSpeedKmS: number;
    };
    runsOutMs: number | null;            // when the lander's propellant runs out, if it does
    geometry: Geometry;
  };

export type OkPlan = Extract<MissionPlan, { ok: true }>;

const deg = (rad: number): number => (rad * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;

function validInput(input: MissionInput, times: MissionTimes): boolean {
  const { lander, site } = input;
  const finite = [lander.massKg, lander.dryKg, lander.ispS, lander.thrustN, input.touchdownMs,
    input.earthMoonKm, site.lat, site.lon, times.ascentS, times.parkingS, times.coastS, times.lunarOrbitS];
  return finite.every(Number.isFinite)
    && lander.dryKg > 0 && lander.massKg > lander.dryKg && lander.ispS > 0 && lander.thrustN > 0
    && times.ascentS > 0 && times.parkingS >= 0 && times.lunarOrbitS >= 0
    && site.lat >= -90 && site.lat <= 90
    && input.earthMoonKm > R_EARTH + PARKING_ALT_KM;
}

export function planMission(input: MissionInput): MissionPlan {
  const times = input.times ?? APOLLO_11_TIMES;
  if (!validInput(input, times)) return { ok: false, error: 'bad-input' };
  const { lander, pad, site } = input;

  // Earth side.
  const rPark = R_EARTH + PARKING_ALT_KM;
  const transfer = transferFor(rPark, input.earthMoonKm, times.coastS);
  if (!transfer) return { ok: false, error: 'coast-out-of-range' };
  // Ascent, launched due east: orbital speed less what Earth's turning gives at the pad, plus the
  // cited gravity and drag losses (issue #181).
  const ascentDv = circularSpeed(MU_EARTH, rPark) - EARTH_SPIN * R_EARTH * Math.cos(rad(pad.lat)) + ASCENT_LOSSES_KMS;

  // Moon side.
  const rOrbit = R_MOON + LUNAR_ORBIT_ALT_KM;
  const loiDv = captureDv(transfer.vInfKmS, rOrbit);
  const loiProp = propellantFor(lander.massKg, loiDv, lander.ispS);
  const massAfterLoi = lander.massKg - loiProp;
  const dp = planDescent(massAfterLoi, lander);
  if (!dp) return { ok: false, error: 'thrust-too-low' };
  const doiProp = massAfterLoi - dp.massAtIgnitionKg;
  const massAfterDoi = dp.massAtIgnitionKg;
  const d = dp.descent;
  const massAtTouchdown = massAfterDoi - d.propellantKg;

  const descentA = (rOrbit + R_MOON + dp.startAltKm) / 2;
  const descentE = (rOrbit - (R_MOON + dp.startAltKm)) / (rOrbit + R_MOON + dp.startAltKm);

  // Times, back from touchdown.
  const td = input.touchdownMs;
  const pdi = td - d.durationS * 1000;
  const doi = pdi - halfPeriod(MU_MOON, descentA) * 1000;
  const loi = doi - times.lunarOrbitS * 1000;
  const tli = loi - times.coastS * 1000;
  const poi = tli - times.parkingS * 1000;
  const launch = poi - times.ascentS * 1000;

  const loiBurn = burnSeconds(loiProp, lander.thrustN, lander.ispS);
  const doiBurn = burnSeconds(doiProp, lander.thrustN, lander.ispS);
  const steps: Step[] = [
    { id: 'launch', startMs: launch, endMs: poi, by: 'launch vehicle', dvKmS: ascentDv, burnS: times.ascentS, propellantKg: null, massAfterKg: null, altKm: PARKING_ALT_KM },
    { id: 'parking', startMs: poi, endMs: tli, by: null, dvKmS: null, burnS: null, propellantKg: null, massAfterKg: null, altKm: PARKING_ALT_KM },
    { id: 'tli', startMs: tli, endMs: tli, by: 'launch vehicle', dvKmS: transfer.dvKmS, burnS: null, propellantKg: null, massAfterKg: lander.massKg, altKm: PARKING_ALT_KM },
    { id: 'coast', startMs: tli, endMs: loi, by: null, dvKmS: null, burnS: null, propellantKg: null, massAfterKg: null, altKm: LUNAR_ORBIT_ALT_KM },
    { id: 'loi', startMs: loi, endMs: loi, by: 'lander', dvKmS: loiDv, burnS: loiBurn, propellantKg: loiProp, massAfterKg: massAfterLoi, altKm: LUNAR_ORBIT_ALT_KM },
    { id: 'lunar-orbit', startMs: loi, endMs: doi, by: null, dvKmS: null, burnS: null, propellantKg: null, massAfterKg: null, altKm: LUNAR_ORBIT_ALT_KM },
    { id: 'doi', startMs: doi, endMs: doi, by: 'lander', dvKmS: dp.doiDvKmS, burnS: doiBurn, propellantKg: doiProp, massAfterKg: massAfterDoi, altKm: LUNAR_ORBIT_ALT_KM },
    { id: 'descent-orbit', startMs: doi, endMs: pdi, by: null, dvKmS: null, burnS: null, propellantKg: null, massAfterKg: null, altKm: dp.startAltKm },
    { id: 'powered-descent', startMs: pdi, endMs: td, by: 'lander', dvKmS: d.dvKmS, burnS: d.durationS, propellantKg: d.propellantKg, massAfterKg: massAtTouchdown, altKm: 0 },
    { id: 'touchdown', startMs: td, endMs: td, by: null, dvKmS: null, burnS: null, propellantKg: null, massAfterKg: massAtTouchdown, altKm: 0 },
  ];

  // When the propellant runs out, if it does.
  let runsOutMs: number | null = null;
  if (massAfterLoi < lander.dryKg) runsOutMs = loi;
  else if (massAfterDoi < lander.dryKg) runsOutMs = doi;
  else if (massAtTouchdown < lander.dryKg) {
    const s = d.samples.find((x) => x.massKg < lander.dryKg);
    runsOutMs = pdi + (s ? s.tS : d.durationS) * 1000;
  }

  // The orbit plane through the site, heading south over it (a polar orbit).
  const lat = rad(site.lat);
  const lon = rad(site.lon);
  const siteVec: [number, number, number] = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const travel: [number, number, number] = [Math.sin(lat) * Math.cos(lon), Math.sin(lat) * Math.sin(lon), -Math.cos(lat)];

  const loaded = lander.massKg - lander.dryKg;
  const left = massAtTouchdown - lander.dryKg;
  return {
    ok: true,
    launchMs: launch,
    touchdownMs: td,
    steps,
    totals: {
      launchVehicleDvKmS: ascentDv + transfer.dvKmS,
      landerDvKmS: loiDv + dp.doiDvKmS + d.dvKmS,
      propellantLoadedKg: loaded,
      propellantUsedKg: lander.massKg - massAtTouchdown,
      propellantLeftKg: left,
      margin: left / loaded,
    },
    orbit: {
      parkingAltKm: PARKING_ALT_KM,
      parkingIncDeg: Math.abs(pad.lat),
      transferApogeeKm: transfer.apogeeKm,
      vInfKmS: transfer.vInfKmS,
      earthMoonKm: input.earthMoonKm,
      coastS: times.coastS,
      lunarOrbitAltKm: LUNAR_ORBIT_ALT_KM,
      lunarOrbitIncDeg: 90,
      lunarOrbitPeriodS: 2 * halfPeriod(MU_MOON, rOrbit),
      descentStartAltKm: dp.startAltKm,
      throttle: dp.throttle,
      descentRangeKm: d.rangeKm,
      touchdownSpeedKmS: d.endSpeedKmS,
    },
    runsOutMs,
    geometry: {
      rPark, nPark: Math.sqrt(MU_EARTH / rPark ** 3),
      transfer, nTransfer: Math.sqrt(MU_EARTH / transfer.a ** 3),
      earthMoonKm: input.earthMoonKm, nMoon: Math.sqrt(MU_EARTH / input.earthMoonKm ** 3),
      rOrbit, nOrbit: Math.sqrt(MU_MOON / rOrbit ** 3),
      thetaPdi: -d.angle, thetaDoi: -d.angle - Math.PI,
      descentA, descentE, nDescent: Math.sqrt(MU_MOON / descentA ** 3),
      descent: d,
      site: siteVec, travel,
      massAfterLoi, massAfterDoi, dryKg: lander.dryKg,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Where the craft is at a moment: what the animation draws
// ---------------------------------------------------------------------------------------------

export type MissionState = {
  stepIndex: number;                       // into plan.steps
  tMs: number;                             // clamped to launch..touchdown
  elapsedS: number;                        // since launch
  near: 'earth' | 'moon';
  altKm: number;                           // above Earth or the Moon
  speedKmS: number;                        // relative to that body
  propellantLeftKg: number;                // the lander's
  earthPlane: { craft: [number, number]; moon: [number, number] };   // km, Earth at the origin
  moonPlane: [number, number] | null;      // km, Moon at the origin, the site at (0, R_MOON); from SOI entry on
  approach: boolean;                       // on the arrival hyperbola, inside the Moon's sphere of influence
  ground: { lat: number; lon: number } | null;   // the point under the craft, Moon-fixed
  rangeToGoKm: number | null;              // during and after the powered descent
};

function interpolateDescent(samples: DescentSample[], tS: number): DescentSample {
  if (tS <= samples[0].tS) return samples[0];
  const last = samples[samples.length - 1];
  if (tS >= last.tS) return last;
  let i = Math.min(samples.length - 2, Math.floor(tS));   // one sample a second
  while (i > 0 && samples[i].tS > tS) i--;
  while (i < samples.length - 2 && samples[i + 1].tS < tS) i++;
  const a = samples[i];
  const b = samples[i + 1];
  const f = (tS - a.tS) / (b.tS - a.tS);
  return {
    tS,
    altKm: a.altKm + (b.altKm - a.altKm) * f,
    angle: a.angle + (b.angle - a.angle) * f,
    speedKmS: a.speedKmS + (b.speedKmS - a.speedKmS) * f,
    massKg: a.massKg + (b.massKg - a.massKg) * f,
  };
}

/** The step a moment falls in. An instant burn wins over the coasts either side of it. */
function stepAt(plan: OkPlan, t: number): number {
  for (let i = plan.steps.length - 1; i >= 0; i--) {
    const s = plan.steps[i];
    if (s.startMs === s.endMs ? t === s.startMs : t >= s.startMs && t < s.endMs) return i;
  }
  return t >= plan.touchdownMs ? plan.steps.length - 1 : 0;
}

/** Where the craft is, how high and fast, and how much propellant it has, at tMs. */
export function missionAt(plan: OkPlan, tMs: number): MissionState {
  const g = plan.geometry;
  const t = Math.min(Math.max(tMs, plan.launchMs), plan.touchdownMs);
  const at = (id: StepId): Step => plan.steps.find((s) => s.id === id) as Step;
  const poi = at('parking').startMs;
  const tli = at('tli').startMs;
  const loi = at('loi').startMs;
  const doi = at('doi').startMs;
  const pdi = at('powered-descent').startMs;
  const loaded = plan.totals.propellantLoadedKg;
  const dry = g.dryKg;

  // The Moon on its circle, meeting the craft at arrival.
  const arriveAngle = Math.PI + g.transfer.arriveNu;
  const moonAngle = arriveAngle - g.nMoon * ((loi - t) / 1000);
  const moon: [number, number] = [g.earthMoonKm * Math.cos(moonAngle), g.earthMoonKm * Math.sin(moonAngle)];

  const state: MissionState = {
    stepIndex: stepAt(plan, t),
    tMs: t,
    elapsedS: (t - plan.launchMs) / 1000,
    near: 'earth',
    altKm: 0,
    speedKmS: 0,
    propellantLeftKg: loaded,
    earthPlane: { craft: [0, 0], moon },
    moonPlane: null,
    approach: false,
    ground: null,
    rangeToGoKm: null,
  };

  if (t < loi) {
    let r: number;
    let angle: number;
    if (t < tli) {
      // Ascent and parking orbit: round Earth, reaching the TLI point (angle pi) on time.
      angle = Math.PI - g.nPark * ((tli - t) / 1000);
      if (t < poi) {
        const f = (t - plan.launchMs) / (poi - plan.launchMs);
        r = R_EARTH + (g.rPark - R_EARTH) * f;
        state.speedKmS = EARTH_SPIN * R_EARTH + (circularSpeed(MU_EARTH, g.rPark) - EARTH_SPIN * R_EARTH) * f;
      } else {
        r = g.rPark;
        state.speedKmS = circularSpeed(MU_EARTH, g.rPark);
      }
    } else {
      // Translunar coast: Kepler's equation from perigee.
      const { a, e } = g.transfer;
      const E = eccentricAnomaly(g.nTransfer * ((t - tli) / 1000), e);
      r = a * (1 - e * Math.cos(E));
      angle = Math.PI + trueAnomaly(E, e);
      state.speedKmS = visViva(MU_EARTH, r, a);
    }
    state.altKm = r - R_EARTH;
    state.earthPlane.craft = [r * Math.cos(angle), r * Math.sin(angle)];
    // Inside the Moon's sphere of influence: the arrival hyperbola round the Moon, in the lunar
    // orbit's plane, its periapsis the LOI point. Altitude and speed are the Moon's from here.
    const fromLoiS = (t - loi) / 1000;
    if (t >= tli && -fromLoiS <= approachSeconds(plan)) {
      const h = hyperbolaAt(MU_MOON, g.rOrbit, plan.orbit.vInfKmS, fromLoiS);
      const phi = g.thetaDoi - g.nOrbit * ((doi - loi) / 1000) + h.nu;
      state.near = 'moon';
      state.approach = true;
      state.altKm = h.r - R_MOON;
      state.speedKmS = h.speedKmS;
      state.moonPlane = [h.r * Math.cos(phi + Math.PI / 2), h.r * Math.sin(phi + Math.PI / 2)];
    }
    return state;
  }

  // At the Moon.
  state.near = 'moon';
  state.earthPlane.craft = moon;
  let theta: number;
  let r: number;
  if (t < doi) {
    theta = g.thetaDoi - g.nOrbit * ((doi - t) / 1000);
    r = g.rOrbit;
    state.speedKmS = circularSpeed(MU_MOON, r);
    state.propellantLeftKg = g.massAfterLoi - dry;
  } else if (t < pdi) {
    const E = eccentricAnomaly(g.nDescent * ((t - pdi) / 1000), g.descentE);
    r = g.descentA * (1 - g.descentE * Math.cos(E));
    theta = g.thetaPdi + trueAnomaly(E, g.descentE);
    state.speedKmS = visViva(MU_MOON, r, g.descentA);
    state.propellantLeftKg = g.massAfterDoi - dry;
  } else {
    const s = interpolateDescent(g.descent.samples, (t - pdi) / 1000);
    theta = g.thetaPdi + s.angle;
    r = R_MOON + s.altKm;
    state.speedKmS = t >= plan.touchdownMs ? 0 : s.speedKmS;
    state.propellantLeftKg = s.massKg - dry;
    state.rangeToGoKm = Math.max(0, -theta * R_MOON);
  }
  if (t >= plan.touchdownMs) {
    theta = 0;
    r = R_MOON;
  }
  state.altKm = r - R_MOON;
  state.moonPlane = [r * Math.cos(theta + Math.PI / 2), r * Math.sin(theta + Math.PI / 2)];

  // The point under the craft: in the orbit's plane, then turned back by the Moon's rotation.
  const u = [0, 1, 2].map((i) => Math.cos(theta) * g.site[i] + Math.sin(theta) * g.travel[i]);
  const spin = -MOON_SPIN * ((t - plan.touchdownMs) / 1000);
  const x = u[0] * Math.cos(spin) - u[1] * Math.sin(spin);
  const y = u[0] * Math.sin(spin) + u[1] * Math.cos(spin);
  state.ground = { lat: deg(Math.asin(clamp1(u[2]))), lon: deg(Math.atan2(y, x)) };
  return state;
}

/**
 * Where a Moon-fixed point (latitude and longitude in degrees, height in km) is at tMs, in the
 * lunar-orbit frame that missionAt's moonPlane uses: [x, y] as moonPlane (km, the Moon at the
 * origin, the site at (0, R_MOON) at touchdown), z along the orbit's normal (site × travel).
 * The inverse of missionAt's ground point. The animation places the landing site, and turns
 * the Moon's grid, with this.
 */
export function moonFixedInPlane(plan: OkPlan, tMs: number, latDeg: number, lonDeg: number, altKm = 0): [number, number, number] {
  const { site, travel } = plan.geometry;
  const r = R_MOON + altKm;
  const la = rad(latDeg);
  const lo = rad(lonDeg);
  const fx = Math.cos(la) * Math.cos(lo);
  const fy = Math.cos(la) * Math.sin(lo);
  const fz = Math.sin(la);
  // Undo the Moon's turn since touchdown (missionAt turns the other way to find the ground point).
  const spin = -MOON_SPIN * ((tMs - plan.touchdownMs) / 1000);
  const u = [fx * Math.cos(spin) + fy * Math.sin(spin), -fx * Math.sin(spin) + fy * Math.cos(spin), fz];
  const normal = [
    site[1] * travel[2] - site[2] * travel[1],
    site[2] * travel[0] - site[0] * travel[2],
    site[0] * travel[1] - site[1] * travel[0],
  ];
  const dot = (a: number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [-r * dot(u, travel), r * dot(u, site), r * dot(u, normal)];
}

/** Seconds the arrival hyperbola takes from the Moon's sphere of influence to the LOI burn. */
export function approachSeconds(plan: OkPlan): number {
  return hyperbolaTimeToRadius(MU_MOON, plan.geometry.rOrbit, plan.orbit.vInfKmS, MOON_SOI_KM);
}
