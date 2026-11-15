// Map layers (spec F14) over the whole Moon (T43, SPEC section 6). Pure functions: no DOM, no
// network. web/src/ui/layers/ fetches the files and draws them.
//
// Five layers (LAYER_KEYS). Each takes its value from the finest source that reaches a point
// (contract section 2, "Which source applies where"), and layerAt says which source that was:
//
// - sun, earth, psr: the LOLA team's polar illumination maps poleward of 80 degrees (T14 south,
//   T43 north), resampled by data-prep/make_layers.py onto a 480 m polar stereographic grid per
//   pole; elsewhere a smooth Moon (data-prep/make_layers_global.py, 0.5 degrees a cell), where
//   the never-lit layer is 0, as a sphere has no permanent shadow.
// - height, slope: dem.bin south of 80 S, north.bin north of 80 N, globe.bin elsewhere.
//
// Polar grids: the projection of dem.bin (contract section 2) for the south, and its mirror image
// about the equator for the north (as north.bin), `size` cells a side, `pixel_m` per cell, cell
// (row 0, col 0) centred at (x_min_m, y_max_m). One byte a cell, row by row from the top; value =
// byte * value_scale, 0..1. The smooth grid is laid out like globe.bin, one byte a cell.

import type { Dem } from './dem';
import type { GlobeHeights } from './globe';
import type { Pole } from './projection';
import { globeSlopeAt, globeSlopeBaselineM, slopeAt, slopeBaselineM } from './slope';
import { MOON_RADIUS_KM } from './types';

/** Every map layer. A test runs every one of them over the whole Moon, so a new key is covered. */
export type LayerKey = 'sun' | 'earth' | 'psr' | 'height' | 'slope';
export const LAYER_KEYS: readonly LayerKey[] = ['sun', 'earth', 'psr', 'height', 'slope'];

/** The layers that come from files of their own (the LOLA polar maps). */
export type LayerName = 'sun' | 'earth' | 'psr';
export const LAYER_NAMES: readonly LayerName[] = ['sun', 'earth', 'psr'];
/** The layers with a smooth-Moon file (a smooth Moon's never-lit layer is 0 everywhere). */
export type SmoothName = 'sun' | 'earth';
export const SMOOTH_NAMES: readonly SmoothName[] = ['sun', 'earth'];
const POLES: readonly Pole[] = ['south', 'north'];

export type GridGeometry = { size: number; pixel_m: number; x_min_m: number; y_max_m: number };

export type PolarGrid = GridGeometry & {
  pole: Pole;
  /** The grid applies poleward of this latitude: -80 south, 80 north. */
  min_lat: number;
  files: Record<LayerName, string>;
  products: Record<LayerName, string>;
};

export type LayersMeta = {
  value_scale: number;
  max_byte: number;
  polar: Record<Pole, PolarGrid>;
  meanings: Record<LayerName, string>;
  source: string;
  product_page: string;
  citation: string;
};

export type SmoothMeta = {
  width: number;
  height: number;
  value_scale: number;
  max_byte: number;
  start: string;
  end: string;
  step_s: number;
  files: Record<SmoothName, string>;
  meanings: Record<SmoothName, string>;
  source: string;
};

export type Layer = {
  name: LayerName;
  grid: PolarGrid;
  meta: LayersMeta;
  /** The raw bytes, row by row from the top. */
  bytes: Uint8Array;
  /** True when the grid applies at the point: poleward of its min_lat and within its cell centres. */
  covers(lat: number, lon: number): boolean;
  /** 0..1, bilinear between cell centres; null where the grid does not apply. */
  valueAt(lat: number, lon: number): number | null;
  /** 0..1 at a cell. */
  cell(row: number, col: number): number;
};

export type SmoothLayer = {
  name: SmoothName;
  meta: SmoothMeta;
  bytes: Uint8Array;
  /** 0..1, bilinear between cell centres; longitude wraps, rows stop at the poles. */
  valueAt(lat: number, lon: number): number;
};

const R_M = MOON_RADIUS_KM * 1000;
const RAD = Math.PI / 180;
const EDGE = 1e-6;

/** Contract projection, in fractional cells of a polar grid (south unless the grid says north). */
export function gridPoint(
  grid: GridGeometry & { pole?: Pole }, lat: number, lon: number,
): { col: number; row: number } {
  // The north grid is the south one's mirror image about the equator: c = 90 - lat.
  const c = grid.pole === 'north' ? 90 - lat : 90 + lat;
  const r = 2 * R_M * Math.tan((c / 2) * RAD);
  const x = r * Math.sin(lon * RAD);
  const y = r * Math.cos(lon * RAD);
  return { col: (x - grid.x_min_m) / grid.pixel_m, row: (grid.y_max_m - y) / grid.pixel_m };
}

