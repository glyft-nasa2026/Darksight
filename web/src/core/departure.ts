// The departure from Earth in 3D (issue #192): the parking orbit, TLI and the coast to the Moon.
//
// missionAt draws the Earth side in one plane, the Moon's. A real launch reaches a parking
// orbit inclined to Earth's equator by at least the pad's latitude, and TLI and the coast stay
// close to that orbit's plane. So the departure here lies in the plane that is inclined to
// Earth's equator by the parking orbit's inclination (orbit.parkingIncDeg) and holds the point
// where the craft enters the Moon's sphere of influence. TLI sets the course: the coast is the
// one two-body orbit from the TLI point to that entry point in the coast's time (lambert.ts).
// The numbers (Δv, times, altitudes) stay missionAt's; this is where the picture puts them.
//
// Frame: missionAt's earthPlane, in 3D: x and y in the Moon's orbit plane, z its normal (the
// Moon's north), km, Earth at the origin.
import { lambert, propagate, type V3 } from './lambert';
import { approachSeconds, lunarFrameInEarthPlane, missionAt, MU_EARTH, R_EARTH, type OkPlan } from './mission';

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (k: number, a: V3): V3 => [k * a[0], k * a[1], k * a[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: V3): V3 => scale(1 / Math.hypot(a[0], a[1], a[2]), a);
/** a turned by angle (radians) about the unit axis n, a at right angles to n. */
const turn = (a: V3, n: V3, angle: number): V3 => add(scale(Math.cos(angle), a), scale(Math.sin(angle), cross(n, a)));

/**
 * The normal of the plane through Earth's centre that holds `toward` and is inclined incDeg to
 * the equator of a body whose pole is `pole`. Of the two such planes, the one nearer `prefer`'s
 * plane (the larger normal component along `prefer`); its normal on the side of `prefer`, so the
 * motion goes the same way round. When `toward` lies farther from the equator than incDeg allows,
 * the least inclined plane that holds it.
 */
export function inclinedPlane(toward: V3, pole: V3, incDeg: number, prefer: V3): V3 {
  const a = unit(toward);
  const p = unit(pole);
  const pa = dot(p, a);
  const perp: V3 = [p[0] - pa * a[0], p[1] - pa * a[1], p[2] - pa * a[2]];
  const len = Math.hypot(...perp);
  if (len < 1e-12) return unit(cross(a, cross(prefer, a)));   // toward along the pole: any plane holds it
  const e2 = scale(1 / len, perp);
  const e3 = cross(a, e2);
  // n = cos(phi) e2 + sin(phi) e3, and n . p = cos(phi) len = cos(inc).
  const c = Math.min(1, Math.cos((incDeg * Math.PI) / 180) / len);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  const options = [add(scale(c, e2), scale(s, e3)), add(scale(c, e2), scale(-s, e3))]
    .map((n) => (dot(n, prefer) < 0 ? scale(-1, n) : n));
  return dot(options[0], prefer) >= dot(options[1], prefer) ? options[0] : options[1];
}

export type Departure = {
  normal: V3;          // the parking orbit's and coast's plane
  tliDir: V3;          // unit, towards the TLI point
  entry: V3;           // where the craft enters the Moon's sphere of influence, km
  entryMs: number;
  v1: V3 | null;       // the coast's velocity just after TLI, km/s (null: no orbit found; the coast is then missionAt's)
};

/**
 * The departure for a plan. earthPole: Earth's north pole in the earthPlane frame, or null when
 * it isn't known (no Sun and Earth table loaded); the departure then stays in the Moon's plane.
 */
export function departureFor(plan: OkPlan, earthPole: V3 | null): Departure {
  const loi = plan.steps.find((s) => s.id === 'loi')!.startMs;
  const tli = plan.steps.find((s) => s.id === 'tli')!.startMs;
  let entryMs = Math.ceil(loi - approachSeconds(plan) * 1000);
  while (!missionAt(plan, entryMs).moonPlane && entryMs < loi) entryMs++;
  const st = missionAt(plan, entryMs);
  const [lx, ly] = lunarFrameInEarthPlane(plan);
  const [mx, my] = st.moonPlane ?? [0, 0];
  const entry: V3 = [0, 1, 2].map((i) => mx * lx[i] + my * ly[i]) as V3;
  entry[0] += st.earthPlane.moon[0];
  entry[1] += st.earthPlane.moon[1];
  const up: V3 = [0, 0, 1];
  const normal = earthPole ? inclinedPlane(entry, earthPole, plan.orbit.parkingIncDeg, up) : up;
  // TLI is as far round from the entry as missionAt's coast goes from perigee to the entry.
  const [cx, cy] = st.earthPlane.craft;
  const sweep = Math.atan2(cy, cx) - Math.PI;
  const inPlane = unit(add(entry, scale(-dot(entry, normal), normal)));
  const tliDir = turn(inPlane, normal, -(((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)));
  const rPark = plan.geometry.rPark;
  const aim = lambert(scale(rPark, tliDir), entry, (entryMs - tli) / 1000, MU_EARTH, normal);
  return { normal, tliDir, entry, entryMs, v1: aim ? aim.v1 : null };
}

/**
 * Where the craft is from launch to the sphere of influence, in the earthPlane frame in 3D: the
 * ascent and the parking orbit round the departure's plane (missionAt's altitude and angle),
 * then the coast. After the entry, null: the craft is on missionAt's Moon-centred path.
 */
export function departureAt(plan: OkPlan, dep: Departure, tMs: number): V3 | null {
  if (tMs >= dep.entryMs) return null;
  const tli = plan.steps.find((s) => s.id === 'tli')!.startMs;
  if (tMs > tli && dep.v1) return propagate(scale(plan.geometry.rPark, dep.tliDir), dep.v1, (tMs - tli) / 1000, MU_EARTH);
  const st = missionAt(plan, tMs);
  if (tMs > tli) return [st.earthPlane.craft[0], st.earthPlane.craft[1], 0];
  const r = R_EARTH + st.altKm;
  return scale(r, turn(dep.tliDir, dep.normal, -plan.geometry.nPark * ((tli - tMs) / 1000)));
}
