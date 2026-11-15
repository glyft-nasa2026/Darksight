// Two-body orbits from two points and a time (issue #192).
//
// The simulation page draws the translunar coast as the one orbit round Earth that leaves the
// TLI point and reaches the Moon's sphere of influence, where the arrival hyperbola begins, in
// the coast's time: Lambert's problem. TLI sets the course; after it the engine is off, so the
// path is a single smooth conic.
//
// Both functions use universal variables with Stumpff functions, as in Curtis, Orbital
// Mechanics for Engineering Students, algorithms 3.3 (propagate) and 5.2 (Lambert). Pure
// functions: km, km/s, seconds, any one inertial frame.

export type V3 = [number, number, number];

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): number => Math.sqrt(dot(a, a));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const comb = (p: number, a: V3, q: number, b: V3): V3 => [p * a[0] + q * b[0], p * a[1] + q * b[1], p * a[2] + q * b[2]];

/** Stumpff C(z). */
function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}

/** Stumpff S(z). */
function stumpffS(z: number): number {
  if (z > 1e-8) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-8) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/**
 * The velocities at r1 and r2 of the orbit round a body of gravitational parameter mu that goes
 * from r1 to r2 in tofS seconds, less than one revolution, moving the way `normal` points
 * (the angular momentum's side). Null when there is no such orbit (a zero time, a point at the
 * centre, or the two points exactly opposite, where the plane is not defined).
 */
export function lambert(r1: V3, r2: V3, tofS: number, mu: number, normal: V3): { v1: V3; v2: V3 } | null {
  const n1 = norm(r1);
  const n2 = norm(r2);
  if (!(tofS > 0) || !(n1 > 0) || !(n2 > 0)) return null;
  const cosD = Math.max(-1, Math.min(1, dot(r1, r2) / (n1 * n2)));
  let dTheta = Math.acos(cosD);
  if (dot(cross(r1, r2), normal) < 0) dTheta = 2 * Math.PI - dTheta;
  if (Math.abs(Math.sin(dTheta)) < 1e-9) return null;
  const A = Math.sin(dTheta) * Math.sqrt((n1 * n2) / (1 - Math.cos(dTheta)));
  const y = (z: number): number => n1 + n2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
  const time = (z: number): number => {
    const yz = y(z);
    return ((yz / stumpffC(z)) ** 1.5 * stumpffS(z) + A * Math.sqrt(yz)) / Math.sqrt(mu);
  };
  // The time grows with z. Bracket the root: below, the first z from -4 pi^2 where y is
  // positive; above, just short of one revolution (4 pi^2). A time shorter than the bracket
  // allows (a fast hyperbolic orbit) gives null: a lunar transfer is never one.
  let hi = 4 * Math.PI * Math.PI - 1e-6;
  let lo = -4 * Math.PI * Math.PI;
  while (y(lo) <= 0 && lo < hi) lo += 0.01;
  if (!(y(lo) > 0) || time(lo) > tofS || time(hi) < tofS) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (time(mid) < tofS) lo = mid; else hi = mid;
  }
  const yz = y((lo + hi) / 2);
  const f = 1 - yz / n1;
  const g = A * Math.sqrt(yz / mu);
  const gDot = 1 - yz / n2;
  return { v1: comb(1 / g, r2, -f / g, r1), v2: comb(gDot / g, r2, -1 / g, r1) };
}

/** Where a body starting at r0 with velocity v0 is after tS seconds, round a body of parameter mu. */
export function propagate(r0: V3, v0: V3, tS: number, mu: number): V3 {
  if (tS === 0) return [r0[0], r0[1], r0[2]];
  const rn = norm(r0);
  const vr = dot(r0, v0) / rn;
  const alpha = 2 / rn - dot(v0, v0) / mu;   // 1 / semi-major axis
  const sqMu = Math.sqrt(mu);
  // Newton's method on the universal anomaly x.
  let x = sqMu * Math.abs(alpha) * tS;
  if (!(Math.abs(alpha) > 1e-12)) x = sqMu * tS / rn;
  for (let i = 0; i < 100; i++) {
    const z = alpha * x * x;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = (rn * vr / sqMu) * x * x * C + (1 - alpha * rn) * x * x * x * S + rn * x - sqMu * tS;
    const dF = (rn * vr / sqMu) * x * (1 - z * S) + (1 - alpha * rn) * x * x * C + rn;
    const step = F / dF;
    x -= step;
    if (Math.abs(step) < 1e-10 * Math.max(1, Math.abs(x))) break;
  }
  const z = alpha * x * x;
  const f = 1 - (x * x / rn) * stumpffC(z);
  const g = tS - (x * x * x / sqMu) * stumpffS(z);
  return comb(f, r0, g, v0);
}
