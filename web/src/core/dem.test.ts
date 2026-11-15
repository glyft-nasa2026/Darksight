import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDem, parseDem, projectToGrid, unpackDemFile, type DemMeta } from './dem';
import { packHeights } from './heightPack';
import { MOON_RADIUS_KM } from './types';

// A made-up grid with the mock file's shape (contract section 2), built in memory.
const META: DemMeta = {
  size: 634, pixel_m: 960, x_min_m: -304320, y_max_m: 304320,
  height_scale: 0.5, nodata: -32768, min_lat: -80, source: 'made up for a test',
};
const CENTRE = 317;   // the south pole: (0 - x_min_m) / pixel_m

function grid(set: (values: Int16Array) => void, meta: DemMeta = META): ArrayBuffer {
  const values = new Int16Array(meta.size * meta.size);
  set(values);
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return buffer;
}

// Contract inverse projection: the latitude and longitude of a grid position.
function latLonOf(col: number, row: number, meta: DemMeta = META): { lat: number; lon: number } {
  const x = meta.x_min_m + col * meta.pixel_m;
  const y = meta.y_max_m - row * meta.pixel_m;
  const R = MOON_RADIUS_KM * 1000;
  return {
    lat: (2 * Math.atan(Math.hypot(x, y) / (2 * R)) * 180) / Math.PI - 90,
    lon: (Math.atan2(x, y) * 180) / Math.PI,
  };
}

describe('projectToGrid', () => {
  it('puts the south pole at the centre of the grid', () => {
    const p = projectToGrid(META, -90, 0);
    expect(p.col).toBeCloseTo(CENTRE, 9);
    expect(p.row).toBeCloseTo(CENTRE, 9);
  });

  it('points longitude 0 up and longitude 90 E right', () => {
    const up = projectToGrid(META, -89, 0);
    expect(up.col).toBeCloseTo(CENTRE, 6);
    expect(up.row).toBeLessThan(CENTRE);
    const right = projectToGrid(META, -89, 90);
    expect(right.row).toBeCloseTo(CENTRE, 6);
    expect(right.col).toBeGreaterThan(CENTRE);
    const left = projectToGrid(META, -89, -90);
    expect(left.col).toBeLessThan(CENTRE);
  });

  it('follows r = 2 R tan(c / 2): one degree from the pole is 30.32 km', () => {
    const p = projectToGrid(META, -89, 180);          // straight down
    expect((p.row - CENTRE) * META.pixel_m).toBeCloseTo(30324.2, 0);
  });

  it('is undone by the contract inverse', () => {
    const { lat, lon } = latLonOf(400.25, 120.5);
    const p = projectToGrid(META, lat, lon);
    expect(p.col).toBeCloseTo(400.25, 6);
    expect(p.row).toBeCloseTo(120.5, 6);
  });
});

describe('parseDem', () => {
  it('reads one stored cell by row and column, a cell with no data as 0', () => {
    const dem = parseDem(META, grid((v) => { v[100 * META.size + 400] = 3000; v[7 * META.size + 9] = META.nodata; }));
    expect(dem.cell(100, 400)).toBe(1500);
    expect(dem.cell(400, 100)).toBe(0);
    expect(dem.cell(7, 9)).toBe(0);
    // The same value heightAt gives exactly on the cell.
    const at = latLonOf(400, 100);
    expect(dem.heightAt(at.lat, at.lon)).toBeCloseTo(dem.cell(100, 400), 6);
  });

  it('reads rows from the top, and applies height_scale', () => {
    const dem = parseDem(META, grid((v) => { v[100 * META.size + 400] = 3000; }));
    const at = latLonOf(400, 100);
    expect(dem.heightAt(at.lat, at.lon)).toBeCloseTo(1500, 3);
    const elsewhere = latLonOf(100, 400);
    expect(dem.heightAt(elsewhere.lat, elsewhere.lon)).toBe(0);
    expect(dem.meta).toBe(META);
  });

  it('reads negative heights', () => {
    const dem = parseDem(META, grid((v) => { v[CENTRE * META.size + CENTRE] = -6000; }));
    expect(dem.heightAt(-90, 0)).toBeCloseTo(-3000, 3);
  });

  it('is bilinear between cells', () => {
    const dem = parseDem(META, grid((v) => {
      v[200 * META.size + 300] = 400;    // 200 m
      v[200 * META.size + 301] = 800;    // 400 m
      v[201 * META.size + 300] = 1200;   // 600 m
      v[201 * META.size + 301] = 1600;   // 800 m
    }));
    const h = (col: number, row: number): number => {
      const p = latLonOf(col, row);
      return dem.heightAt(p.lat, p.lon);
    };
    expect(h(300.5, 200)).toBeCloseTo(300, 3);
    expect(h(300, 200.5)).toBeCloseTo(400, 3);
    expect(h(300.5, 200.5)).toBeCloseTo(500, 3);
    expect(h(300.25, 200.75)).toBeCloseTo(200 * 0.75 * 0.25 + 400 * 0.25 * 0.25 + 600 * 0.75 * 0.75 + 800 * 0.25 * 0.75, 3);
  });

  it('hasData() is false on a no-data cell and outside the grid, true elsewhere (T41)', () => {
    const dem = parseDem(META, grid((v) => { v[7 * META.size + 9] = META.nodata; }));
    expect(dem.hasData(7, 9)).toBe(false);
    expect(dem.hasData(7, 10)).toBe(true);
    expect(dem.hasData(-1, 0)).toBe(false);
    expect(dem.hasData(0, META.size)).toBe(false);
    expect(dem.hasData(1.5, 2)).toBe(false);
  });

  it('counts a no-data cell as height 0', () => {
    const dem = parseDem(META, grid((v) => {
      v[200 * META.size + 300] = META.nodata;
      v[200 * META.size + 301] = 800;
    }));
    const p = latLonOf(300.5, 200);
    expect(dem.heightAt(p.lat, p.lon)).toBeCloseTo(200, 3);
  });

  it('returns 0 and covers() false outside the grid', () => {
    const dem = parseDem(META, grid((v) => v.fill(2000)));
    expect(dem.heightAt(0, 23)).toBe(0);
    expect(dem.covers(0, 23)).toBe(false);
    expect(dem.heightAt(-70, 10)).toBe(0);
    expect(dem.covers(-70, 10)).toBe(false);
    expect(dem.covers(-88, 45)).toBe(true);
    expect(dem.heightAt(-88, 45)).toBeCloseTo(1000, 3);
  });

  it('covers() is false north of min_lat, even in a corner of the square', () => {
    const dem = parseDem(META, grid(() => {}));
    expect(dem.covers(-80.5, 45)).toBe(true);
    expect(dem.covers(-79.5, 45)).toBe(false);   // inside the square, north of 80 S
    expect(dem.covers(-90, 0)).toBe(true);
  });

  it('reaches the last row and column', () => {
    const last = META.size - 1;
    const dem = parseDem(META, grid((v) => { v[last * META.size + last] = 100; }));
    const p = latLonOf(last, last);
    expect(dem.heightAt(p.lat, p.lon)).toBeCloseTo(50, 3);
  });

  it('reads size and pixel_m from the meta, never a fixed number', () => {
    const small: DemMeta = { ...META, size: 5, pixel_m: 1000, x_min_m: -2000, y_max_m: 2000, height_scale: 1 };
    const dem = parseDem(small, grid((v) => { v[1 * 5 + 3] = 7; }, small));
    const p = latLonOf(3, 1, small);
    expect(dem.heightAt(p.lat, p.lon)).toBeCloseTo(7, 6);
    expect(dem.heightAt(-90, 0)).toBe(0);
  });

  it('rejects a file that is too short or a meta that makes no sense', () => {
    expect(() => parseDem(META, new ArrayBuffer(100))).toThrow(/expected 803912/);
    expect(() => parseDem({ ...META, size: 0 }, new ArrayBuffer(100))).toThrow(/size/);
    expect(() => parseDem({ ...META, pixel_m: 0 }, new ArrayBuffer(100))).toThrow(/pixel_m/);
  });
});

