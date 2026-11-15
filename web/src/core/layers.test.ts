// T14: the map-layer reader, on made-up grids and on the real files in web/public/data/layers/.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectToGrid, type DemMeta } from './dem';
import { gridLatLon, gridPoint, LAYER_NAMES, parseLayer, readLayersMeta, type LayersMeta } from './layers';

const META: LayersMeta = {
  size: 4, pixel_m: 480, x_min_m: -720, y_max_m: 720, value_scale: 0.004, max_byte: 250,
  layers: {
    sun: { file: 'layers/sun.bin', product: 'x', meaning: 'x' },
    earth: { file: 'layers/earth.bin', product: 'x', meaning: 'x' },
    psr: { file: 'layers/psr.bin', product: 'x', meaning: 'x' },
  },
  source: 'test', product_page: 'test', citation: 'test',
};

describe('layer grid', () => {
  it('uses the same projection as dem.bin', () => {
    const dem = { size: 2534, pixel_m: 240, x_min_m: -304080, y_max_m: 304080 } as DemMeta;
    for (const [lat, lon] of [[-89.67, 129.78], [-85, -45], [-81, 170], [-90, 0]]) {
      expect(gridPoint(dem, lat, lon).col).toBeCloseTo(projectToGrid(dem, lat, lon).col, 9);
      expect(gridPoint(dem, lat, lon).row).toBeCloseTo(projectToGrid(dem, lat, lon).row, 9);
    }
  });

  it('turns cells back into latitude and longitude', () => {
    const p = gridPoint(META, -89.9, 60);
    const ll = gridLatLon(META, p.row, p.col);
    expect(ll.lat).toBeCloseTo(-89.9, 9);
    expect(ll.lon).toBeCloseTo(60, 9);
  });

  it('reads a value bilinearly and returns null off the grid', () => {
    const bytes = new Uint8Array(16);
    bytes[1 * 4 + 1] = 250; // value 1.0 at row 1, col 1, which is x = -240, y = 240
    const layer = parseLayer(META, 'sun', bytes.buffer);
    expect(layer.cell(1, 1)).toBe(1);
    const p = gridLatLon(META, 1, 1);
    expect(layer.valueAt(p.lat, p.lon)).toBeCloseTo(1, 9);
    const half = gridLatLon(META, 1, 1.5);
    expect(layer.valueAt(half.lat, half.lon)).toBeCloseTo(0.5, 6);
    expect(layer.valueAt(-80, 0)).toBeNull();
    expect(layer.covers(-80, 0)).toBe(false);
  });

  it('rejects a broken layers.json or a short file', () => {
    expect(() => readLayersMeta(null)).toThrow(/object/);
    expect(() => readLayersMeta({ ...META, size: 1.5 })).toThrow(/size/);
    expect(() => readLayersMeta({ ...META, pixel_m: 0 })).toThrow(/pixel_m/);
    expect(() => readLayersMeta({ ...META, layers: { sun: META.layers.sun } })).toThrow(/earth/);
    expect(() => parseLayer(META, 'sun', new ArrayBuffer(3))).toThrow(/expected 16/);
  });
});

const dataFile = (rel: string): string => fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url));
const present = existsSync(dataFile('layers/layers.json'));

describe.skipIf(!present)('real layers (web/public/data/layers)', () => {
  const meta = present ? readLayersMeta(JSON.parse(readFileSync(dataFile('layers/layers.json'), 'utf8'))) : META;
  const load = (name: (typeof LAYER_NAMES)[number]) => {
    const b = readFileSync(dataFile(meta.layers[name].file));
    return parseLayer(meta, name, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };
  const sun = load('sun');
  const earth = load('earth');
  const psr = load('psr');

  it('has the grid make_layers.py writes', () => {
    expect([meta.size, meta.pixel_m, meta.x_min_m, meta.y_max_m]).toEqual([1267, 480, -303960, 303960]);
    for (const l of [sun, earth, psr]) expect(l.bytes.length).toBe(1267 * 1267);
    expect(meta.citation).toMatch(/Mazarico/);
  });

  it('marks Shackleton\'s floor never lit, with no Sun and no Earth (T14 "Done when")', () => {
    const [lat, lon] = [-89.67, 129.78];
    expect(psr.valueAt(lat, lon)).toBeGreaterThanOrEqual(0.5);
    expect(sun.valueAt(lat, lon)).toBeLessThan(0.02);
    expect(earth.valueAt(lat, lon)).toBeLessThan(0.02);
  });

  it('shows Shackleton\'s rim and the connecting ridge sunlit, never permanently dark', () => {
    for (const [lat, lon] of [[-89.6866, -162.81], [-89.4398, -137.17]]) {
      expect(sun.valueAt(lat, lon)).toBeGreaterThan(0.5);
      // Small shadowed pits sit within a cell of the crest (4 % of the source cells round C1).
      expect(psr.valueAt(lat, lon)).toBeLessThan(0.1);
    }
  });

  it('never has Sun where the cell is wholly permanently shadowed', () => {
    let both = 0;
    for (let i = 0; i < psr.bytes.length; i++) if (psr.bytes[i] === meta.max_byte && sun.bytes[i] > 0) both++;
    expect(both).toBe(0);
  });
});
