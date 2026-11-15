// T14 map layers: the LOLA team's south-polar illumination maps, resampled by
// data-prep/make_layers.py onto a 480 m grid (web/public/data/layers/layers.json). Pure functions:
// no DOM, no network. web/src/ui/layers/ fetches the files and draws them.
//
// Grid: the same south polar stereographic projection as dem.bin (contract section 2), `size`
// cells a side, `pixel_m` per cell, cell (row 0, col 0) centred at (x_min_m, y_max_m). One byte a
// cell, row by row from the top; value = byte * value_scale, 0..1.

import { MOON_RADIUS_KM } from './types';

export type LayerName = 'sun' | 'earth' | 'psr';
export const LAYER_NAMES: readonly LayerName[] = ['sun', 'earth', 'psr'];

export type LayersMeta = {
  size: number;
  pixel_m: number;
  x_min_m: number;
  y_max_m: number;
  value_scale: number;
  max_byte: number;
  layers: Record<LayerName, { file: string; product: string; meaning: string }>;
  source: string;
  product_page: string;
  citation: string;
};

export type Layer = {
  name: LayerName;
  meta: LayersMeta;
  /** The raw bytes, row by row from the top. */
  bytes: Uint8Array;
  /** True when the point lies within the grid's cell centres (south of about 80 S). */
  covers(lat: number, lon: number): boolean;
  /** 0..1, bilinear between cell centres; null where the grid does not cover the point. */
  valueAt(lat: number, lon: number): number | null;
  /** 0..1 at a cell. */
  cell(row: number, col: number): number;
};

const R_M = MOON_RADIUS_KM * 1000;
const RAD = Math.PI / 180;

/** Contract projection, in fractional cells of a grid with this origin and spacing. */
export function gridPoint(
  meta: Pick<LayersMeta, 'x_min_m' | 'y_max_m' | 'pixel_m'>, lat: number, lon: number,
): { col: number; row: number } {
  const r = 2 * R_M * Math.tan(((90 + lat) / 2) * RAD);
  const x = r * Math.sin(lon * RAD);
  const y = r * Math.cos(lon * RAD);
  return { col: (x - meta.x_min_m) / meta.pixel_m, row: (meta.y_max_m - y) / meta.pixel_m };
}

/** The inverse: latitude and longitude of a (fractional) cell. */
export function gridLatLon(
  meta: Pick<LayersMeta, 'x_min_m' | 'y_max_m' | 'pixel_m'>, row: number, col: number,
): { lat: number; lon: number } {
  const x = meta.x_min_m + col * meta.pixel_m;
  const y = meta.y_max_m - row * meta.pixel_m;
  const r = Math.hypot(x, y);
  return { lat: (2 * Math.atan(r / (2 * R_M))) / RAD - 90, lon: Math.atan2(x, y) / RAD };
}

/** Checks layers.json and returns it typed; throws with the first problem found. */
export function readLayersMeta(json: unknown): LayersMeta {
  if (!json || typeof json !== 'object') throw new Error('layers.json: not a JSON object');
  const m = json as Record<string, unknown>;
  for (const k of ['size', 'pixel_m', 'x_min_m', 'y_max_m', 'value_scale', 'max_byte']) {
    if (typeof m[k] !== 'number' || !Number.isFinite(m[k] as number)) {
      throw new Error(`layers.json: "${k}" must be a number`);
    }
  }
  if (!Number.isInteger(m.size) || (m.size as number) < 2) {
    throw new Error('layers.json: "size" must be a whole number, 2 or more');
  }
  if (!((m.pixel_m as number) > 0)) throw new Error('layers.json: "pixel_m" must be above 0');
  if (!((m.value_scale as number) > 0)) throw new Error('layers.json: "value_scale" must be above 0');
  const layers = m.layers as Record<string, unknown> | undefined;
  for (const name of LAYER_NAMES) {
    const l = layers?.[name] as Record<string, unknown> | undefined;
    if (!l || typeof l.file !== 'string') throw new Error(`layers.json: layer "${name}" has no file`);
  }
  return json as LayersMeta;
}

/** Builds one layer from its bytes. No network: tests call this with made-up grids. */
export function parseLayer(meta: LayersMeta, name: LayerName, buffer: ArrayBuffer): Layer {
  const n = meta.size;
  if (buffer.byteLength < n * n) {
    throw new Error(`${meta.layers[name].file}: ${buffer.byteLength} bytes, expected ${n * n}`);
  }
  const bytes = new Uint8Array(buffer, 0, n * n);
  const last = n - 1;
  const scale = meta.value_scale;
  const cell = (row: number, col: number): number => bytes[row * n + col] * scale;
  const EDGE = 1e-6;
  const inGrid = (c: number, r: number): boolean =>
    c >= -EDGE && c <= last + EDGE && r >= -EDGE && r <= last + EDGE;

  function covers(lat: number, lon: number): boolean {
    const p = gridPoint(meta, lat, lon);
    return inGrid(p.col, p.row);
  }

  function valueAt(lat: number, lon: number): number | null {
    const p = gridPoint(meta, lat, lon);
    if (!inGrid(p.col, p.row)) return null;
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

  return { name, meta, bytes, covers, valueAt, cell };
}
