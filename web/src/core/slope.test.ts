import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDem, type Dem, type DemMeta } from './dem';
import { gridLatLon } from './layers';
import { polarForward, polarInverse } from './projection';
import { parseGlobe } from './globe';
import { cellSlope, globeCellGradient, globeSlopeAt, globeSlopeBaselineM, slopeAt, slopeBaselineM, SLOPE_RAMP_MAX_DEG } from './slope';
import { MOON_RADIUS_KM, type CuratedSite } from './types';

const R_M = MOON_RADIUS_KM * 1000;
const DEG = Math.PI / 180;

/** A small made-up grid: size x size cells of pixel_m, its centre cell at map point (cx, cy). */
function meta(cx: number, cy: number, size = 41, pixel_m = 240, min_lat = -50): DemMeta {
  const half = ((size - 1) / 2) * pixel_m;
  return {
    size, pixel_m, x_min_m: cx - half, y_max_m: cy + half,
    height_scale: 0.2, nodata: -32768, min_lat, source: 'made up for a test',
  };
}

/** Builds the grid from z(x, y) in map metres; values set to null are stored as nodata. */
function grid(m: DemMeta, z: (x: number, y: number, row: number, col: number) => number | null): Dem {
  const buffer = new ArrayBuffer(m.size * m.size * 2);
  const view = new DataView(buffer);
  for (let row = 0; row < m.size; row++) {
    for (let col = 0; col < m.size; col++) {
      const h = z(m.x_min_m + col * m.pixel_m, m.y_max_m - row * m.pixel_m, row, col);
      const v = h === null ? m.nodata : Math.round(h / m.height_scale);
      if (v !== m.nodata && Math.abs(v) > 32767) throw new Error('test height out of int16 range');
      view.setInt16((row * m.size + col) * 2, v, true);
    }
  }
  return parseDem(m, buffer);
}

/** The scale factor k of the projection at a map point: ground metres = map metres / k. */
const k = (x: number, y: number): number => 1 + (Math.hypot(x, y) / (2 * R_M)) ** 2;

/**
 * A plane tilted `deg` degrees on the ground, rising towards map bearing `dirDeg` (0 = grid's +y,
 * 90 = +x), centred on (cx, cy). On the map its gradient is tan(deg) / k, k taken at the centre.
 */
function plane(m: DemMeta, cx: number, cy: number, deg: number, dirDeg: number): Dem {
  const g = Math.tan(deg * DEG) / k(cx, cy);
  const gx = g * Math.sin(dirDeg * DEG), gy = g * Math.cos(dirDeg * DEG);
  return grid(m, (x, y) => gx * (x - cx) + gy * (y - cy));
}

describe('slopeAt', () => {
  it('gives a tilted plane near the pole its slope within 0.1 degrees', () => {
    const m = meta(0, 0, 41, 240, -80);
    for (const [deg, dir] of [[5, 0], [12, 90], [20, 37], [33, 200]]) {
      const dem = plane(m, 0, 0, deg, dir);
      // A point between cells, a few cells from the pole.
      const { lat, lon } = polarInverse(730, -515);
      expect(Math.abs(slopeAt(dem, lat, lon)! - deg)).toBeLessThan(0.1);
      expect(Math.abs(cellSlope(dem, 20, 20)! - deg)).toBeLessThan(0.1);
    }
  });

  it('corrects for the projection\'s scale away from the pole (29 degrees from it, k = 1.067)', () => {
    const cx = 600_000, cy = -670_000;     // about 61 S
    const m = meta(cx, cy);
    expect(k(cx, cy)).toBeGreaterThan(1.06);
    const dem = plane(m, cx, cy, 20, 135);
    const { lat, lon } = polarInverse(cx + 100, cy - 60);
    const s = slopeAt(dem, lat, lon)!;
    expect(Math.abs(s - 20)).toBeLessThan(0.1);
    // Without the correction it would read about 18.8 degrees.
    expect(Math.atan(Math.tan(20 * DEG) / k(cx, cy)) / DEG).toBeLessThan(19);
  });

  it('gives a flat grid 0', () => {
    const m = meta(0, 0, 41, 240, -80);
    const dem = grid(m, () => 1234);
    expect(slopeAt(dem, -89.9, 45)).toBe(0);
    expect(slopeAt(dem, -90, 0)).toBe(0);
    expect(cellSlope(dem, 5, 30)).toBe(0);
  });

  it('gives null, not a number, next to nodata', () => {
    const m = meta(0, 0, 41, 240, -80);
    const dem = grid(m, (_x, _y, row, col) => (row === 20 && col === 20 ? null : 100));
    // The cell itself and its four neighbours have no slope; one further out has.
    expect(cellSlope(dem, 20, 20)).toBeNull();
    expect(cellSlope(dem, 20, 21)).toBeNull();
    expect(cellSlope(dem, 19, 20)).toBeNull();
    expect(cellSlope(dem, 21, 21)).toBe(0);
    expect(cellSlope(dem, 20, 22)).toBe(0);
    // A point between (20, 21) and (20, 22) needs (20, 21): null. One between 21 and 22 doesn't.
    const near = gridLatLon(m, 20, 21.5);
    expect(slopeAt(dem, near.lat, near.lon)).toBeNull();
    const far = gridLatLon(m, 20, 22.5);
    expect(slopeAt(dem, far.lat, far.lon)).toBe(0);
  });

  it('gives null where the height map does not reach: off the grid, its edge, north of min_lat', () => {
    const m = meta(0, 0, 41, 240, -89.99);
    const dem = grid(m, () => 0);
    expect(slopeAt(dem, -80, 0)).toBeNull();               // off the grid
    expect(cellSlope(dem, 0, 10)).toBeNull();              // the edge has no neighbour beyond
    expect(cellSlope(dem, 10, 40)).toBeNull();
    const north = gridLatLon(m, 20, 1.5);                  // in the grid, but north of -89.99
    expect(north.lat).toBeGreaterThan(-89.99);
    expect(slopeAt(dem, north.lat, north.lon)).toBeNull();
  });

  it('measures over two cells of the grid and ramps to 30 degrees', () => {
    expect(slopeBaselineM(grid(meta(0, 0, 5, 240, -80), () => 0))).toBe(480);
    expect(SLOPE_RAMP_MAX_DEG).toBe(30);
  });
});

