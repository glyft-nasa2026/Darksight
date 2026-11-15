// T14 and T43: the map-layer reader, and layerAt over the whole Moon, on made-up grids and on the
// real files in web/public/data/.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDem, projectToGrid, type Dem, type DemMeta } from './dem';
import { destination } from './geometry';
import { parseGlobe, parseNorth, type GlobeHeights, type GlobeMeta } from './globe';
import {
  gridLatLon, gridPoint, heightRange, LAYER_KEYS, LAYER_NAMES, layerAt, layerValueAt, parseLayer, parseSmooth,
  readLayersMeta, readSmoothMeta, seamLats, SMOOTH_NAMES, type LayerInputs, type LayerName, type LayersMeta,
  type SmoothMeta,
} from './layers';
import type { Pole } from './projection';
import type { CuratedSite } from './types';

const files = (prefix: string) => ({ sun: `layers/${prefix}sun.bin`, earth: `layers/${prefix}earth.bin`, psr: `layers/${prefix}psr.bin` });

/** A layers.json with two small polar grids that reach 80 degrees. */
function layersMeta(size = 4, pixel_m = 480, half = ((size - 1) / 2) * pixel_m): LayersMeta {
  const grid = (pole: Pole, min_lat: number, prefix: string) => ({
    pole, size, pixel_m, x_min_m: -half, y_max_m: half, min_lat, files: files(prefix), products: files(prefix),
  });
  return readLayersMeta({
    value_scale: 0.004, max_byte: 250,
    polar: { south: grid('south', -80, ''), north: grid('north', 80, 'north_') },
    meanings: { sun: 'x', earth: 'x', psr: 'x' }, source: 'test', product_page: 'test', citation: 'test',
  });
}

const META = layersMeta();

