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
// A central difference takes the heights one cell either side, so this is a slope over twice the
// grid's spacing (480 m on the real map): a boulder or a 10 m crater does not show in it. Heights are above the R sphere, so "level" is the sphere's local horizontal; the
// sphere's own curvature over 480 m is under 0.02 degrees and needs no correction.
//
// T43: the same slope on the whole-Moon grid (globe.bin, 0.125 degrees a cell), where the polar
// height maps do not reach. Central differences on the latitude-longitude grid:
//
//   dz/dy = (z[row - 1][col] - z[row + 1][col]) / (2 R dphi)                  north
//   dz/dx = (z[row][col + s] - z[row][col - s]) / (2 s R cos(phi) dlambda)     east
//
// A row is R dphi = 3.8 km of ground everywhere; a column only R cos(phi) dlambda, which shrinks
// toward the poles. Stepping s = max(1, floor(1 / cos phi)) columns keeps the east-west step
// between half and all of the north-south one, so the slope is measured over two rows (7.6 km)
// at most: that is the baseline the readout names. The first and last rows (at the poles) have no
// slope; the polar height maps cover them anyway.

import { projectToGrid, type Dem } from './dem';
import type { GlobeHeights } from './globe';
import { MOON_RADIUS_KM } from './types';

const R_M = MOON_RADIUS_KM * 1000;
const DEG = 180 / Math.PI;

/** The Slope map layer's colour ramp runs from level (0) to this many degrees and steeper. */
export const SLOPE_RAMP_MAX_DEG = 30;

/**
 * The ground the slope is measured over, metres: the heights one cell either side of the point,
 * so twice dem.json's pixel_m (480 m on the real map).
 */
export function slopeBaselineM(dem: Dem): number {
  return 2 * dem.meta.pixel_m;
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

/** T43: the ground a globe.bin slope is measured over, metres: two rows (7.6 km), the longer of its two steps. */
export function globeSlopeBaselineM(globe: GlobeHeights): number {
  return 2 * globe.rowSpacingM;
}

/** Columns a globe.bin slope steps east and west at a row: at least 1, and never more ground than a row. */
function globeStep(globe: GlobeHeights, row: number): { step: number; cosLat: number } {
  const lat = (90 - ((row + 0.5) * 180) / globe.meta.height) * (Math.PI / 180);
  const cosLat = Math.cos(lat);
  return { step: Math.min(globe.meta.width >> 2, Math.max(1, Math.floor(1 / cosLat))), cosLat };
}

/**
 * The height gradient at one globe.bin cell, [east, north], metres of height per metre of ground.
 * Null on the first and last row.
 */
export function globeCellGradient(globe: GlobeHeights, row: number, col: number): [number, number] | null {
  const { width, height } = globe.meta;
  if (!Number.isInteger(row) || row < 1 || row > height - 2) return null;
  const { step, cosLat } = globeStep(globe, row);
  const dLon = (2 * Math.PI) / width;
  const east = (globe.cell(row, col + step) - globe.cell(row, col - step)) / (2 * step * R_M * cosLat * dLon);
  const north = (globe.cell(row - 1, col) - globe.cell(row + 1, col)) / (2 * globe.rowSpacingM);
  return [east, north];
}

/**
 * Slope on globe.bin at a latitude and longitude, degrees from level: the gradients of the four
 * cell centres round the point, blended bilinearly. Null within half a row of a pole.
 */
export function globeSlopeAt(globe: GlobeHeights, lat: number, lon: number): number | null {
  const { width, height } = globe.meta;
  const fr = ((90 - lat) * height) / 180 - 0.5;
  const fc = ((((lon + 180) % 360) + 360) % 360) * width / 360 - 0.5;
  const r0 = Math.floor(fr), c0 = Math.floor(fc);
  const v = fr - r0, u = fc - c0;
  const corners: [number, number, number][] = [
    [r0, c0, (1 - u) * (1 - v)], [r0, c0 + 1, u * (1 - v)],
    [r0 + 1, c0, (1 - u) * v], [r0 + 1, c0 + 1, u * v],
  ];
  let gx = 0, gy = 0;
  for (const [r, c, w] of corners) {
    if (w <= 1e-12) continue;
    const g = globeCellGradient(globe, r, c);
    if (!g) return null;
    gx += g[0] * w;
    gy += g[1] * w;
  }
  return Math.atan(Math.hypot(gx, gy)) * DEG;
}