// Real data (skips while dem.json is T20's mock): Shackleton's inner wall is steeper than its floor
// and its rim.
const dataFile = (rel: string): string => fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url));
const demMeta = existsSync(dataFile('dem.json'))
  ? (JSON.parse(readFileSync(dataFile('dem.json'), 'utf8')) as DemMeta) : null;
const skip = !demMeta ? 'dem.json is missing' : demMeta.source === 'mock' ? 'dem.json says "source": "mock"' : null;
if (skip) console.log(`slope.test.ts real-data check skipped: ${skip}.`);

describe.skipIf(!!skip)('slopeAt on the real height map', () => {
  it('the point halfway between shackleton-floor and shackleton-rim is steeper than both', () => {
    if (!existsSync(dataFile('dem.bin'))) throw new Error('dem.json is real but dem.bin is not there');
    const bytes = readFileSync(dataFile('dem.bin'));
    const dem = parseDem(demMeta!, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const sites = JSON.parse(readFileSync(dataFile('sites.json'), 'utf8')) as CuratedSite[];
    const byId = (id: string): CuratedSite => {
      const s = sites.find((x) => x.id === id);
      if (!s) throw new Error(`sites.json has no "${id}"`);
      return s;
    };
    const floor = byId('shackleton-floor'), rim = byId('shackleton-rim');
    // Halfway on the map (straight across the crater), not halfway in latitude and longitude.
    const a = polarForward(floor.lat, floor.lon), b = polarForward(rim.lat, rim.lon);
    const mid = polarInverse((a.x + b.x) / 2, (a.y + b.y) / 2);
    const sFloor = slopeAt(dem, floor.lat, floor.lon)!;
    const sRim = slopeAt(dem, rim.lat, rim.lon)!;
    const sMid = slopeAt(dem, mid.lat, mid.lon)!;
    console.log(`Shackleton slope: floor ${sFloor.toFixed(1)}°, wall ${sMid.toFixed(1)}°, rim ${sRim.toFixed(1)}°`);
    expect(sMid).toBeGreaterThan(sFloor);
    expect(sMid).toBeGreaterThan(sRim);
  });
});

// --- T43: slope on the whole-Moon grid (globe.bin) ----------------------------------------------

describe('globeSlopeAt (T43)', () => {
  const W = 360, H = 180;
  /** A made-up globe.bin, heights z(lat, lon) in metres (stored 1 m a step). */
  const globe = (z: (lat: number, lon: number) => number) => {
    const view = new DataView(new ArrayBuffer(W * H * 2));
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      view.setInt16((j * W + i) * 2, Math.round(z(90 - (j + 0.5), -180 + (i + 0.5))), true);
    }
    return parseGlobe({ width: W, height: H, height_scale: 1, source: 'test' }, view.buffer);
  };
  const atanDeg = (v: number): number => Math.atan(v) / DEG;

  it('reads a slope rising to the north', () => {
    const g = globe((lat) => 0.01 * R_M * lat * DEG);
    for (const [lat, lon] of [[0.5, 0.5], [40, 100], [-60.2, -33.3]]) {
      expect(globeSlopeAt(g, lat, lon)).toBeCloseTo(atanDeg(0.01), 2);   // heights stored to the metre
    }
  });

  it('reads a slope rising to the east, on ground that shrinks with cos(latitude)', () => {
    // z = b R cos(lat0) lon rises b metres per metre east along latitude lat0.
    for (const lat0 of [0.5, 45.5, 70.5]) {
      const b = 0.005;   // keeps 180 degrees of it inside int16
      const g = globe((_lat, lon) => b * R_M * Math.cos(lat0 * DEG) * lon * DEG);
      expect(globeSlopeAt(g, lat0, 10.5)).toBeCloseTo(atanDeg(b), 2);
      expect(globeCellGradient(g, 90 - lat0 - 0.5, 190)![1]).toBeCloseTo(0, 9);
    }
  });

  it('is level on level ground, null at the poles, and measured over two rows', () => {
    const g = globe(() => 500);
    expect(globeSlopeAt(g, 12.3, 45.6)).toBe(0);
    expect(globeSlopeAt(g, 89.9, 0)).toBeNull();
    expect(globeCellGradient(g, 0, 10)).toBeNull();
    expect(globeCellGradient(g, H - 1, 10)).toBeNull();
    expect(globeSlopeBaselineM(g)).toBeCloseTo((2 * Math.PI * R_M) / H, 6);
  });
});
