import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { packHeights, unpackHeightRows, unpackHeights } from './heightPack';

/** Made-up terrain: hills, a crater wall, noise, holes with no data, and the int16 extremes. */
function terrain(width: number, height: number): Int16Array {
  const v = new Int16Array(width * height);
  let seed = 7;
  const noise = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) % 41 - 20; };
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const wall = Math.hypot(c - width / 2, r - height / 2) < width / 4 ? -9000 : 0;
      v[r * width + c] = Math.round(4000 * Math.sin(c / 9) * Math.cos(r / 13)) + wall + noise();
    }
  }
  v[3] = -32768; v[width + 5] = 32767; v[width + 6] = -32768; v[v.length - 1] = 32767;
  return v;
}

describe('packHeights and unpackHeights', () => {
  it('give back every height exactly, on a grid that is not square', () => {
    const values = terrain(37, 23);
    const packed = packHeights(values, 37, 23);
    expect(packed.length).toBe(37 * 23 * 2);
    expect(unpackHeights(packed, 37, 23)).toEqual(values);
  });

  it('give back the int16 extremes next to each other (the differences wrap at 16 bits)', () => {
    const values = Int16Array.from([32767, -32768, 32767, -32768, -32768, 32767, 0, -1, 1]);
    expect(unpackHeights(packHeights(values, 3, 3), 3, 3)).toEqual(values);
  });

  it('store a tilted plane as zeros after the first row and column', () => {
    const w = 20, h = 10;
    const plane = new Int16Array(w * h).map((_, i) => 3 * (i % w) - 7 * Math.floor(i / w) + 100);
    const packed = packHeights(plane, w, h);
    for (let r = 1; r < h; r++) {
      for (let c = 1; c < w; c++) {
        expect(packed[r * w + c]).toBe(0);
        expect(packed[w * h + r * w + c]).toBe(0);
      }
    }
  });

  it('rebuild the same grid a slice of rows at a time, in order', () => {
    const values = terrain(50, 41);
    const packed = packHeights(values, 50, 41);
    const out = new Int16Array(50 * 41);
    for (let r = 0; r < 41; r += 8) unpackHeightRows(packed, 50, 41, out, r, r + 8);
    expect(out).toEqual(values);
  });

  it('refuse a packed array that does not fit the grid', () => {
    expect(() => unpackHeights(new Uint8Array(10), 3, 3)).toThrow(/bytes for a 3 x 3 grid/);
    expect(() => packHeights(new Int16Array(5), 3, 3)).toThrow(/heights for a 3 x 3 grid/);
  });
});

// The real height map: packed and gzipped as the build does it (vite.config.ts), every height
// comes back, and the file is about a third of dem.bin. Skips while the data set is the mock.
const dataFile = (rel: string): string => fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url));
const realMeta = existsSync(dataFile('dem.json'))
  ? (JSON.parse(readFileSync(dataFile('dem.json'), 'utf8')) as { size: number; source: string })
  : null;
const real = realMeta && realMeta.source !== 'mock' && existsSync(dataFile('dem.bin'));

describe.skipIf(!real)('the real height map, packed', () => {
  it('unpacks to every height of dem.bin, at under 40 % of its size', () => {
    const size = realMeta!.size;
    const bin = readFileSync(dataFile('dem.bin'));
    const heights = new Int16Array(size * size);
    for (let i = 0; i < heights.length; i++) heights[i] = bin.readInt16LE(i * 2);
    const file = gzipSync(packHeights(heights, size, size), { level: 9 });
    expect(file.length).toBeLessThan(0.4 * bin.length);
    const back = unpackHeights(gunzipSync(file), size, size);
    let differ = 0;
    for (let i = 0; i < heights.length; i++) if (back[i] !== heights[i]) differ++;
    expect(differ).toBe(0);
  }, 30_000);
});
