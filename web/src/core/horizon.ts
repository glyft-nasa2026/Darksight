// Terrain skyline (T05, T37), from the contract's Skyline block (section 3).
//
// For each azimuth 0..359, walk outward along the great circle from the site, from one grid cell
// to 150 km. Step = the larger of half a cell and 1 % of the distance so far.
//
//   gamma = dist / R                          angle at the Moon's centre
//   r0    = R + ground(site) + eye
//   r1    = R + ground(point)
//   elev  = atan2(r1 cos(gamma) - r0, r1 sin(gamma))
//   skyline[az] = largest elev along that azimuth
//
// Which height map (T37, option C): dem.bin (240 m) for a site at or south of 85 S, globe.bin
// (3.8 km, T43's reader in core/globe.ts) for every other site. One grid for the whole walk. A
// polar site never falls back to globe.bin. terrain = false and all zeros when the site's grid is
// not loaded.
// The Moon has no atmosphere: no refraction.

import type { Dem } from './dem';
import { destination } from './geometry';
import type { GlobeHeights } from './globe';
import { DEFAULT_EYE_M, MOON_RADIUS_KM, type Site, type Skyline, type TerrainGrid } from './types';

const R_M = MOON_RADIUS_KM * 1000;
const DEG = 180 / Math.PI;

/** How far the walk goes, metres. */
export const SKYLINE_MAX_DIST_M = 150_000;
/** Sites at or south of this latitude use dem.bin; the rest use globe.bin (T37). */
export const SKYLINE_MIN_LAT = -85;
/**
 * Within this many degrees of the south pole (about 3 m), the walk starts from the pole itself.
 * There, every direction is north and bearing b runs down longitude (site lon + b).
 * destination() follows the same rule from exactly -90. This shortcut was written when it
 * could not (its first formula cancelled to 0/0 there) and is kept as it is.
 */
const POLE_EPS_DEG = 1e-4;

/** The distances the walk samples, metres. The same for every azimuth. */
export function walkDistances(cellM: number, maxM: number = SKYLINE_MAX_DIST_M): number[] {
  const out: number[] = [];
  for (let d = cellM; d <= maxM; d += Math.max(cellM / 2, 0.01 * d)) out.push(d);
  return out;
}

/** Which height map a site's skyline uses, or null when that grid is not loaded (contract section 3). */
export function skylineGrid(dem: Dem | null, site: Site, globe: GlobeHeights | null): TerrainGrid | null {
  if (site.lat <= SKYLINE_MIN_LAT) return dem ? 'dem' : null;
  // A NaN latitude fails both tests and gets no grid.
  return globe && site.lat > SKYLINE_MIN_LAT ? 'globe' : null;
}

/** The site's ground height, metres, from the same grid as its skyline; 0 when it has none. */
export function groundAt(dem: Dem | null, site: Site, globe: GlobeHeights | null): number {
  const grid = skylineGrid(dem, site, globe);
  if (grid === 'dem') return dem!.heightAt(site.lat, site.lon);
  if (grid === 'globe') return globe!.heightBilinear(site.lat, site.lon);
  return 0;
}

/** Skyline seen from a site: 360 elevations in degrees, index = azimuth. */
export function skylineAt(dem: Dem | null, site: Site, globe: GlobeHeights | null = null): Skyline {
  const elev = new Float32Array(360);
  const grid = skylineGrid(dem, site, globe);
  if (!grid) return { elev, terrain: false, grid: null, cellM: null };

  const heightAt: (lat: number, lon: number) => number = grid === 'dem'
    ? (lat, lon) => dem!.heightAt(lat, lon)
    : (lat, lon) => globe!.heightBilinear(lat, lon);
  const cellM = grid === 'dem' ? dem!.meta.pixel_m : globe!.rowSpacingM;

  const eye = site.eye_m ?? DEFAULT_EYE_M;
  const r0 = R_M + heightAt(site.lat, site.lon) + eye;
  const atPole = site.lat + 90 < POLE_EPS_DEG;

  const dists = walkDistances(cellM);
  const cosG = dists.map((d) => Math.cos(d / R_M));
  const sinG = dists.map((d) => Math.sin(d / R_M));

  for (let az = 0; az < 360; az++) {
    // atan2(a, b) with b > 0 grows with a / b, so keep the largest ratio and take atan once.
    let best = -Infinity;
    for (let k = 0; k < dists.length; k++) {
      const p = atPole
        ? { lat: -90 + (dists[k] / R_M) * DEG, lon: site.lon + az }
        : destination(site.lat, site.lon, az, dists[k]);
      const r1 = R_M + heightAt(p.lat, p.lon);
      const t = (r1 * cosG[k] - r0) / (r1 * sinG[k]);
      if (t > best) best = t;
    }
    elev[az] = Math.atan(best) * DEG;
  }
  return { elev, terrain: true, grid, cellM };
}

/** Skyline elevation at any azimuth, straight-line between the two whole degrees around it. */
export function skylineElev(s: Skyline, az: number): number {
  const a = ((az % 360) + 360) % 360;
  const i = Math.floor(a) % 360;
  const u = a - Math.floor(a);
  return s.elev[i] * (1 - u) + s.elev[(i + 1) % 360] * u;
}