describe('dem.pack, the packed height map', () => {
  // A small grid, big enough that unpacking pauses between slices of rows.
  const SMALL: DemMeta = { ...META, size: 300 };
  const n = SMALL.size * SMALL.size;
  const heights = new Int16Array(n).map((_, i) => Math.round(2000 * Math.sin(i / 97)) + (i % 7));
  const packedFile = (): Uint8Array<ArrayBuffer> => new Uint8Array(gzipSync(packHeights(heights, 300, 300)));
  const binFile = (): ArrayBuffer => {
    const buffer = new ArrayBuffer(n * 2);
    const view = new DataView(buffer);
    heights.forEach((v, i) => view.setInt16(i * 2, v, true));
    return buffer;
  };
  const page = (): Response => new Response('<!doctype html><title>Darksight</title>', { headers: { 'content-type': 'text/html' } });

  /** Serves dem.json and dem.bin, and dem.pack as given; records what was asked for. */
  function host(pack: () => Response): string[] {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url.replace(/^.*data\//, ''));
      if (url.endsWith('dem.json')) return new Response(JSON.stringify(SMALL));
      if (url.endsWith('dem.pack')) return pack();
      if (url.endsWith('dem.bin')) return new Response(binFile());
      return new Response('', { status: 404 });
    });
    return asked;
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('unpackDemFile gives back every stored value', async () => {
    expect(await unpackDemFile(SMALL, packedFile())).toEqual(heights);
  });

  it('unpackDemFile says null for a page instead of the file, and throws for another grid', async () => {
    expect(await unpackDemFile(SMALL, new TextEncoder().encode('<!doctype html>'))).toBeNull();
    const other = new Uint8Array(gzipSync(packHeights(new Int16Array(40 * 40), 40, 40)));
    await expect(unpackDemFile(SMALL, other)).rejects.toThrow(/expected 180000/);
  });

  it('loadDem uses dem.pack and does not download dem.bin', async () => {
    const asked = host(() => new Response(packedFile()));
    const progress: number[] = [];
    const dem = await loadDem((f) => progress.push(f));
    expect(asked).toEqual(['dem.json', 'dem.pack']);
    expect(dem.cell(150, 77)).toBe(heights[150 * 300 + 77] * SMALL.height_scale);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= progress[i - 1]))).toBe(true);
  });

  it('loadDem loads dem.bin where there is no dem.pack: a 404, or the page itself', async () => {
    for (const pack of [() => new Response('', { status: 404 }), page]) {
      const asked = host(pack);
      const dem = await loadDem();
      expect(asked).toEqual(['dem.json', 'dem.pack', 'dem.bin']);
      expect(dem.cell(150, 77)).toBe(heights[150 * 300 + 77] * SMALL.height_scale);
    }
  });

  it('loadDem loads dem.bin when dem.pack is broken, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = packedFile().slice(0, 2000);   // cut short
    const asked = host(() => new Response(broken));
    const dem = await loadDem();
    expect(asked).toEqual(['dem.json', 'dem.pack', 'dem.bin']);
    expect(dem.cell(299, 299)).toBe(heights[n - 1] * SMALL.height_scale);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dem.pack not loaded'), expect.anything());
  });
});
