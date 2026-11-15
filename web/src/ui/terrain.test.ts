// T37: the terrain words (ui/terrain.ts), for each grid, for a walk that passes a polar map's edge,
// and for a smooth Moon on either side of 85 S.
import { describe, expect, it } from 'vitest';
import type { Skyline } from '../core/types';
import { cellText, terrainCaption, terrainNote, terrainShort } from './terrain';

const sky = (grid: Skyline['grid'], cellM: number | null): Skyline =>
  ({ elev: new Float32Array(360), terrain: grid !== null, grid, cellM });
const polar = { lat: -89.67, lon: 129.78 };
const apollo15 = { lat: 26.13, lon: 3.63 };

describe('terrain words', () => {
  it('names the cell size in metres or kilometres', () => {
    expect(cellText(240)).toBe('240 m');
    expect(cellText(3790.6)).toBe('3.8 km');
  });

  it('detailed polar terrain: named, and no note (the readout showed none before T37)', () => {
    expect(terrainShort(sky('dem', 240), polar, 'ready')).toBe('Terrain from LOLA, 240 m cells');
    expect(terrainNote(sky('dem', 240), polar, 'loading')).toBe('');
    expect(terrainCaption(sky('dem', 240), polar, 'ready')).toBe('Terrain skyline from LOLA heights, 240 m cells');
  });

  it('between 80 S and 85 S: the 240 m map, and the coarser cells past its edge are named', () => {
    const s: Skyline = { ...sky('dem', 240), outer: { lat: -80, cellM: 3790.6 } };
    const im2 = { lat: -84.7906, lon: 29.1957 };
    expect(terrainShort(s, im2, 'ready')).toBe('Terrain from LOLA, 240 m cells (3.8 km cells north of 80° S)');
    expect(terrainNote(s, im2, 'ready')).toBe(terrainShort(s, im2, 'ready'));
    expect(terrainCaption(s, im2, 'ready')).toBe('Terrain skyline from LOLA heights, 240 m cells (3.8 km cells north of 80° S)');
  });

  it('north of 80 N: the 1.2 km map is named, with the coarser cells past its edge where the walk can reach them', () => {
    const near = sky('north', 1200);
    const site = { lat: 88.42, lon: -116.87 };
    expect(terrainShort(near, site, 'ready')).toBe('Terrain from LOLA, 1.2 km cells');
    expect(terrainNote(near, site, 'ready')).toBe('Terrain from LOLA, 1.2 km cells');
    expect(terrainCaption(near, site, 'ready')).toBe('Terrain skyline from LOLA heights, 1.2 km cells');
    const band: Skyline = { ...near, outer: { lat: 80, cellM: 3790.6 } };
    expect(terrainShort(band, { lat: 82, lon: 0 }, 'ready')).toBe('Terrain from LOLA, 1.2 km cells (3.8 km cells south of 80° N)');
    expect(terrainCaption(band, { lat: 82, lon: 0 }, 'ready')).toBe('Terrain skyline from LOLA heights, 1.2 km cells (3.8 km cells south of 80° N)');
  });

  it('coarse terrain says so, with its cell size, everywhere', () => {
    const s = sky('globe', 3790.6);
    expect(terrainShort(s, apollo15, 'ready')).toBe('Coarse terrain: LOLA whole-Moon height map, 3.8 km cells');
    expect(terrainNote(s, apollo15, 'ready')).toBe(terrainShort(s, apollo15, 'ready'));
    expect(terrainCaption(s, apollo15, 'ready')).toMatch(/^Coarse terrain skyline .* 3\.8 km cells: crater walls and massifs, not small ridges$/);
  });

  it('a smooth Moon says why: still loading, did not load, or the polar height map is missing', () => {
    const none = sky(null, null);
    expect(terrainNote(none, apollo15, 'loading')).toBe('Smooth Moon until the whole-Moon height map loads');
    expect(terrainNote(none, apollo15, 'missing')).toBe('Smooth Moon, no terrain: the whole-Moon height map didn\'t load');
    // A polar site never waits for globe.bin: only its own height map counts.
    for (const g of ['loading', 'ready', 'missing'] as const) {
      expect(terrainNote(none, polar, g)).toBe('Smooth Moon, no terrain: the height map isn\'t loaded');
      expect(terrainNote(none, { lat: -85, lon: 0 }, g)).toMatch(/height map isn't loaded/);
    }
    expect(terrainCaption(none, apollo15, 'loading')).toBe(terrainShort(none, apollo15, 'loading'));
  });
});
