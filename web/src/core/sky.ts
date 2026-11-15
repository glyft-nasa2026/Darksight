// Issue #80: which way the stars lie. The star map behind the 3D views is in the ICRF (the J2000
// equator); these rotations turn it into the Moon-fixed frame (contract section 1), into
// Earth's frame, and into the plane of the Moon's orbit. Pure functions, no three.js.
// The stars only illustrate: no number shown to the user comes from here.
import type { Ephemeris, Vec3 } from './ephemeris';

/** A rotation as its three rows: `apply(m, v)` takes a vector from the first frame to the second. */
export type Mat3 = [Vec3, Vec3, Vec3];

const RAD = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12);   // JD 2451545.0
const DAY_MS = 86_400_000;
/**
 * TT minus UTC since 2017 (37 leap seconds + 32.184 s). Off by a few tens of seconds at other
 * dates, which turns the Moon by under 0.01 degrees.
 */
export const TT_MINUS_UTC_S = 69.184;

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec3;
}
/** The inverse rotation, applied: from the second frame back to the first. */
export function applyInverse(m: Mat3, v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]) as Vec3;
}
export function multiply(a: Mat3, b: Mat3): Mat3 {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as Mat3;
}
/** The angle, in degrees, of the rotation that takes one frame to the other. */
export function angleBetween(a: Mat3, b: Mat3): number {
  let trace = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) trace += a[i][k] * b[i][k];
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) / RAD;
}

/** Frame rotations about the x, y and z axes (the frame turns by `deg`, vectors the other way). */
function r1(deg: number): Mat3 {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
}
function r2(deg: number): Mat3 {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}
function r3(deg: number): Mat3 {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
}

/** Days of TT from J2000.0. */
function ttDays(tMs: number): number {
  return (tMs + TT_MINUS_UTC_S * 1000 - J2000_MS) / DAY_MS;
}

/**
 * ICRF to the Moon-fixed (mean-Earth) frame: the IAU Working Group on Cartographic Coordinates
 * and Rotational Elements model of the Moon (Archinal et al. 2011, table 2). It is meant to
 * stand in for the mean-Earth frame; against DE440's (Skyfield) it agrees to about 0.01 degrees.
 */
export function moonFromIcrf(tMs: number): Mat3 {
  const d = ttDays(tMs), T = d / 36525;
  const E = [
    125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d,
    176.625 + 13.3407154 * d, 357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d,
    134.963 + 13.0649930 * d, 276.617 + 0.3287146 * d, 34.226 + 1.7484877 * d,
    15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d,
    25.053 + 12.9590088 * d,
  ].map((e) => e * RAD);
  const sin = (i: number): number => Math.sin(E[i - 1]), cos = (i: number): number => Math.cos(E[i - 1]);
  const alpha = 269.9949 + 0.0031 * T - 3.8787 * sin(1) - 0.1204 * sin(2) + 0.0700 * sin(3)
    - 0.0172 * sin(4) + 0.0072 * sin(6) - 0.0052 * sin(10) + 0.0043 * sin(13);
  const delta = 66.5392 + 0.0130 * T + 1.5419 * cos(1) + 0.0239 * cos(2) - 0.0278 * cos(3)
    + 0.0068 * cos(4) - 0.0029 * cos(6) + 0.0009 * cos(7) + 0.0008 * cos(10) - 0.0009 * cos(13);
  const w = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * sin(1) + 0.1208 * sin(2)
    - 0.0642 * sin(3) + 0.0158 * sin(4) + 0.0252 * sin(5) - 0.0066 * sin(6) - 0.0047 * sin(7)
    - 0.0046 * sin(8) + 0.0028 * sin(9) + 0.0052 * sin(10) + 0.0040 * sin(11) + 0.0019 * sin(12)
    - 0.0044 * sin(13);
  return multiply(r3(w % 360), multiply(r1(90 - delta), r3(90 + alpha)));
}

/**
 * ICRF to Earth's frame (longitude 0 on x, the north pole on z): IAU 1976 precession, then
 * Greenwich mean sidereal time (IAU 1982), with UTC standing in for UT1. Nutation and polar
 * motion are left out, so it is good to about 0.01 degrees while UT1 stays near UTC.
 */
export function earthFromIcrf(tMs: number): Mat3 {
  const T = ttDays(tMs) / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) / 3600;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) / 3600;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) / 3600;
  const precession = multiply(r3(-z), multiply(r2(theta), r3(-zeta)));
  const du = (tMs - J2000_MS) / DAY_MS, Tu = du / 36525;
  const gmst = 280.46061837 + 360.98564736629 * du + 0.000387933 * Tu * Tu - Tu ** 3 / 38_710_000;
  return multiply(r3(gmst % 360), precession);
}

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The Moon as seen from Earth's centre, in the ICRF, km, from a Moon-fixed Earth vector at tMs. */
export function moonFromEarthIcrf(earthKmMoonFixed: Vec3, tMs: number): Vec3 {
  const e = applyInverse(moonFromIcrf(tMs), earthKmMoonFixed);
  return [-e[0], -e[1], -e[2]];
}

/**
 * The plane of the Moon's orbit at tMs, in the ICRF: the direction from Earth to the Moon, and
 * the orbit's pole (the way the Moon goes round, by the right hand), from the table's Earth
 * vectors six hours apart.
 */
export function moonOrbitIcrf(eph: Pick<Ephemeris, 'vectorsAt'>, tMs: number): { toMoon: Vec3; pole: Vec3 } {
  const later = tMs + 6 * 3_600_000;
  const a = moonFromEarthIcrf(eph.vectorsAt(tMs).earthKm, tMs);
  const b = moonFromEarthIcrf(eph.vectorsAt(later).earthKm, later);
  return { toMoon: unit(a), pole: unit(cross(a, b)) };
}

/**
 * The rotation that takes `fromX` onto `toX` and turns `fromZ` as near `toZ` as it can go (each
 * z is first made square to its x). Lines up two frames given one direction and one pole.
 */
export function alignFrames(fromX: Vec3, fromZ: Vec3, toX: Vec3, toZ: Vec3): Mat3 {
  const basis = (x: Vec3, z: Vec3): Mat3 => {
    const ex = unit(x);
    const k = z[0] * ex[0] + z[1] * ex[1] + z[2] * ex[2];
    const ez = unit([z[0] - k * ex[0], z[1] - k * ex[1], z[2] - k * ex[2]]);
    return [ex, cross(ez, ex), ez];
  };
  const f = basis(fromX, fromZ), t = basis(toX, toZ);
  // M = sum over axes of to_i (from_i)^T
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    t[0][i] * f[0][j] + t[1][i] * f[1][j] + t[2][i] * f[2][j])) as Mat3;
}
