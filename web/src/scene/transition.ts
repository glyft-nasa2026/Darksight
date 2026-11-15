// T29 (spec F16): the cross-fade between the flat 2D map (web/src/map/) and the 3D orbit view.
// Pure functions: the fade's easing and progress, and the camera's path from straight above the
// selected site, turned and zoomed like the map, down to the orbit view. Nothing here is a number
// shown to the user; the 3D view illustrates.

import { Vector3 } from 'three';
import { cylForward, cylInverse, polarForward, polarInverse, type Pole } from '../core/projection';
import { MOON_RADIUS_KM, type Site } from '../core/types';
import { moonCentre, siteNorth, sitePosition, siteUp } from './coordinates';

const RAD = Math.PI / 180;

/** How long a whole fade takes, map to 3D or back. A fade that starts part-way takes its share. */
export const FADE_MS = 800;
/**
 * A frame longer than this (the first frame of a 3D view, a busy moment elsewhere on the page)
 * moves a fade on by this much at most, so the picture never jumps ahead.
 */
export const MAX_STEP_MS = 100;
/** The closest and furthest the camera starts from above the site, in km: the orbit's closest, and well past the whole Moon. */
export const ABOVE_MIN_KM = 0.2, ABOVE_MAX_KM = MOON_RADIUS_KM * 4;

/** Slow at both ends and fastest in the middle: 0 at 0, 1 at 1, and no speed at either end. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/**
 * One fade. `from` is how much of the 3D view showed when it began (0: the map only; 1: the 3D
 * view only), `to` where it ends. A change of view during a fade starts a new fade from where
 * this one is, so nothing snaps back first.
 */
export type Fade = { from: number; to: 0 | 1; durationMs: number; elapsedMs: number; lastMs: number | null };

/** A fade from `shown` to `to`, taking FADE_MS for the whole way; null when it is there already. */
export function startFade(shown: number, to: 0 | 1): Fade | null {
  const distance = Math.abs(to - shown);
  if (distance < 1e-6) return null;
  return { from: shown, to, durationMs: FADE_MS * distance, elapsedMs: 0, lastMs: null };
}

/** How much of the 3D view shows at this point of the fade: eased, and exactly `to` at the end. */
export function fadeAt(fade: Fade): number {
  const t = fade.elapsedMs / fade.durationMs;
  return t >= 1 ? fade.to : fade.from + (fade.to - fade.from) * easeInOut(t);
}

/** Whether the fade has reached its end. */
export function fadeDone(fade: Fade): boolean {
  return fade.elapsedMs >= fade.durationMs;
}

/**
 * Moves the fade on to a frame's time and returns how much of the 3D view shows. The first frame
 * shows the fade's start. While `hold` (the 3D view is still being built) it doesn't move.
 */
export function stepFade(fade: Fade, nowMs: number, hold = false): number {
  const dt = fade.lastMs === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, nowMs - fade.lastMs));
  fade.lastMs = nowMs;
  if (!hold) fade.elapsedMs += dt;
  return fadeAt(fade);
}

/** The 2D map's projection: polar stereographic about either pole, or the whole Moon (web/src/map/). */
export type MapKind = Pole | 'global';

/**
 * The way "up the screen" on the 2D map points along the ground at a site, as a unit vector in the
 * render frame (coordinates.ts): toward longitude 0 at the south pole, north on the whole-Moon map.
 * Worked out with core/'s projections, a kilometre up the map from the site.
 */
export function mapUp(site: Site, kind: MapKind): Vector3 {
  const up = siteUp(site);
  const along = (sign: 1 | -1): Site | null => {
    if (kind === 'global') {
      const p = cylForward(site.lat, site.lon);   // km
      return cylInverse(p.x, p.y + sign);
    }
    const p = polarForward(site.lat, site.lon, kind);   // metres
    return polarInverse(p.x, p.y + sign * 1000, kind);
  };
  // Past a pole, up the whole-Moon map leaves it: use the way down, turned round.
  let sign: 1 | -1 = 1, next = along(1);
  if (!next) { sign = -1; next = along(-1); }
  const dir = next ? sitePosition(next).sub(sitePosition(site)).multiplyScalar(sign) : new Vector3();
  dir.addScaledVector(up, -dir.dot(up));
  return dir.lengthSq() > 1e-18 ? dir.normalize() : siteNorth(up);
}

/** A camera: where it is, the point it looks at, and its up direction. */
export type Pose = { position: Vector3; target: Vector3; up: Vector3 };

/** How far from flat ground a camera with this vertical field of view sees `kmTall` from the top of the picture to the bottom. */
export function heightFor(kmTall: number, fovDeg: number): number {
  return kmTall / (2 * Math.tan((fovDeg / 2) * RAD));
}

/**
 * Straight above the site, looking down at it, turned like the 2D map (its up the screen is the
 * map's) and as far up as shows the ground the map shows from top to bottom (`kmTall`).
 * `target` is the site on the drawn ground.
 */
export function abovePose(target: Vector3, site: Site, kind: MapKind, kmTall: number, fovDeg: number): Pose {
  const height = Math.min(ABOVE_MAX_KM, Math.max(ABOVE_MIN_KM, heightFor(kmTall, fovDeg)));
  return { position: target.clone().addScaledVector(siteUp(site), height), target: target.clone(), up: mapUp(site, kind) };
}

/** Unit vectors u to v along the great circle between them, at t from 0 to 1. */
function slerpUnit(u: Vector3, v: Vector3, t: number): Vector3 {
  const angle = Math.acos(Math.min(1, Math.max(-1, u.dot(v))));
  if (angle < 1e-9) return u.clone().lerp(v, t).normalize();
  if (Math.PI - angle < 1e-9) {
    // Opposite: any great circle through both will do; take one, the same every time.
    const side = Math.abs(u.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const w = side.addScaledVector(u, -side.dot(u)).normalize();
    return u.clone().multiplyScalar(Math.cos(t * Math.PI)).addScaledVector(w, Math.sin(t * Math.PI));
  }
  const s = Math.sin(angle);
  return u.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(v, Math.sin(t * angle) / s);
}

/**
 * A camera `e` of the way from pose a to pose b, 0 to 1: exactly a at 0 and exactly b at 1, and
 * moving smoothly in between. It goes round the Moon's centre rather than straight, so a long
 * way (to a view of the whole Moon from the far side) never passes through the Moon.
 */
export function blendPose(a: Pose, b: Pose, e: number): Pose {
  const clone = (p: Pose): Pose => ({ position: p.position.clone(), target: p.target.clone(), up: p.up.clone() });
  if (e <= 0) return clone(a);
  if (e >= 1) return clone(b);
  const centre = moonCentre();
  const ra = a.position.clone().sub(centre), rb = b.position.clone().sub(centre);
  const la = ra.length(), lb = rb.length();
  const position = slerpUnit(ra.divideScalar(la), rb.divideScalar(lb), e).multiplyScalar(la + (lb - la) * e).add(centre);
  const target = a.target.clone().lerp(b.target, e);
  const up = a.up.clone().lerp(b.up, e);
  if (up.lengthSq() < 1e-12) up.copy(e < 0.5 ? a.up : b.up); else up.normalize();
  return { position, target, up };
}
