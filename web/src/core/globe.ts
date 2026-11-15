// The whole-Moon height grid (globe.bin) and the north cap (north.bin), contract section 2.
// Pure functions: no DOM, no network. web/src/scene/globeHeights.ts fetches the files, once for
// every view that uses them, and re-exports this reader (it lived there until T43).
//
// The pictures (3D globe, 2D map) read the cell holding a point (heightAt). T43's numbers, the
// height and slope map layers and the readout's slope line, read heightBilinear and slope.ts.

import { parseDem, type Dem, type DemMeta } from './dem';
import { MOON_RADIUS_KM } from './types';

export type GlobeMeta = {
  width: number;         // cells around the equator; column 0 starts at longitude -180
  height: number;        // cells from pole to pole; row 0 starts at 90 N
  height_scale: number;  // metres = value * height_scale
  source: string;
};

export type GlobeHeights = {
  meta: GlobeMeta;
  /** Lowest and highest cell, metres above the R sphere. */
  range: [number, number];
  /** North-south distance between neighbouring rows, metres (pi R / height: 3.8 km on the real grid). */
  rowSpacingM: number;
  /** Height of the cell at a row and column, metres. Columns wrap; rows stop at the poles. */
  cell(row: number, col: number): number;
  /** Height of the cell holding a point, metres (the pictures use this). */
  heightAt(lat: number, lon: number): number;
  /** Height between the four cell centres round a point, metres (the numbers use this). */
  heightBilinear(lat: number, lon: number): number;
};

/** Builds the grid from its two files. No network: tests call this with made-up grids. */
export function parseGlobe(meta: GlobeMeta, buffer: ArrayBuffer): GlobeHeights {
  const { width, height, height_scale: scale } = meta;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error('globe.json: "width" and "height" must be whole numbers, 2 or more');
  }
  const count = width * height;
  if (buffer.byteLength < count * 2) {
    throw new Error(`globe.bin: ${buffer.byteLength} bytes, expected ${count * 2}`);
  }
  // Little-endian int16 in the file, read through a DataView so any machine gets it right.
  const view = new DataView(buffer);
  const data = new Int16Array(count);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < count; i++) {
    const v = data[i] = view.getInt16(i * 2, true);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const cell = (row: number, col: number): number => {
    const r = Math.min(height - 1, Math.max(0, row));
    const c = ((col % width) + width) % width;
    return data[r * width + c] * scale;
  };
  function heightBilinear(lat: number, lon: number): number {
    // Fractional row and column, counted between cell centres.
    const fr = ((90 - lat) * height) / 180 - 0.5;
    const fc = ((lon + 180) * width) / 360 - 0.5;
    const r0 = Math.floor(fr), c0 = Math.floor(fc);
    const v = fr - r0, u = fc - c0;
    const top = cell(r0, c0) * (1 - u) + cell(r0, c0 + 1) * u;
    const bottom = cell(r0 + 1, c0) * (1 - u) + cell(r0 + 1, c0 + 1) * u;
    return top * (1 - v) + bottom * v;
  }
  return {
    meta, range: [min * scale, max * scale], cell, heightBilinear,
    rowSpacingM: (Math.PI * MOON_RADIUS_KM * 1000) / height,
    heightAt: (lat, lon) => cell(Math.floor((90 - lat) * height / 180), Math.floor((lon + 180) * width / 360)),
  };
}

/**
 * The north cap's height grid (north.bin + north.json) as a height map of mirrored latitudes:
 * its grid is the mirror image of dem.bin's, so the south-pole code reads it unchanged when every
 * latitude is negated. Ask it for (-lat, lon).
 */
export function parseNorth(meta: DemMeta, buffer: ArrayBuffer): Dem {
  if (!(meta.min_lat > 0)) throw new Error('north.json: "min_lat" must be a northern latitude');
  return parseDem({ ...meta, min_lat: -meta.min_lat }, buffer);
}
