// T43: the core reader for globe.bin and north.bin (moved from web/src/scene/, which re-exports it).
import { describe, expect, it } from 'vitest';
import { globeFromHeights, northFromHeights, parseGlobe, parseNorth, type GlobeMeta } from './globe';
import type { DemMeta } from './dem';

const meta: GlobeMeta = { width: 8, height: 4, height_scale: 0.5, source: 'test' };

/** A grid whose cell (row, col) holds 100 * row + col metres. */
function grid() {
  const view = new DataView(new ArrayBuffer(meta.width * meta.height * 2));
  for (let j = 0; j < meta.height; j++) for (let i = 0; i < meta.width; i++) {
    view.setInt16((j * meta.width + i) * 2, (100 * j + i) / 0.5, true);
  }
  return parseGlobe(meta, view.buffer);
}

describe('parseGlobe', () => {
  it('reads cells, their range and the row spacing', () => {
    const g = grid();
    expect(g.cell(2, 3)).toBe(203);
    expect(g.cell(2, -1)).toBe(207);           // columns wrap
    expect(g.cell(-5, 0)).toBe(0);             // rows stop at the poles
    expect(g.range).toEqual([0, 307]);
    expect(g.rowSpacingM).toBeCloseTo((Math.PI * 1737400) / 4, 6);
  });

  it('gives the cell holding a point (pictures) and a bilinear height (numbers)', () => {
    const g = grid();
    // Cell (1, 2) is centred on latitude 22.5, longitude -67.5.
    expect(g.heightAt(30, -60)).toBe(102);
    expect(g.heightBilinear(22.5, -67.5)).toBeCloseTo(102, 9);
    expect(g.heightBilinear(22.5, -45)).toBeCloseTo(102.5, 9);   // halfway to column 3
    expect(g.heightBilinear(0, -67.5)).toBeCloseTo(152, 9);      // halfway to row 2
    expect(g.heightBilinear(22.5, 180)).toBeCloseTo((107 + 100) / 2, 9);   // wraps at 180 degrees
  });

  it('rejects a broken file', () => {
    expect(() => parseGlobe(meta, new ArrayBuffer(10))).toThrow(/globe\.bin/);
    expect(() => parseGlobe({ ...meta, width: 1.5 }, new ArrayBuffer(4000))).toThrow(/globe\.json/);
  });
});

describe('parseNorth', () => {
  const north: DemMeta = { size: 3, pixel_m: 1000, x_min_m: -1000, y_max_m: 1000, height_scale: 1, nodata: -32768, min_lat: 80, source: 'test' };
  it('mirrors the latitudes, so the south-pole code reads it with (-lat, lon)', () => {
    const view = new DataView(new ArrayBuffer(18));
    view.setInt16(4 * 2, 1234, true);   // the centre cell: the pole
    const cap = parseNorth(north, view.buffer);
    expect(cap.meta.min_lat).toBe(-80);
    expect(cap.heightAt(-90, 0)).toBe(1234);
    expect(cap.covers(-89.99, 0)).toBe(true);
  });
  it('refuses a southern min_lat', () => {
    expect(() => parseNorth({ ...north, min_lat: -80 }, new ArrayBuffer(18))).toThrow(/north\.json/);
  });
});

describe('globeFromHeights and northFromHeights (globe.pack and north.pack, unpacked)', () => {
  const values = Int16Array.from({ length: meta.width * meta.height }, (_, k) => (k * 37) % 500 - 250);
  const asFile = (v: Int16Array): ArrayBuffer => {
    const view = new DataView(new ArrayBuffer(v.length * 2));
    v.forEach((x, i) => view.setInt16(i * 2, x, true));
    return view.buffer;
  };

  it('build the same grid as reading the .bin file', () => {
    const a = globeFromHeights(meta, values), b = parseGlobe(meta, asFile(values));
    expect(a.range).toEqual(b.range);
    expect(a.rowSpacingM).toBe(b.rowSpacingM);
    for (let j = 0; j < meta.height; j++) for (let i = 0; i < meta.width; i++) expect(a.cell(j, i)).toBe(b.cell(j, i));
    expect(a.heightBilinear(-31, 100)).toBe(b.heightBilinear(-31, 100));
  });

  it('refuse a grid of the wrong length, or a bad size', () => {
    expect(() => globeFromHeights(meta, values.subarray(1))).toThrow(/31 heights, expected 32/);
    expect(() => globeFromHeights(meta, new Int16Array(33))).toThrow(/expected 32/);
    expect(() => globeFromHeights({ ...meta, height: 1 }, values)).toThrow(/globe\.json/);
  });

  it('northFromHeights mirrors the latitudes, as parseNorth does', () => {
    const north: DemMeta = { size: 3, pixel_m: 1000, x_min_m: -1000, y_max_m: 1000, height_scale: 1, nodata: -32768, min_lat: 80, source: 'test' };
    const cells = new Int16Array(9);
    cells[4] = 1234;
    const cap = northFromHeights(north, cells);
    expect(cap.meta.min_lat).toBe(-80);
    expect(cap.heightAt(-90, 0)).toBe(parseNorth(north, asFile(cells)).heightAt(-90, 0));
    expect(cap.heightAt(-90, 0)).toBe(1234);
    expect(() => northFromHeights({ ...north, min_lat: -80 }, cells)).toThrow(/north\.json/);
  });
});
