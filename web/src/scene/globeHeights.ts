// The whole-Moon height grid (contract section 2: globe.bin + globe.json) and the north cap
// (north.bin + north.json): fetching them, once for every view, and the surface normals that let
// the Sun's light show the relief. The reader itself is core/globe.ts (T43), re-exported here. No
// three.js here, so the flat map (web/src/map/), the map layers and the readout can use it as well
// as the 3D globe. The normals are illustration; the numbers (height and slope layers, the
// readout's slope line) come from core/.

import type { Dem, DemMeta } from '../core/dem';
import { parseGlobe, parseNorth, type GlobeHeights, type GlobeMeta } from '../core/globe';
import { MOON_RADIUS_KM } from '../core/types';
import { afterHeightMap } from '../loadOrder';

export { parseGlobe, parseNorth, type GlobeHeights, type GlobeMeta } from '../core/globe';

const RAD = Math.PI / 180;
/** Slopes are drawn this many times steeper, or relief a few km a cell would barely shade. */
export const GLOBE_RELIEF = 6;

/** Fetches both files from data/ next to the page. Rejects if either is missing or malformed. */
export async function loadGlobe(): Promise<GlobeHeights> {
  const base = import.meta.env.BASE_URL + 'data/';
  const metaRes = await fetch(base + 'globe.json');
  if (!metaRes.ok) throw new Error(`globe.json: HTTP ${metaRes.status}`);
  // A dev server answers a missing file with the page itself, which is not JSON.
  const meta = (await metaRes.json().catch(() => {
    throw new Error('globe.json: missing, or not JSON');
  })) as GlobeMeta;
  const binRes = await fetch(base + 'globe.bin');
  if (!binRes.ok) throw new Error(`globe.bin: HTTP ${binRes.status}`);
  return parseGlobe(meta, await binRes.arrayBuffer());
}

let shared: Promise<GlobeHeights> | null = null;
/**
 * loadGlobe, fetched once however many views ask for it (the 3D globe and the flat map), and
 * only after the height map has finished downloading (issue #96).
 */
export function sharedGlobe(): Promise<GlobeHeights> {
  return shared ??= afterHeightMap().then(loadGlobe);
}

/** Fetches the north cap from data/ next to the page. Rejects if it is missing or malformed. */
export async function loadNorth(): Promise<Dem> {
  const base = import.meta.env.BASE_URL + 'data/';
  const metaRes = await fetch(base + 'north.json');
  if (!metaRes.ok) throw new Error(`north.json: HTTP ${metaRes.status}`);
  const meta = (await metaRes.json().catch(() => {
    throw new Error('north.json: missing, or not JSON');
  })) as DemMeta;
  const binRes = await fetch(base + 'north.bin');
  if (!binRes.ok) throw new Error(`north.bin: HTTP ${binRes.status}`);
  return parseNorth(meta, await binRes.arrayBuffer());
}

let sharedCap: Promise<Dem> | null = null;
/**
 * loadNorth, fetched once for the 3D globe, the flat map's north polar view (issue #112), the
 * map layers and the readout, and only after the height map has finished downloading (issue #96).
 */
export function sharedNorth(): Promise<Dem> {
  return sharedCap ??= afterHeightMap().then(loadNorth);
}

/**
 * A cell's surface normal in the render frame (+X = 90 E, +Y = south, -Z = longitude 0), with
 * slopes `relief` times steeper than measured. Written to `out` as x, y, z.
 */
export function globeNormalAt(globe: GlobeHeights, row: number, col: number, relief: number, out: number[]): void {
  const { width, height } = globe.meta;
  const cellM = Math.PI * MOON_RADIUS_KM * 1000 / height;
  const lat = (90 - (row + 0.5) * 180 / height) * RAD, lon = (-180 + (col + 0.5) * 360 / width) * RAD;
  const cl = Math.cos(lat), sl = Math.sin(lat), cn = Math.cos(lon), sn = Math.sin(lon);
  // One row below and above, except at the poles where there is only one neighbour.
  const rowsApart = Math.min(height - 1, row + 1) - Math.max(0, row - 1);
  // Toward a pole the columns crowd together. Measuring the east slope between next-door
  // columns there, over a fraction of the ground the north slope spans, drew streaks along
  // the meridians; so step as many columns as cover about one row's worth of ground.
  const step = Math.min(width >> 2, Math.max(1, Math.round(1 / cl)));
  const east = (globe.cell(row, col + step) - globe.cell(row, col - step)) / (2 * step * cellM * cl) * relief;
  const north = (globe.cell(row - 1, col) - globe.cell(row + 1, col)) / (rowsApart * cellM) * relief;
  // up - slope east * east - slope north * north, with the three unit vectors written out.
  const x = cl * sn - east * cn + north * sl * sn;
  const y = -sl + north * cl;
  const z = -cl * cn - east * sn - north * sl * cn;
  const n = Math.hypot(x, y, z);
  out[0] = x / n; out[1] = y / n; out[2] = z / n;
}

