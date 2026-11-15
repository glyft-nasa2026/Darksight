// The south-pole height map (contract section 2: dem.bin + dem.json, and dem.pack, the same
// heights packed by the build). A square grid in south polar stereographic projection on a
// sphere of radius R.

import { unpackHeightFile } from './heightPack';
import { MOON_RADIUS_KM } from './types';

export type DemMeta = {
  size: number;          // cells per side
  pixel_m: number;
  x_min_m: number;
  y_max_m: number;
  height_scale: number;  // metres = value * height_scale
  nodata: number;
  min_lat: number;       // northern limit of the data, for example -80
  source: string;        // "mock" for T20's file
};

export type Dem = {
  meta: DemMeta;
  /** True when the point is inside the grid and not north of meta.min_lat. */
  covers(lat: number, lon: number): boolean;
  /** Height in metres above the R sphere, bilinear between cells. 0 outside the grid. */
  heightAt(lat: number, lon: number): number;
  /** Height of one stored cell, metres (row 0 at the top, as in the file). A cell with no data is 0. */
  cell(row: number, col: number): number;
  /** False where the stored cell is `nodata` (or outside the grid), which cell() reads as 0. */
  hasData(row: number, col: number): boolean;
};

const R_M = MOON_RADIUS_KM * 1000;
const RAD = Math.PI / 180;

/**
 * Contract projection: where a latitude and longitude fall in the grid, in fractional cells.
 * A whole-number col and row is exactly on a stored value.
 */
export function projectToGrid(meta: DemMeta, lat: number, lon: number): { col: number; row: number } {
  const r = 2 * R_M * Math.tan(((90 + lat) / 2) * RAD);
  const x = r * Math.sin(lon * RAD);
  const y = r * Math.cos(lon * RAD);
  return { col: (x - meta.x_min_m) / meta.pixel_m, row: (meta.y_max_m - y) / meta.pixel_m };
}

function checkMeta(meta: DemMeta): void {
  if (!Number.isInteger(meta.size) || meta.size < 2) {
    throw new Error('dem.json: "size" must be a whole number, 2 or more');
  }
  if (!(meta.pixel_m > 0)) throw new Error('dem.json: "pixel_m" must be above 0');
}

/** Builds the height map from its two files. No network: tests call this with made-up grids. */
export function parseDem(meta: DemMeta, buffer: ArrayBuffer): Dem {
  checkMeta(meta);
  const count = meta.size * meta.size;
  if (buffer.byteLength < count * 2) {
    throw new Error(`dem.bin: ${buffer.byteLength} bytes, expected ${count * 2}`);
  }

  // The file is little-endian int16. Every browser we target is little-endian too, so the
  // buffer is used in place (no copy of up to 15 MB). A big-endian machine gets a swapped copy.
  let data: Int16Array;
  const hostIsLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (hostIsLittleEndian) {
    data = new Int16Array(buffer, 0, count);
  } else {
    data = new Int16Array(count);
    const view = new DataView(buffer);
    for (let i = 0; i < count; i++) data[i] = view.getInt16(i * 2, true);
  }
  return demFromHeights(meta, data);
}

/**
 * Builds the height map from the stored values already in memory, row 0 first (the packed file,
 * unpacked). parseDem reads dem.bin into the same form.
 */
export function demFromHeights(meta: DemMeta, data: Int16Array): Dem {
  checkMeta(meta);
  const size = meta.size;
  if (data.length < size * size) throw new Error(`dem: ${data.length} heights, expected ${size * size}`);

  const { height_scale: scale, nodata } = meta;
  const last = size - 1;

  // A cell with no data counts as height 0, so one hole can't poison its neighbours.
  const cell = (row: number, col: number): number => {
    const v = data[row * size + col];
    return v === nodata ? 0 : v * scale;
  };

  // A point exactly on the outer row or column can land a hair outside after the projection's
  // rounding, so the edge gets a tolerance far smaller than a cell.
  const EDGE = 1e-6;
  function inGrid(col: number, row: number): boolean {
    return col >= -EDGE && col <= last + EDGE && row >= -EDGE && row <= last + EDGE;
  }

  function covers(lat: number, lon: number): boolean {
    if (!(lat <= meta.min_lat)) return false;
    const { col, row } = projectToGrid(meta, lat, lon);
    return inGrid(col, row);
  }

  function heightAt(lat: number, lon: number): number {
    const p = projectToGrid(meta, lat, lon);
    if (!inGrid(p.col, p.row)) return 0;
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

  function hasData(row: number, col: number): boolean {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row > last || col > last) return false;
    return data[row * size + col] !== nodata;
  }

  return { meta, covers, heightAt, cell, hasData };
}

