// Loading globe.bin and north.bin, or their packed copies globe.pack and north.pack (contract
// section 2), with fetch stubbed: the packed copy when there is one, the .bin file otherwise.
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DemMeta } from '../core/dem';
import type { GlobeMeta } from '../core/globe';
import { packHeights } from '../core/heightPack';
import { loadGlobe, loadNorth } from './globeHeights';

const GLOBE: GlobeMeta = { width: 360, height: 180, height_scale: 0.5, source: 'test' };
const NORTH: DemMeta = { size: 101, pixel_m: 1200, x_min_m: -60600, y_max_m: 60600, height_scale: 0.5, nodata: -32768, min_lat: 88, source: 'test' };

const globeCells = Int16Array.from({ length: GLOBE.width * GLOBE.height }, (_, i) => Math.round(3000 * Math.sin(i / 53)) + (i % 5));
const northCells = Int16Array.from({ length: NORTH.size * NORTH.size }, (_, i) => Math.round(900 * Math.cos(i / 31)) - (i % 3));

const asBin = (v: Int16Array): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(v.length * 2));
  v.forEach((x, i) => view.setInt16(i * 2, x, true));
  return view.buffer;
};
const asPack = (v: Int16Array, w: number, h: number): Uint8Array<ArrayBuffer> => new Uint8Array(gzipSync(packHeights(v, w, h)));
const page = (): Response => new Response('<!doctype html><title>Darksight</title>', { headers: { 'content-type': 'text/html' } });
const missing = (): Response => new Response('', { status: 404 });

/** Serves the .json and .bin files, and each .pack as given; records what was asked for. */
function host(packs: { globe: () => Response; north: () => Response }): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const name = url.replace(/^.*data\//, '');
    asked.push(name);
    switch (name) {
      case 'globe.json': return new Response(JSON.stringify(GLOBE));
      case 'globe.pack': return packs.globe();
      case 'globe.bin': return new Response(asBin(globeCells));
      case 'north.json': return new Response(JSON.stringify(NORTH));
      case 'north.pack': return packs.north();
      case 'north.bin': return new Response(asBin(northCells));
      default: return missing();
    }
  });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadGlobe and loadNorth', () => {
  const packed = {
    globe: () => new Response(asPack(globeCells, GLOBE.width, GLOBE.height)),
    north: () => new Response(asPack(northCells, NORTH.size, NORTH.size)),
  };

  it('use globe.pack and north.pack, and do not download the .bin files', async () => {
    const asked = host(packed);
    const globe = await loadGlobe();
    const cap = await loadNorth();
    expect(asked).toEqual(['globe.json', 'globe.pack', 'north.json', 'north.pack']);
    expect(globe.cell(100, 200)).toBe(globeCells[100 * 360 + 200] * 0.5);
    expect(cap.cell(50, 50)).toBe(northCells[50 * 101 + 50] * 0.5);
    expect(cap.meta.min_lat).toBe(-88);   // mirrored, as parseNorth gives it
  });

  it('load the .bin files where there is no packed copy: a 404, or the page itself', async () => {
    for (const none of [missing, page]) {
      const asked = host({ globe: none, north: none });
      const globe = await loadGlobe();
      const cap = await loadNorth();
      expect(asked).toEqual(['globe.json', 'globe.pack', 'globe.bin', 'north.json', 'north.pack', 'north.bin']);
      expect(globe.cell(179, 359)).toBe(globeCells.at(-1)! * 0.5);
      expect(cap.cell(100, 100)).toBe(northCells.at(-1)! * 0.5);
    }
  });

  it('load the .bin files when a packed copy is broken, and say so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const asked = host({
      globe: () => new Response(asPack(globeCells, GLOBE.width, GLOBE.height).slice(0, 3000)),   // cut short
      north: () => new Response(asPack(new Int16Array(9), 3, 3)),   // another grid's heights
    });
    const globe = await loadGlobe();
    const cap = await loadNorth();
    expect(asked).toEqual(['globe.json', 'globe.pack', 'globe.bin', 'north.json', 'north.pack', 'north.bin']);
    expect(globe.cell(0, 0)).toBe(globeCells[0] * 0.5);
    expect(cap.cell(0, 0)).toBe(northCells[0] * 0.5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('globe.pack not loaded, loading globe.bin instead'), expect.anything());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('north.pack not loaded'), expect.stringMatching(/expected 20402/));
  });
});
