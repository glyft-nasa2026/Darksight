import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAINTEST_MAG, parseStars, starLook, type StarMeta } from './stars';

const DATA = new URL('../../public/data/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('stars.json', DATA), 'utf8')) as StarMeta;
const bin = readFileSync(new URL('stars.bin', DATA));
const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const RAD = Math.PI / 180;

describe('parseStars', () => {
  const cat = parseStars(meta, buffer);
  it('reads every star, brightest first, as unit vectors', () => {
    expect(cat.vmag.length).toBe(meta.count);
    for (let i = 1; i < cat.vmag.length; i++) expect(cat.vmag[i]).toBeGreaterThanOrEqual(cat.vmag[i - 1]);
    for (let i = 0; i < cat.vmag.length; i += 97) {
      expect(Math.hypot(cat.dirs[i * 3], cat.dirs[i * 3 + 1], cat.dirs[i * 3 + 2])).toBeCloseTo(1, 6);
    }
  });
  it('puts Sirius first, at RA 6 h 45 m 08.9 s, Dec -16 43 (J2000), V -1.46, B-V 0.00', () => {
    const ra = (6 + 45 / 60 + 8.9 / 3600) * 15 * RAD, dec = -(16 + 43 / 60 + 0 / 3600) * RAD;
    const want = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const dot = cat.dirs[0] * want[0] + cat.dirs[1] * want[1] + cat.dirs[2] * want[2];
    expect(Math.acos(Math.min(1, dot)) / RAD).toBeLessThan(0.01);
    expect(cat.vmag[0]).toBeCloseTo(-1.46, 3);
    expect(cat.bv[0]).toBeCloseTo(0, 2);
  });
  it('refuses a file of the wrong size', () => {
    expect(() => parseStars({ ...meta, count: meta.count + 1 }, buffer)).toThrow(/bytes/);
  });
  it('has some 8,000 stars down to the faintest drawn', () => {
    const drawn = cat.vmag.filter((m) => m <= FAINTEST_MAG).length;
    expect(drawn).toBeGreaterThan(7000);
    expect(drawn).toBeLessThan(meta.count);
  });
});

describe('starLook', () => {
  it('draws brighter stars larger and lighter, never to nothing', () => {
    const sirius = starLook(-1.46, 0), faint = starLook(6.5, 0.6), mid = starLook(3, 0.6);
    expect(sirius.size).toBeCloseTo(1, 2);
    expect(faint.size).toBeGreaterThan(0);
    expect(faint.light).toBeGreaterThan(0);
    expect(mid.size).toBeGreaterThan(faint.size);
    expect(mid.light).toBeLessThan(sirius.light);
  });
  it('colours by B-V: blue-white, Sun-like, orange', () => {
    expect(starLook(1, -0.3).warmth).toBeCloseTo(0, 6);
    expect(starLook(1, 0.65).warmth).toBeCloseTo(0.5, 6);
    expect(starLook(1, 1.6).warmth).toBeCloseTo(1, 6);
    expect(starLook(1, 3).warmth).toBe(1);
    expect(starLook(1, -1).warmth).toBe(0);
  });
});