/**
 * The stored values from `dem.pack` as downloaded (contract section 2), ready for
 * demFromHeights. Null when the bytes are not gzip at all: a host that answers a missing file
 * with the page itself. Throws when they are gzip but not this grid's packed heights. Unpacks a
 * slice of rows at a time, so the page can paint in between (core/heightPack.ts).
 */
export function unpackDemFile(meta: DemMeta, file: Uint8Array<ArrayBuffer>): Promise<Int16Array | null> {
  return unpackHeightFile(file, meta.size, meta.size, 'dem.pack');
}

/**
 * Downloads and unpacks `dem.pack`. Null when there is none to use (the dev server, or a data
 * set without one) or it fails, and loadDem then loads dem.bin.
 */
async function loadPacked(url: string, meta: DemMeta, onProgress?: (fraction: number) => void): Promise<Int16Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // Progress from Content-Length, capped, since a host that compresses the file again reports
    // fewer bytes than arrive; without one, from about the packed size of real terrain.
    const expected = Number(res.headers.get('content-length')) || (meta.size * meta.size * 2) / 3;
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body?.getReader();
    if (!reader) {
      chunks.push(new Uint8Array(await res.arrayBuffer()));
      received = chunks[0].length;
    } else {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress?.(Math.min(0.99, received / expected));
      }
    }
    const file = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      file.set(chunk, at);
      at += chunk.length;
    }
    return await unpackDemFile(meta, file);
  } catch (err) {
    console.warn('dem.pack not loaded, loading dem.bin instead:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fetches the height map from data/ next to the page: dem.json, then the packed heights
 * (dem.pack, about a third the size of dem.bin), or dem.bin where there is no packed copy.
 * onProgress gets 0..1 as the heights arrive. Rejects if dem.json or dem.bin is missing or
 * malformed.
 */
export async function loadDem(onProgress?: (fraction: number) => void): Promise<Dem> {
  const base = import.meta.env.BASE_URL + 'data/';
  const metaRes = await fetch(base + 'dem.json');
  if (!metaRes.ok) throw new Error(`dem.json: HTTP ${metaRes.status}`);
  // A dev server answers a missing file with the page itself, which is not JSON.
  const meta = (await metaRes.json().catch(() => {
    throw new Error('dem.json: missing, or not JSON');
  })) as DemMeta;
  checkMeta(meta);

  const heights = await loadPacked(base + 'dem.pack', meta, onProgress);
  if (heights) {
    onProgress?.(1);
    return demFromHeights(meta, heights);
  }

  const binRes = await fetch(base + 'dem.bin');
  if (!binRes.ok) throw new Error(`dem.bin: HTTP ${binRes.status}`);

  // The expected size comes from dem.json, not Content-Length: a host that compresses the
  // file reports the compressed length, which would make the progress wrong.
  const total = meta.size * meta.size * 2;
  const reader = binRes.body?.getReader();
  if (!reader) {
    const whole = await binRes.arrayBuffer();
    onProgress?.(1);
    return parseDem(meta, whole);
  }

  const bytes = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > total) {
      throw new Error(`dem.bin: more than the expected ${total} bytes`);
    }
    bytes.set(value, received);
    received += value.length;
    onProgress?.(received / total);
  }
  if (received < total) throw new Error(`dem.bin: ${received} bytes, expected ${total}`);
  return parseDem(meta, bytes.buffer);
}
