// The departure from Earth in 3D (issue #192): the launch, the parking orbit, TLI and the coast.
//
// missionAt draws the Earth side flat, in the Moon's orbit plane. Really the craft lifts off from
// the pad, which Earth carries round its tilted axis, into a parking orbit whose plane holds the
// pad at liftoff; TLI stays in that plane, and the coast is the one two-body orbit from the TLI
// point to where the craft enters the Moon's sphere of influence (lambert.ts).
//
// With the Sun and Earth table, withLaunchWindow sets the launch time so these meet. The plane
// must hold the pad at liftoff and the entry point, and the craft, going round it from the pad,
// must reach TLI on time at the point from which the coast sweeps as far round as missionAt's
// coast does. One unknown, the launch time: it is searched from half a lap to PARKING_MAX_LAPS
// laps of parking before TLI, and of the moments that work the one with the least inclined
// orbit is taken. The inclination is the plane's, not the pad's latitude: a launch due east only
// when the pad happens to sit at the plane's northernmost or southernmost point.
//
// Frame: missionAt's earthPlane in 3D: x and y in the Moon's orbit plane, z its pole, km, Earth
// at the origin. Earth's orientation: sky.ts earthFromIcrf (precession and sidereal time).
import type { Vec3 } from './ephemeris';
import { lambert, propagate, type V3 } from './lambert';
import {
  approachSeconds, ascentDvFor, lunarFrameInEarthPlane, missionAt, MU_EARTH, R_EARTH, type OkPlan,
} from './mission';
import { alignFrames, apply, applyInverse, earthFromIcrf, type Mat3 } from './sky';

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (k: number, a: V3): V3 => [k * a[0], k * a[1], k * a[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: V3): V3 => scale(1 / Math.hypot(a[0], a[1], a[2]), a);
/** a turned by angle (radians) about the unit axis n, a at right angles to n. */
const turn = (a: V3, n: V3, angle: number): V3 => add(scale(Math.cos(angle), a), scale(Math.sin(angle), cross(n, a)));
const TAU = 2 * Math.PI;
const mod = (x: number, m: number): number => ((x % m) + m) % m;
const deg = (r: number): number => (r * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;

/** The parking orbit's longest stay before TLI, in laps; the shortest is half a lap. */
export const PARKING_MAX_LAPS = 3.5;

// ---------------------------------------------------------------------------------------------
// Earth in the plan's frame
// ---------------------------------------------------------------------------------------------

/**
 * The turn from the ICRF into a plan's Earth-Moon frame: the Moon's real direction at touchdown
 * onto missionAt's, the Moon's real orbit pole onto z. sky: sky.ts moonOrbitIcrf at touchdown.
 * The 3D view's star field is turned the same way.
 */
export function icrfToPlaneFor(plan: OkPlan, sky: { toMoon: Vec3; pole: Vec3 }): Mat3 {
  const [mx, my] = missionAt(plan, plan.touchdownMs).earthPlane.moon;
  return alignFrames(sky.toMoon, sky.pole, [mx, my, 0], [0, 0, 1]);
}

/** Earth's axes at tMs in the plan's frame: towards longitude 0, towards 90° E, and the north pole. */
export function earthAxesAt(icrfToPlane: Mat3, tMs: number): [V3, V3, V3] {
  const e = earthFromIcrf(tMs);
  const axis = (u: V3): V3 => apply(icrfToPlane, applyInverse(e, u)) as V3;
  return [axis([1, 0, 0]), axis([0, 1, 0]), axis([0, 0, 1])];
}

/** The unit vector to a place on Earth (degrees, a sphere) at tMs, in the plan's frame. */
export function onEarthAt(icrfToPlane: Mat3, latDeg: number, lonDeg: number, tMs: number): V3 {
  const [x, y, z] = earthAxesAt(icrfToPlane, tMs);
  const c = Math.cos(rad(latDeg));
  return add(add(scale(c * Math.cos(rad(lonDeg)), x), scale(c * Math.sin(rad(lonDeg)), y)), scale(Math.sin(rad(latDeg)), z));
}

/** The latitude and longitude on Earth (a sphere) under a point given in the plan's frame, at tMs. */
export function groundUnder(icrfToPlane: Mat3, p: V3, tMs: number): { lat: number; lon: number } {
  const [x, y, z] = earthAxesAt(icrfToPlane, tMs);
  const u = unit(p);
  return { lat: deg(Math.asin(Math.max(-1, Math.min(1, dot(u, z))))), lon: deg(Math.atan2(dot(u, y), dot(u, x))) };
}

// ---------------------------------------------------------------------------------------------
// The launch window
// ---------------------------------------------------------------------------------------------

const startOf = (plan: OkPlan, id: string): number => plan.steps.find((s) => s.id === id)!.startMs;

/**
 * Where the craft enters the Moon's sphere of influence (km, the plan's frame), when, and how
 * far round Earth missionAt's coast goes from TLI to there (radians, in [0, 2 pi)).
 */
function entryOf(plan: OkPlan): { entry: V3; entryMs: number; sweep: number } {
  const loi = startOf(plan, 'loi');
  let entryMs = Math.ceil(loi - approachSeconds(plan) * 1000);
  while (!missionAt(plan, entryMs).moonPlane && entryMs < loi) entryMs++;
  const st = missionAt(plan, entryMs);
  const [lx, ly] = lunarFrameInEarthPlane(plan);
  const [mx, my] = st.moonPlane ?? [0, 0];
  const entry: V3 = [0, 1, 2].map((i) => mx * lx[i] + my * ly[i]) as V3;
  entry[0] += st.earthPlane.moon[0];
  entry[1] += st.earthPlane.moon[1];
  const [cx, cy] = st.earthPlane.craft;   // the coast starts at angle pi in missionAt's picture
  return { entry, entryMs, sweep: mod(Math.atan2(cy, cx) - Math.PI, TAU) };
}

/**
 * The plane through Earth's centre that holds the pad's direction p and the point e, its normal
 * on the side that has the craft leave the pad eastward. Null when p and e are in line.
 */
function planeThrough(p: V3, e: V3, pole: V3): { normal: V3; incDeg: number } | null {
  const c = cross(p, unit(e));
  const len = Math.hypot(...c);
  if (len < 1e-6) return null;
  let normal = scale(1 / len, c);
  if (dot(cross(normal, p), cross(pole, p)) < 0) normal = scale(-1, normal);
  return { normal, incDeg: deg(Math.acos(Math.max(-1, Math.min(1, dot(normal, pole))))) };
}

export type LaunchWindow = { launchMs: number; incDeg: number };

/**
 * The launch time that joins the pad to the coast (see the top of this file), searched from
 * PARKING_MAX_LAPS laps to half a lap of parking before TLI, the ascent's own time kept. Of the
 * times that work, the one with the least inclined parking orbit. Null when none does.
 */
export function launchWindow(plan: OkPlan, icrfToPlane: Mat3): LaunchWindow | null {
  const { entry, sweep } = entryOf(plan);
  const tli = startOf(plan, 'tli');
  const ascentMs = startOf(plan, 'parking') - plan.launchMs;
  const { nPark, pad } = plan.geometry;
  const lapMs = (TAU / nPark) * 1000;
  // How far round the craft is short of where it must be at liftoff, in (-pi, pi]: rises with
  // the launch time, by a whole turn a lap, so it crosses zero once a lap.
  const miss = (L: number): { g: number; incDeg: number } | null => {
    const p = onEarthAt(icrfToPlane, pad.lat, pad.lon, L);
    const plane = planeThrough(p, entry, earthAxesAt(icrfToPlane, L)[2]);
    if (!plane) return null;
    const phiEntry = Math.atan2(dot(entry, cross(plane.normal, p)), dot(entry, p));
    return { g: mod(phiEntry - sweep - nPark * ((tli - L) / 1000) + Math.PI, TAU) - Math.PI, incDeg: plane.incDeg };
  };
  const from = tli - ascentMs - PARKING_MAX_LAPS * lapMs;
  const to = tli - ascentMs - 0.5 * lapMs;
  const STEP = 30_000;
  let best: LaunchWindow | null = null;
  let prevL = from;
  let prev = miss(from);
  for (let L = from + STEP; L <= to; L += STEP) {
    const cur = miss(L);
    if (prev && cur && prev.g < 0 && cur.g >= 0 && cur.g - prev.g < Math.PI) {
      let lo = prevL;
      let hi = L;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const m = miss(mid);
        if (!m) break;
        if (m.g < 0) lo = mid; else hi = mid;
      }
      const launchMs = Math.round((lo + hi) / 2);
      const m = miss(launchMs);
      if (m && Math.abs(m.g) < 1e-4 && (!best || m.incDeg < best.incDeg)) best = { launchMs, incDeg: m.incDeg };
    }
    prev = cur;
    prevL = L;
  }
  return best;
}

/**
 * The plan with its launch moved to the launch window: the launch time, the parking orbit's
 * stay and inclination, and the ascent's Δv (ascentDvFor) change; the rest is the same. It also
 * keeps the frame (plan.earth), so the 3D view can place Earth. The plan as it was when no time
 * works.
 */
export function withLaunchWindow(plan: OkPlan, sky: { toMoon: Vec3; pole: Vec3 }): OkPlan {
  const icrfToPlane = icrfToPlaneFor(plan, sky);
  const w = launchWindow(plan, icrfToPlane);
  if (!w) return plan;
  const ascentMs = startOf(plan, 'parking') - plan.launchMs;
  const poi = w.launchMs + ascentMs;
  const ascentDv = ascentDvFor(w.incDeg);
  const before = plan.steps.find((s) => s.id === 'launch')!.dvKmS ?? 0;
  return {
    ...plan,
    launchMs: w.launchMs,
    steps: plan.steps.map((s) => {
      if (s.id === 'launch') return { ...s, startMs: w.launchMs, endMs: poi, dvKmS: ascentDv };
      if (s.id === 'parking') return { ...s, startMs: poi };
      return s;
    }),
    totals: { ...plan.totals, launchVehicleDvKmS: plan.totals.launchVehicleDvKmS - before + ascentDv },
    orbit: { ...plan.orbit, parkingIncDeg: w.incDeg },
    earth: { icrfToPlane: icrfToPlane as [V3, V3, V3] },
  };
}

// ---------------------------------------------------------------------------------------------
// The path
// ---------------------------------------------------------------------------------------------

export type Departure = {
  normal: V3;          // the parking orbit's and coast's plane
  tliDir: V3;          // unit, towards the TLI point
  entry: V3;           // where the craft enters the Moon's sphere of influence, km
  entryMs: number;
  v1: V3 | null;       // the coast's velocity just after TLI, km/s (null: no orbit found; the coast is then missionAt's)
};

/**
 * The departure for a plan. With plan.earth (withLaunchWindow): in the plane through the pad at
 * liftoff and the entry point, the TLI point where the parking orbit takes the craft by TLI.
 * Without: in the Moon's orbit plane, the TLI point as far round from the entry as missionAt's.
 */
export function departureFor(plan: OkPlan): Departure {
  const { entry, entryMs, sweep } = entryOf(plan);
  const tli = startOf(plan, 'tli');
  const { nPark, pad, rPark } = plan.geometry;
  let normal: V3 = [0, 0, 1];
  let tliDir: V3;
  const frame = plan.earth?.icrfToPlane;
  const p = frame ? onEarthAt(frame, pad.lat, pad.lon, plan.launchMs) : null;
  const plane = frame && p ? planeThrough(p, entry, earthAxesAt(frame, plan.launchMs)[2]) : null;
  if (p && plane) {
    normal = plane.normal;
    tliDir = turn(p, normal, nPark * ((tli - plan.launchMs) / 1000));
  } else {
    const inPlane = unit([entry[0], entry[1], 0]);
    tliDir = turn(inPlane, normal, -sweep);
  }
  const aim = lambert(scale(rPark, tliDir), entry, (entryMs - tli) / 1000, MU_EARTH, normal);
  return { normal, tliDir, entry, entryMs, v1: aim ? aim.v1 : null };
}

/**
 * Where the craft is from launch to the sphere of influence, in the plan's frame in 3D: the
 * ascent and the parking orbit round the departure's plane (missionAt's altitude, at the parking
 * orbit's rate), then the coast. After the entry, null: the craft is on missionAt's Moon-centred path.
 */
export function departureAt(plan: OkPlan, dep: Departure, tMs: number): V3 | null {
  if (tMs >= dep.entryMs) return null;
  const tli = startOf(plan, 'tli');
  if (tMs > tli && dep.v1) return propagate(scale(plan.geometry.rPark, dep.tliDir), dep.v1, (tMs - tli) / 1000, MU_EARTH);
  const st = missionAt(plan, tMs);
  if (tMs > tli) return [st.earthPlane.craft[0], st.earthPlane.craft[1], 0];
  const r = R_EARTH + st.altKm;
  return scale(r, turn(dep.tliDir, dep.normal, -plan.geometry.nPark * ((tli - tMs) / 1000)));
}

/**
 * The place on Earth under the craft (latitude, longitude, degrees) from launch to the sphere of
 * influence, when Earth's turning is known (plan.earth); null otherwise.
 */
export function earthGroundAt(plan: OkPlan, dep: Departure, tMs: number): { lat: number; lon: number } | null {
  const frame = plan.earth?.icrfToPlane;
  const at = frame ? departureAt(plan, dep, tMs) : null;
  return frame && at ? groundUnder(frame, at, Math.min(Math.max(tMs, plan.launchMs), plan.touchdownMs)) : null;
}
