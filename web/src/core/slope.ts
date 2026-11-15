// T41: ground slope from the south-pole height map (contract section 2, dem.bin).
//
// Method: central differences on the polar stereographic grid. At a stored cell (row, col) the
// height changes along the grid's x and y are
//
//   dz/dx = (z[row][col + 1] - z[row][col - 1]) / (2 * ground spacing)
//   dz/dy = (z[row - 1][col] - z[row + 1][col]) / (2 * ground spacing)
//
// The projection is conformal, so one scale factor serves both directions. With
// r = 2 R tan(c / 2) (c = degrees from the pole), a map metre covers 1 / k metres of ground, where
// k = dr / (R dc) = 1 / cos^2(c / 2) = 1 + (r / 2R)^2. So the ground spacing is pixel_m / k: 1.0 at
// the pole, 0.992 of pixel_m at 80 S. Slope = atan(hypot(dz/dx, dz/dy)), in degrees from level.
//
// At a latitude and longitude, the two gradient components are interpolated bilinearly from the
// four cells around the point, as heightAt interpolates heights, so the slope changes smoothly
// as the site moves. A cell on the grid's edge, or one whose own value or a neighbour's is
// `nodata`, has no slope (null), and so has any point that needs it.
//
// This is a slope over the grid's spacing (240 m on the real map): a boulder or a 10 m crater does
// not show in it. Heights are above the R sphere, so "level" is the sphere's local horizontal; the
// sphere's own curvature over 480 m is under 0.02 degrees and needs no correction.

import { projectToGrid, type Dem } from './dem';
import { MOON_RADIUS_KM } from './types';

const R_M = MOON_RADIUS_KM * 1000;
const DEG = 180 / Math.PI;

/** The Slope map layer's colour ramp runs from level (0) to this many degrees and steeper. */
export const SLOPE_RAMP_MAX_DEG = 30;

/** The distance between neighbouring heights the slope is measured over, metres (dem.json's pixel_m). */
export function slopeBaselineM(dem: Dem): number {
  return dem.meta.pixel_m;
}

/** Ground metres per map metre is 1 / k; k for the cell (row, col). */
function scaleAt(dem: Dem, row: number, col: number): number {
  const x = dem.meta.x_min_m + col * dem.meta.pixel_m;
  const y = dem.meta.y_max_m - row * dem.meta.pixel_m;
  const q = Math.hypot(x, y) / (2 * R_M);
  return 1 + q * q;
}

/**
 * The height gradient at one stored cell, [east-ish along the grid's x, north-ish along its y],
 * as metres of height per metre of ground. Null on the grid's edge or next to `nodata`.
 */
export function cellGradient(dem: Dem, row: number, col: number): [number, number] | null {
  const last = dem.meta.size - 1;
  if (row < 1 || col < 1 || row > last - 1 || col > last - 1) return null;
  if (!dem.hasData(row, col) || !dem.hasData(row, col - 1) || !dem.hasData(row, col + 1) ||
      !dem.hasData(row - 1, col) || !dem.hasData(row + 1, col)) return null;
  const k = scaleAt(dem, row, col);
  const per = k / (2 * dem.meta.pixel_m);
  const gx = (dem.cell(row, col + 1) - dem.cell(row, col - 1)) * per;
  const gy = (dem.cell(row - 1, col) - dem.cell(row + 1, col)) * per;
  return [gx, gy];
}

/** Slope at one stored cell, degrees from level. Null where cellGradient is null. */
export function cellSlope(dem: Dem, row: number, col: number): number | null {
  const g = cellGradient(dem, row, col);
  return g ? Math.atan(Math.hypot(g[0], g[1])) * DEG : null;
}

/**
 * Slope at a latitude and longitude, degrees from level (0 = flat). Null where the height map
 * does not cover the point (north of its min_lat, outside the grid) or a cell it needs has no data.
 */
export function slopeAt(dem: Dem, lat: number, lon: number): number | null {
  if (!dem.covers(lat, lon)) return null;
  const last = dem.meta.size - 1;
  const p = projectToGrid(dem.meta, lat, lon);
  const col = Math.min(Math.max(p.col, 0), last);
  const row = Math.min(Math.max(p.row, 0), last);
  const c0 = Math.min(Math.floor(col), last - 1);
  const r0 = Math.min(Math.floor(row), last - 1);
  const u = col - c0;
  const v = row - r0;
  const corners: [number, number, number][] = [
    [r0, c0, (1 - u) * (1 - v)], [r0, c0 + 1, u * (1 - v)],
    [r0 + 1, c0, (1 - u) * v], [r0 + 1, c0 + 1, u * v],
  ];
  let gx = 0, gy = 0;
  for (const [r, c, w] of corners) {
    if (w <= 1e-12) continue;            // a point on a cell's row or column needs only its own cells
    const g = cellGradient(dem, r, c);
    if (!g) return null;
    gx += g[0] * w;
    gy += g[1] * w;
  }
  return Math.atan(Math.hypot(gx, gy)) * DEG;
}