/** The inverse: latitude and longitude of a (fractional) cell. */
export function gridLatLon(
  grid: GridGeometry & { pole?: Pole }, row: number, col: number,
): { lat: number; lon: number } {
  const x = grid.x_min_m + col * grid.pixel_m;
  const y = grid.y_max_m - row * grid.pixel_m;
  const r = Math.hypot(x, y);
  const fromPole = (2 * Math.atan(r / (2 * R_M))) / RAD;
  return { lat: grid.pole === 'north' ? 90 - fromPole : fromPole - 90, lon: Math.atan2(x, y) / RAD };
}

/** Whether a polar grid applies at a point: poleward of its min_lat and within its cell centres. */
export function polarCovers(grid: PolarGrid, lat: number, lon: number): boolean {
  if (grid.pole === 'north' ? !(lat >= grid.min_lat) : !(lat <= grid.min_lat)) return false;
  const p = gridPoint(grid, lat, lon);
  const last = grid.size - 1;
  return p.col >= -EDGE && p.col <= last + EDGE && p.row >= -EDGE && p.row <= last + EDGE;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkFiles(where: string, files: unknown, names: readonly string[]): void {
  const f = files as Record<string, unknown> | undefined;
  for (const n of names) {
    if (!f || typeof f[n] !== 'string') throw new Error(`${where}: layer "${n}" has no file`);
  }
}

/** Checks layers.json and returns it typed, each polar grid told its pole; throws with the first problem found. */
export function readLayersMeta(json: unknown): LayersMeta {
  if (!json || typeof json !== 'object') throw new Error('layers.json: not a JSON object');
  const m = json as Record<string, unknown>;
  for (const k of ['value_scale', 'max_byte']) {
    if (!isNum(m[k])) throw new Error(`layers.json: "${k}" must be a number`);
  }
  if (!((m.value_scale as number) > 0)) throw new Error('layers.json: "value_scale" must be above 0');
  const polar = m.polar as Record<string, Record<string, unknown>> | undefined;
  const out: Partial<Record<Pole, PolarGrid>> = {};
  for (const pole of POLES) {
    const g = polar?.[pole];
    const where = `layers.json: polar.${pole}`;
    if (!g || typeof g !== 'object') throw new Error(`${where} is missing`);
    for (const k of ['size', 'pixel_m', 'x_min_m', 'y_max_m', 'min_lat']) {
      if (!isNum(g[k])) throw new Error(`${where}: "${k}" must be a number`);
    }
    if (!Number.isInteger(g.size) || (g.size as number) < 2) throw new Error(`${where}: "size" must be a whole number, 2 or more`);
    if (!((g.pixel_m as number) > 0)) throw new Error(`${where}: "pixel_m" must be above 0`);
    if (pole === 'south' ? !((g.min_lat as number) < 0) : !((g.min_lat as number) > 0)) {
      throw new Error(`${where}: "min_lat" must be a ${pole}ern latitude`);
    }
    checkFiles(where, g.files, LAYER_NAMES);
    out[pole] = { ...(g as unknown as PolarGrid), pole };
  }
  return { ...(json as LayersMeta), polar: out as Record<Pole, PolarGrid> };
}

/** Checks smooth.json and returns it typed; throws with the first problem found. */
export function readSmoothMeta(json: unknown): SmoothMeta {
  if (!json || typeof json !== 'object') throw new Error('smooth.json: not a JSON object');
  const m = json as Record<string, unknown>;
  for (const k of ['width', 'height', 'value_scale', 'max_byte']) {
    if (!isNum(m[k])) throw new Error(`smooth.json: "${k}" must be a number`);
  }
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || (m.width as number) < 2 || (m.height as number) < 2) {
    throw new Error('smooth.json: "width" and "height" must be whole numbers, 2 or more');
  }
  if (!((m.value_scale as number) > 0)) throw new Error('smooth.json: "value_scale" must be above 0');
  checkFiles('smooth.json', m.files, SMOOTH_NAMES);
  return json as SmoothMeta;
}

