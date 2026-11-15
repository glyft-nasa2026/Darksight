import { Vector3 } from 'three';
import { MOON_RADIUS_KM, type Site } from '../core/types';
import type { DemMeta } from '../core/dem';
import type { Vec3 } from '../core/ephemeris';

const RAD = Math.PI / 180;

/** Render frame: +X = 90 E, +Y = south, -Z = longitude 0. Units are km.
 * This is a rotation (not a reflection), so normals and lighting keep their handedness.
 * The origin is the south pole; the centre of the Moon is (0, -R, 0).
 */
export function moonDirection(v: Vec3): Vector3 {
  return new Vector3(v[1], -v[2], -v[0]);
}

/** The centre of the Moon in the render frame. */
export function moonCentre(): Vector3 {
  return new Vector3(0, -MOON_RADIUS_KM, 0);
}

/** Unit vector pointing straight up (away from the Moon's centre) at a site. */
export function siteUp(site: Site): Vector3 {
  return sitePosition(site).sub(moonCentre()).normalize();
}

/** Unit vector pointing north along the ground, for a site's `siteUp`. At a pole, toward longitude 0. */
export function siteNorth(up: Vector3): Vector3 {
  const north = new Vector3(0, -1, 0).addScaledVector(up, up.y);
  return north.lengthSq() < 1e-12 ? new Vector3(0, 0, -1) : north.normalize();
}

/**
 * An offset from one site (`fromUp`) carried to another (`toUp`): as far east, north and up of
 * the new site as it was of the first, in each site's own frame (east = north × up). This is how
 * the orbit camera keeps its zoom and viewing angle when the selected site moves far round the Moon.
 */
export function carryOffset(offset: Vector3, fromUp: Vector3, toUp: Vector3): Vector3 {
  const fromNorth = siteNorth(fromUp), toNorth = siteNorth(toUp);
  const fromEast = fromNorth.clone().cross(fromUp), toEast = toNorth.clone().cross(toUp);
  return toEast.multiplyScalar(offset.dot(fromEast))
    .addScaledVector(toNorth, offset.dot(fromNorth)).addScaledVector(toUp, offset.dot(fromUp));
}

export function sitePosition(site: Site, heightM = 0, stretch = 1): Vector3 {
  const lat = site.lat * RAD, lon = site.lon * RAD;
  const r = MOON_RADIUS_KM + heightM * stretch / 1000;
  return new Vector3(
    r * Math.cos(lat) * Math.sin(lon),
    -r * Math.sin(lat) - MOON_RADIUS_KM,
    -r * Math.cos(lat) * Math.cos(lon),
  );
}

/** Contract inverse stereographic projection. UVs retain the original DEM grid coordinates. */
export function gridSite(meta: DemMeta, col: number, row: number): Site {
  const x = meta.x_min_m + col * meta.pixel_m;
  const y = meta.y_max_m - row * meta.pixel_m;
  return {
    lat: 2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_KM * 1000)) / RAD - 90,
    lon: Math.atan2(x, y) / RAD,
  };
}

export function sphereSite(point: Vector3): Site {
  const y = point.y + MOON_RADIUS_KM;
  return {
    lat: -Math.atan2(y, Math.hypot(point.x, point.z)) / RAD,
    lon: Math.atan2(point.x, -point.z) / RAD,
  };
}