describe('polar layer grid', () => {
  it('uses the same projection as dem.bin in the south', () => {
    const dem = { size: 2534, pixel_m: 240, x_min_m: -304080, y_max_m: 304080 } as DemMeta;
    for (const [lat, lon] of [[-89.67, 129.78], [-85, -45], [-81, 170], [-90, 0]]) {
      expect(gridPoint(dem, lat, lon).col).toBeCloseTo(projectToGrid(dem, lat, lon).col, 9);
      expect(gridPoint(dem, lat, lon).row).toBeCloseTo(projectToGrid(dem, lat, lon).row, 9);
    }
  });

  it('uses the mirror image in the north, as north.bin', () => {
    const north = { ...META.polar.north };
    for (const [lat, lon] of [[89.5, 30], [85, -120]]) {
      const n = gridPoint(north, lat, lon), s = gridPoint(META.polar.south, -lat, lon);
      expect(n.col).toBeCloseTo(s.col, 9);
      expect(n.row).toBeCloseTo(s.row, 9);
      const back = gridLatLon(north, n.row, n.col);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it('turns cells back into latitude and longitude', () => {
    const p = gridPoint(META.polar.south, -89.9, 60);
    const ll = gridLatLon(META.polar.south, p.row, p.col);
    expect(ll.lat).toBeCloseTo(-89.9, 9);
    expect(ll.lon).toBeCloseTo(60, 9);
  });

  it('reads a value bilinearly and returns null off the grid', () => {
    const bytes = new Uint8Array(16);
    bytes[1 * 4 + 1] = 250; // value 1.0 at row 1, col 1, which is x = -240, y = 240
    const layer = parseLayer(META, 'south', 'sun', bytes.buffer);
    expect(layer.cell(1, 1)).toBe(1);
    const p = gridLatLon(META.polar.south, 1, 1);
    expect(layer.valueAt(p.lat, p.lon)).toBeCloseTo(1, 9);
    const half = gridLatLon(META.polar.south, 1, 1.5);
    expect(layer.valueAt(half.lat, half.lon)).toBeCloseTo(0.5, 6);
    expect(layer.valueAt(-80, 0)).toBeNull();
    expect(layer.covers(-80, 0)).toBe(false);
    // The north grid applies in the north only.
    const north = parseLayer(META, 'north', 'sun', bytes.buffer);
    expect(north.valueAt(-p.lat, p.lon)).toBeCloseTo(1, 9);
    expect(north.valueAt(p.lat, p.lon)).toBeNull();
  });

  it('applies only poleward of min_lat, even where the square grid reaches further', () => {
    // A grid reaching 340 km from the pole (79 degrees) along its axes: 80 is still where it stops.
    const wide = layersMeta(21, 34000);
    const layer = parseLayer(wide, 'south', 'sun', new Uint8Array(441).fill(100).buffer);
    expect(layer.valueAt(-80.5, 45)).toBeCloseTo(0.4, 9);
    expect(layer.valueAt(-79.5, 45)).toBeNull();
  });

  it('rejects a broken layers.json or a short file', () => {
    expect(() => readLayersMeta(null)).toThrow(/object/);
    expect(() => readLayersMeta({ ...META, value_scale: 0 })).toThrow(/value_scale/);
    expect(() => readLayersMeta({ ...META, polar: { south: META.polar.south } })).toThrow(/north/);
    expect(() => readLayersMeta({ ...META, polar: { ...META.polar, south: { ...META.polar.south, size: 1.5 } } })).toThrow(/size/);
    expect(() => readLayersMeta({ ...META, polar: { ...META.polar, north: { ...META.polar.north, min_lat: -80 } } })).toThrow(/min_lat/);
    expect(() => readLayersMeta({ ...META, polar: { ...META.polar, south: { ...META.polar.south, files: { sun: 'x' } } } })).toThrow(/earth/);
    expect(() => parseLayer(META, 'south', 'sun', new ArrayBuffer(3))).toThrow(/expected 16/);
  });
});

const SMOOTH: SmoothMeta = {
  width: 8, height: 4, value_scale: 0.004, max_byte: 250, start: '2020-01-01T00:00:00Z', end: '2038-08-08T00:00:00Z',
  step_s: 3600, files: { sun: 'layers/smooth_sun.bin', earth: 'layers/smooth_earth.bin' },
  meanings: { sun: 'x', earth: 'x' }, source: 'test',
};

describe('smooth-Moon layer grid', () => {
  it('reads cell centres exactly, blends between them and wraps at 180 degrees', () => {
    const bytes = new Uint8Array(32);
    bytes[1 * 8 + 0] = 250;   // row 1 (lat 22.5), column 0 (lon -157.5)
    bytes[1 * 8 + 7] = 0;     // column 7 (lon 157.5)
    const s = parseSmooth(SMOOTH, 'earth', bytes.buffer);
    expect(s.valueAt(22.5, -157.5)).toBeCloseTo(1, 9);
    expect(s.valueAt(22.5, 180)).toBeCloseTo(0.5, 9);
    expect(s.valueAt(22.5, -180)).toBeCloseTo(0.5, 9);
    expect(s.valueAt(90, -157.5)).toBeCloseTo(0, 9);   // row 0, which is 0
  });

  it('rejects a broken smooth.json or a short file', () => {
    expect(() => readSmoothMeta({ ...SMOOTH, width: 0.5 })).toThrow(/width/);
    expect(() => readSmoothMeta({ ...SMOOTH, files: { sun: 'x' } })).toThrow(/earth/);
    expect(() => parseSmooth(SMOOTH, 'sun', new ArrayBuffer(3))).toThrow(/expected 32/);
    expect(readSmoothMeta(SMOOTH)).toBe(SMOOTH);
  });
});

// --- Made-up whole-Moon inputs --------------------------------------------------------------------

/** A polar height map reaching 80 degrees: size cells of pixel_m, heights from z(x, y). */
function capDem(min_lat: number, z: (x: number, y: number) => number, size = 103, pixel_m = 6000): Dem {
  const half = ((size - 1) / 2) * pixel_m;
  const meta: DemMeta = {
    size, pixel_m, x_min_m: -half, y_max_m: half, height_scale: 0.5, nodata: -32768, min_lat, source: 'made up',
  };
  const view = new DataView(new ArrayBuffer(size * size * 2));
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    view.setInt16((row * size + col) * 2, Math.round(z(-half + col * pixel_m, half - row * pixel_m) / 0.5), true);
  }
  return min_lat > 0 ? parseNorth(meta, view.buffer) : parseDem(meta, view.buffer);
}

function madeUpGlobe(width = 72, height = 36): GlobeHeights {
  const meta: GlobeMeta = { width, height, height_scale: 0.5, source: 'made up' };
  const view = new DataView(new ArrayBuffer(width * height * 2));
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    view.setInt16((j * width + i) * 2, Math.round((1000 * Math.sin(i / 5) + 20 * j) / 0.5), true);
  }
  return parseGlobe(meta, view.buffer);
}

/** Every file a layer can need, made up: polar grids reaching 80 degrees, a coarse smooth Moon. */
function madeUpInputs(): LayerInputs {
  const layers = layersMeta(103, 6000);
  const polar: LayerInputs['polar'] = { south: {}, north: {} };
  for (const pole of ['south', 'north'] as const) {
    for (const [i, name] of LAYER_NAMES.entries()) {
      polar[pole]![name] = parseLayer(layers, pole, name, new Uint8Array(103 * 103).fill(50 + 50 * i).buffer);
    }
  }
  const smooth: LayerInputs['smooth'] = {};
  for (const name of SMOOTH_NAMES) {
    const meta = { ...SMOOTH, width: 72, height: 36 };
    smooth[name] = parseSmooth(meta, name, new Uint8Array(72 * 36).fill(name === 'sun' ? 125 : 250).buffer);
  }
  return {
    layers, polar, smooth,
    dem: capDem(-80, (x, y) => 0.01 * x + 0.02 * y),
    north: capDem(80, (x) => -0.03 * x),
    globe: madeUpGlobe(),
  };
}

/** T43 "Done when" line 1: the six points every layer must answer. */
const SIX: [string, number, number][] = [
  ['89 N', 89, 0], ['45 N 90 E', 45, 90], ['0 N 0 E', 0, 0], ['0 N 180 E', 0, 180], ['60 S 120 W', -60, -120], ['89 S', -89, 0],
];

describe('layerAt: every layer over the whole Moon (made-up grids)', () => {
  const inputs = madeUpInputs();

  for (const key of LAYER_KEYS) {
    it(`${key} has a value at each of the six points`, () => {
      for (const [where, lat, lon] of SIX) {
        const p = layerAt(key, lat, lon, inputs);
        expect(p, `${key} at ${where}`).not.toBeNull();
        expect(Number.isFinite(p!.value), `${key} at ${where}`).toBe(true);
        expect(layerValueAt(key, lat, lon, inputs)).toBe(p!.value);
      }
    });
  }

  it('takes the finest source that reaches each point', () => {
    const id = (key: (typeof LAYER_KEYS)[number], lat: number, lon = 0) => layerAt(key, lat, lon, inputs)!.source.id;
    for (const key of ['sun', 'earth', 'psr'] as const) {
      expect(id(key, -89)).toBe('lola-south');
      expect(id(key, 89)).toBe('lola-north');
      expect(id(key, -79.9)).toBe('smooth');
      expect(id(key, 45)).toBe('smooth');
    }
    for (const key of ['height', 'slope'] as const) {
      expect(id(key, -85)).toBe('dem-south');
      expect(id(key, 85)).toBe('dem-north');
      expect(id(key, 79.9)).toBe('globe');
      expect(id(key, -60)).toBe('globe');
    }
  });

  it('gives the polar files\' own values, the smooth ones, and 0 never lit on a smooth Moon', () => {
    expect(layerAt('sun', -89, 0, inputs)!.value).toBeCloseTo(0.2, 9);     // byte 50
    expect(layerAt('earth', 89, 0, inputs)!.value).toBeCloseTo(0.4, 9);    // byte 100
    expect(layerAt('psr', 89, 0, inputs)!.value).toBeCloseTo(0.6, 9);      // byte 150
    expect(layerAt('sun', 0, 0, inputs)!.value).toBeCloseTo(0.5, 9);
    expect(layerAt('earth', 0, 180, inputs)!.value).toBeCloseTo(1, 9);
    expect(layerAt('psr', 45, 90, inputs)).toEqual({ value: 0, source: { id: 'smooth', cellM: null } });
  });

  it('names the cell size each value comes from', () => {
    expect(layerAt('sun', -89, 0, inputs)!.source.cellM).toBe(6000);
    expect(layerAt('sun', 0, 0, inputs)!.source.cellM).toBeCloseTo((Math.PI * 1737400) / 36, 6);
    expect(layerAt('slope', -85, 0, inputs)!.source.cellM).toBe(6000);
    expect(layerAt('slope', 0, 0, inputs)!.source.cellM).toBeCloseTo((Math.PI * 1737400) / 36, 6);
  });

  it('reads the north cap\'s slope the right way round, and the south one\'s', () => {
    // North: z = -0.03 x in north.bin's own metres, so 0.03 m per ground metre (k is near 1).
    expect(layerAt('slope', 89.5, 10, inputs)!.value).toBeCloseTo(Math.atan(0.03) * 180 / Math.PI, 1);
    expect(layerAt('slope', -89.5, 10, inputs)!.value).toBeCloseTo(Math.atan(Math.hypot(0.01, 0.02)) * 180 / Math.PI, 1);
  });

  it('is null where a file the point needs has not loaded, and only there', () => {
    const noNorth = { ...inputs, polar: { south: inputs.polar!.south } };
    expect(layerAt('sun', 89, 0, noNorth)).toBeNull();
    expect(layerAt('sun', -89, 0, noNorth)).not.toBeNull();
    expect(layerAt('sun', 0, 0, { ...inputs, smooth: {} })).toBeNull();
    expect(layerAt('psr', 0, 0, { ...inputs, smooth: {} })!.value).toBe(0);
    expect(layerAt('psr', -89, 0, { polar: inputs.polar })).toBeNull();   // no layers.json: where do the grids apply?
    expect(layerAt('height', 0, 0, { ...inputs, globe: null })).toBeNull();
    expect(layerAt('height', -85, 0, { ...inputs, globe: null })!.source.id).toBe('dem-south');
  });

  it('gives the seams at 80 S and 80 N, and one height ramp over every source', () => {
    for (const key of LAYER_KEYS) expect(seamLats(key, inputs).sort((a, b) => a - b)).toEqual([-80, 80]);
    const [lo, hi] = heightRange(inputs);
    expect(lo).toBeLessThanOrEqual(inputs.globe!.range[0]);
    expect(hi).toBeGreaterThanOrEqual(inputs.globe!.range[1]);
    expect(hi).toBeGreaterThan(9000);   // the south cap reaches 0.02 * 306 km = 6 km, the north 0.03 * 306 km
    expect(heightRange({})).toEqual([0, 1]);
  });
});

// --- Real data ------------------------------------------------------------------------------------

const dataFile = (rel: string): string => fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url));
const readJson = (rel: string): unknown => JSON.parse(readFileSync(dataFile(rel), 'utf8'));
const readBuf = (rel: string): ArrayBuffer => {
  const b = readFileSync(dataFile(rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

function realSkip(): string | null {
  if (!existsSync(dataFile('dem.json'))) return 'web/public/data/dem.json is missing';
  if ((readJson('dem.json') as DemMeta).source === 'mock') return 'dem.json says "source": "mock"';
  // Real data without the layer files is an error, not a reason to skip: these checks would pass by not running.
  for (const f of ['layers/layers.json', 'layers/smooth.json', 'globe.json', 'north.json']) {
    if (!existsSync(dataFile(f))) throw new Error(`web/public/data/${f} is missing beside real data`);
  }
  return null;
}
const skip = realSkip();
if (skip) console.log(`layers.test.ts real-data checks skipped: ${skip}.`);

function realInputs(): LayerInputs {
  const layers = readLayersMeta(readJson('layers/layers.json'));
  const smoothMeta = readSmoothMeta(readJson('layers/smooth.json'));
  const polar: LayerInputs['polar'] = { south: {}, north: {} };
  for (const pole of ['south', 'north'] as const) {
    for (const name of LAYER_NAMES) polar[pole]![name] = parseLayer(layers, pole, name, readBuf(layers.polar[pole].files[name]));
  }
  const smooth: LayerInputs['smooth'] = {};
  for (const name of SMOOTH_NAMES) smooth[name] = parseSmooth(smoothMeta, name, readBuf(smoothMeta.files[name]));
  return {
    layers, polar, smooth,
    dem: parseDem(readJson('dem.json') as DemMeta, readBuf('dem.bin')),
    north: parseNorth(readJson('north.json') as DemMeta, readBuf('north.bin')),
    globe: parseGlobe(readJson('globe.json') as GlobeMeta, readBuf('globe.bin')),
  };
}

describe.skipIf(skip !== null)('real layers (web/public/data)', () => {
  const inputs = skip ? {} : realInputs();
  const layers = inputs.layers!;
  const get = (pole: Pole, name: LayerName) => inputs.polar![pole]![name]!;

  it('has the grids make_layers.py writes, for both poles', () => {
    for (const pole of ['south', 'north'] as const) {
      const g = layers.polar[pole];
      expect([g.size, g.pixel_m, g.x_min_m, g.y_max_m, g.min_lat]).toEqual([1267, 480, -303960, 303960, pole === 'south' ? -80 : 80]);
      for (const name of LAYER_NAMES) expect(get(pole, name).bytes.length).toBe(1267 * 1267);
    }
    expect(layers.citation).toMatch(/Mazarico/);
    expect(layers.polar.north.products.sun).toBe('AVGVISIB_65N_240M_201608');
  });

  it('marks Shackleton\'s floor never lit, with no Sun and no Earth (T14 "Done when")', () => {
    const [lat, lon] = [-89.67, 129.78];
    expect(get('south', 'psr').valueAt(lat, lon)).toBeGreaterThanOrEqual(0.5);
    expect(get('south', 'sun').valueAt(lat, lon)).toBeLessThan(0.02);
    expect(get('south', 'earth').valueAt(lat, lon)).toBeLessThan(0.02);
  });

  it('shows Shackleton\'s rim and the connecting ridge sunlit, never permanently dark', () => {
    for (const [lat, lon] of [[-89.6866, -162.81], [-89.4398, -137.17]]) {
      expect(get('south', 'sun').valueAt(lat, lon)).toBeGreaterThan(0.5);
      // Small shadowed pits sit within a cell of the crest (4 % of the source cells round C1).
      expect(get('south', 'psr').valueAt(lat, lon)).toBeLessThan(0.1);
    }
  });

  it('never has Sun where the cell is wholly permanently shadowed, at either pole', () => {
    for (const pole of ['south', 'north'] as const) {
      const psr = get(pole, 'psr'), sun = get(pole, 'sun');
      let both = 0;
      for (let i = 0; i < psr.bytes.length; i++) if (psr.bytes[i] === layers.max_byte && sun.bytes[i] > 0) both++;
      expect(both, pole).toBe(0);
    }
  });

  for (const key of LAYER_KEYS) {
    it(`${key} has a value at each of the six points (T43 "Done when" line 1)`, () => {
      for (const [where, lat, lon] of SIX) expect(layerAt(key, lat, lon, inputs), `${key} at ${where}`).not.toBeNull();
    });
  }

  it('the smooth-Moon Earth layer is near 1 at 0 N 0 E and near 0 at 0 N 180 E', () => {
    const near = layerAt('earth', 0, 0, inputs)!, far = layerAt('earth', 0, 180, inputs)!;
    expect(near.source.id).toBe('smooth');
    expect(near.value).toBeGreaterThan(0.99);
    expect(far.value).toBeLessThan(0.01);
    // A smooth Moon's Sun is up about half the time away from the poles, a little more for its disc.
    expect(layerAt('sun', 0, 0, inputs)!.value).toBeGreaterThan(0.49);
    expect(layerAt('sun', 0, 0, inputs)!.value).toBeLessThan(0.52);
  });

  it('the steepest slope within 20 km of Apollo 15 (Hadley Delta) beats Apollo 11\'s (Mare Tranquillitatis)', () => {
    const sites = readJson('sites.json') as CuratedSite[];
    const steepest = (id: string): number => {
      const s = sites.find((x) => x.id === id)!;
      let max = 0;
      for (let d = 0; d <= 20000; d += 500) {
        for (let b = 0; b < 360; b += 5) {
          const p = destination(s.lat, s.lon, b, d);
          const v = layerAt('slope', p.lat, p.lon, inputs)!;
          expect(v.source.id).toBe('globe');
          max = Math.max(max, v.value);
        }
      }
      return max;
    };
    const a15 = steepest('apollo-15'), a11 = steepest('apollo-11');
    console.log(`steepest within 20 km: Apollo 15 ${a15.toFixed(1)} degrees, Apollo 11 ${a11.toFixed(1)} degrees (over 3.8 km)`);
    expect(a15).toBeGreaterThan(a11);
  });
});