/** Builds one polar layer from its bytes. No network: tests call this with made-up grids. */
export function parseLayer(meta: LayersMeta, pole: Pole, name: LayerName, buffer: ArrayBuffer): Layer {
  const grid = meta.polar[pole];
  const n = grid.size;
  if (buffer.byteLength < n * n) {
    throw new Error(`${grid.files[name]}: ${buffer.byteLength} bytes, expected ${n * n}`);
  }
  const bytes = new Uint8Array(buffer, 0, n * n);
  const last = n - 1;
  const scale = meta.value_scale;
  const cell = (row: number, col: number): number => bytes[row * n + col] * scale;

  function valueAt(lat: number, lon: number): number | null {
    if (!polarCovers(grid, lat, lon)) return null;
    const p = gridPoint(grid, lat, lon);
    const col = Math.min(Math.max(p.col, 0), last);
    const row = Math.min(Math.max(p.row, 0), last);
    const c0 = Math.min(Math.floor(col), last - 1);
    const r0 = Math.min(Math.floor(row), last - 1);
    const u = col - c0;
    const v = row - r0;
    const top = cell(r0, c0) * (1 - u) + cell(r0, c0 + 1) * u;
    const bottom = cell(r0 + 1, c0) * (1 - u) + cell(r0 + 1, c0 + 1) * u;
    return top * (1 - v) + bottom * v;
  }

  return { name, grid, meta, bytes, covers: (lat, lon) => polarCovers(grid, lat, lon), valueAt, cell };
}

/** Builds one smooth-Moon layer from its bytes. No network: tests call this with made-up grids. */
export function parseSmooth(meta: SmoothMeta, name: SmoothName, buffer: ArrayBuffer): SmoothLayer {
  const { width: w, height: h, value_scale: scale } = meta;
  if (buffer.byteLength < w * h) throw new Error(`${meta.files[name]}: ${buffer.byteLength} bytes, expected ${w * h}`);
  const bytes = new Uint8Array(buffer, 0, w * h);
  const cell = (row: number, col: number): number =>
    bytes[Math.min(h - 1, Math.max(0, row)) * w + (((col % w) + w) % w)] * scale;
  function valueAt(lat: number, lon: number): number {
    const fr = ((90 - lat) * h) / 180 - 0.5;
    const fc = ((lon + 180) * w) / 360 - 0.5;
    const r0 = Math.floor(fr), c0 = Math.floor(fc);
    const v = fr - r0, u = fc - c0;
    const top = cell(r0, c0) * (1 - u) + cell(r0, c0 + 1) * u;
    const bottom = cell(r0 + 1, c0) * (1 - u) + cell(r0 + 1, c0 + 1) * u;
    return top * (1 - v) + bottom * v;
  }
  return { name, meta, bytes, valueAt };
}

// --- One value and source anywhere ---------------------------------------------------------------

/** Whatever of the layers' files is loaded. A missing piece makes the points that need it null. */
export type LayerInputs = {
  /** layers.json: where the polar grids apply. */
  layers?: LayersMeta | null;
  polar?: Partial<Record<Pole, Partial<Record<LayerName, Layer>>>>;
  smooth?: Partial<Record<SmoothName, SmoothLayer>>;
  /** The south-pole height map (dem.bin). */
  dem?: Dem | null;
  /** The north cap (north.bin, through parseNorth: latitudes mirrored). */
  north?: Dem | null;
  globe?: GlobeHeights | null;
};

/** Where a layer's value at a point comes from (contract section 2, "Which source applies where"). */
export type LayerSourceId = 'lola-south' | 'lola-north' | 'smooth' | 'dem-south' | 'dem-north' | 'globe';
export type LayerSource = {
  id: LayerSourceId;
  /** Metres: the size of the cells the value comes from; for slope the distance it is measured over. Null for the smooth never-lit layer. */
  cellM: number | null;
};
/** Value 0..1 for sun, earth and psr; metres above the R sphere for height; degrees from level for slope. */
export type LayerPoint = { value: number; source: LayerSource };

// layerValueAt runs for every pixel of a layer's picture, so it allocates nothing: the source of
// the last value is left here for layerAt.
let lastSource: LayerSourceId = 'smooth';

function fileLayerValue(key: LayerName, lat: number, lon: number, inputs: LayerInputs): number {
  const meta = inputs.layers;
  if (!meta) return Number.NaN;
  const pole: Pole = lat < 0 ? 'south' : 'north';
  if (polarCovers(meta.polar[pole], lat, lon)) {
    const layer = inputs.polar?.[pole]?.[key];
    lastSource = pole === 'south' ? 'lola-south' : 'lola-north';
    return layer ? (layer.valueAt(lat, lon) ?? Number.NaN) : Number.NaN;
  }
  lastSource = 'smooth';
  if (key === 'psr') return 0;
  const smooth = inputs.smooth?.[key];
  return smooth ? smooth.valueAt(lat, lon) : Number.NaN;
}