/**
 * The normal the globe's texture shows at a point: globeNormalAt blended between the four
 * nearest cell centres, as the renderer blends the texture.
 */
export function globeNormalNear(globe: GlobeHeights, lat: number, lon: number, relief: number, out: number[]): void {
  const { width, height } = globe.meta;
  const fr = (90 - lat) * height / 180 - 0.5, fc = (lon + 180) * width / 360 - 0.5;
  const r0 = Math.floor(fr), c0 = Math.floor(fc), wr = fr - r0, wc = fc - c0;
  const n = [0, 0, 0];
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 4; k++) {
    const row = Math.min(height - 1, Math.max(0, r0 + (k >> 1)));
    const col = (((c0 + (k & 1)) % width) + width) % width;
    globeNormalAt(globe, row, col, relief, n);
    const w = ((k >> 1) ? wr : 1 - wr) * ((k & 1) ? wc : 1 - wc);
    x += n[0] * w; y += n[1] * w; z += n[2] * w;
  }
  const len = Math.hypot(x, y, z) || 1;
  out[0] = x / len; out[1] = y / len; out[2] = z / len;
}

/** Cosine and sine of each column's centre longitude, by grid width (the same for every row). */
const lonTables = new Map<number, { cos: Float64Array; sin: Float64Array }>();
function lonTable(width: number): { cos: Float64Array; sin: Float64Array } {
  let t = lonTables.get(width);
  if (!t) {
    t = { cos: new Float64Array(width), sin: new Float64Array(width) };
    for (let col = 0; col < width; col++) {
      const lon = (-180 + (col + 0.5) * 360 / width) * RAD;
      t.cos[col] = Math.cos(lon); t.sin[col] = Math.sin(lon);
    }
    lonTables.set(width, t);
  }
  return t;
}

/**
 * globeNormalAt for every cell of rows `row0` to `row1 - 1`, handed to `put(k, x, y, z)` with `k`
 * the cell's index in the grid. The same numbers as globeNormalAt, but each row's and each
 * column's sines and cosines are worked out once instead of for every cell: the whole grid took
 * about 0.7 s each time globeNormalAt was called cell by cell (issue #118).
 */
export function globeNormalRows(globe: GlobeHeights, relief: number, row0: number, row1: number,
  put: (k: number, x: number, y: number, z: number) => void): void {
  const { width, height } = globe.meta;
  const cellM = Math.PI * MOON_RADIUS_KM * 1000 / height;
  const { cos: cosLon, sin: sinLon } = lonTable(width);
  for (let row = Math.max(0, row0); row < Math.min(height, row1); row++) {
    const lat = (90 - (row + 0.5) * 180 / height) * RAD;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const rowsApart = Math.min(height - 1, row + 1) - Math.max(0, row - 1);
    const step = Math.min(width >> 2, Math.max(1, Math.round(1 / cl)));
    const eastScale = relief / (2 * step * cellM * cl), northScale = relief / (rowsApart * cellM);
    for (let col = 0; col < width; col++) {
      const cn = cosLon[col], sn = sinLon[col];
      const east = (globe.cell(row, col + step) - globe.cell(row, col - step)) * eastScale;
      const north = (globe.cell(row - 1, col) - globe.cell(row + 1, col)) * northScale;
      const x = cl * sn - east * cn + north * sl * sn;
      const y = -sl + north * cl;
      const z = -cl * cn - east * sn - north * sl * cn;
      const n = Math.sqrt(x * x + y * y + z * z);
      put(row * width + col, x / n, y / n, z / n);
    }
  }
}

/**
 * Cells' surface normals for the flat map, three signed bytes a cell (n * 127), in the Moon's
 * own frame as core/ uses it: +X toward longitude 0, +Y toward 90 E, +Z north. Slopes are
 * `relief` times steeper than measured, as on the 3D globe. Only rows `row0` to `row1 - 1` are
 * worked out, into `out` (a new array for the whole grid when none is given): a polar map needs
 * only the rows near its pole.
 */
export function globeSlopes(globe: GlobeHeights, relief = GLOBE_RELIEF, row0 = 0, row1 = globe.meta.height,
  out: Int8Array = new Int8Array(globe.meta.width * globe.meta.height * 3)): Int8Array {
  globeNormalRows(globe, relief, row0, row1, (k, x, y, z) => {
    // Render frame to Moon frame: +X = 90 E, +Y = south, -Z = longitude 0.
    const o = k * 3;
    out[o] = Math.round(-z * 127); out[o + 1] = Math.round(x * 127); out[o + 2] = Math.round(-y * 127);
  });
  return out;
}