function heightValue(slope: boolean, lat: number, lon: number, inputs: LayerInputs): number {
  const { dem, north, globe } = inputs;
  // A polar point its grid can't answer (an edge cell, nodata) takes the whole-Moon value.
  if (lat < 0 && dem && dem.covers(lat, lon)) {
    const v = slope ? slopeAt(dem, lat, lon) : dem.heightAt(lat, lon);
    if (v !== null) { lastSource = 'dem-south'; return v; }
  }
  if (lat > 0 && north && north.covers(-lat, lon)) {
    const v = slope ? slopeAt(north, -lat, lon) : north.heightAt(-lat, lon);
    if (v !== null) { lastSource = 'dem-north'; return v; }
  }
  if (globe) {
    const v = slope ? globeSlopeAt(globe, lat, lon) : globe.heightBilinear(lat, lon);
    if (v !== null) { lastSource = 'globe'; return v; }
  }
  return Number.NaN;
}

/** A layer's value at a point, NaN where a file it needs is not loaded. Allocates nothing (one call a pixel). */
export function layerValueAt(key: LayerKey, lat: number, lon: number, inputs: LayerInputs): number {
  switch (key) {
    case 'sun': case 'earth': case 'psr': return fileLayerValue(key, lat, lon, inputs);
    case 'height': return heightValue(false, lat, lon, inputs);
    case 'slope': return heightValue(true, lat, lon, inputs);
    default: {
      const never: never = key;
      throw new Error(`no layer "${String(never)}"`);
    }
  }
}

function cellOf(key: LayerKey, id: LayerSourceId, inputs: LayerInputs): number | null {
  switch (id) {
    case 'lola-south': return inputs.layers!.polar.south.pixel_m;
    case 'lola-north': return inputs.layers!.polar.north.pixel_m;
    case 'smooth': {
      const s = key === 'sun' || key === 'earth' ? inputs.smooth?.[key] : undefined;
      return s ? (Math.PI * R_M) / s.meta.height : null;
    }
    case 'dem-south': return key === 'slope' ? slopeBaselineM(inputs.dem!) : inputs.dem!.meta.pixel_m;
    case 'dem-north': return key === 'slope' ? slopeBaselineM(inputs.north!) : inputs.north!.meta.pixel_m;
    case 'globe': return key === 'slope' ? globeSlopeBaselineM(inputs.globe!) : inputs.globe!.rowSpacingM;
  }
}

/**
 * The one function for a layer anywhere on the Moon: its value at a point and the source it comes
 * from. Null only where a file the point needs is not in `inputs`.
 */
export function layerAt(key: LayerKey, lat: number, lon: number, inputs: LayerInputs): LayerPoint | null {
  const value = layerValueAt(key, lat, lon, inputs);
  if (!Number.isFinite(value)) return null;
  const id = lastSource;
  return { value, source: { id, cellM: cellOf(key, id, inputs) } };
}

/** The latitudes where a layer's polar sources give way to its whole-Moon one, for the seam line. */
export function seamLats(key: LayerKey, inputs: LayerInputs): number[] {
  if (key === 'height' || key === 'slope') {
    const out: number[] = [];
    if (inputs.dem) out.push(inputs.dem.meta.min_lat);
    if (inputs.north) out.push(-inputs.north.meta.min_lat);   // stored mirrored (parseNorth)
    return out;
  }
  const m = inputs.layers;
  return m ? [m.polar.south.min_lat, m.polar.north.min_lat] : [];
}

const demRanges = new WeakMap<Dem, [number, number]>();
function demRange(d: Dem): [number, number] {
  let r = demRanges.get(d);
  if (!r) {
    let lo = Infinity, hi = -Infinity;
    const n = d.meta.size;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!d.hasData(row, col)) continue;
        const v = d.cell(row, col);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    r = [lo, hi];
    demRanges.set(d, r);
  }
  return r;
}

/** Lowest and highest height of the loaded height sources, metres: one colour ramp for every view. [0, 1] with none. */
export function heightRange(inputs: LayerInputs): [number, number] {
  let lo = Infinity, hi = -Infinity;
  const take = ([a, b]: [number, number]): void => { if (a < lo) lo = a; if (b > hi) hi = b; };
  if (inputs.dem) take(demRange(inputs.dem));
  if (inputs.north) take(demRange(inputs.north));
  if (inputs.globe) take(inputs.globe.range);
  return lo <= hi ? [lo, hi] : [0, 1];
}
