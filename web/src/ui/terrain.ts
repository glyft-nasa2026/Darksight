// T37: the words for which terrain a site's skyline uses (contract section 4, "Which terrain").
// Every place that names the terrain takes them from here, so the readout, sky panorama, nudge
// and report agree. The skyline itself, its grid and cell size come from core/horizon.ts.

import { SKYLINE_MIN_LAT } from '../core/horizon';
import type { Site, Skyline } from '../core/types';

export type GlobeStatus = 'loading' | 'ready' | 'missing';

/** A cell size in words: "240 m", "3.8 km". */
export function cellText(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** " (3.8 km cells north of 80° S)" when the walk can pass its polar map's edge, else nothing. */
function outerText(sky: Skyline): string {
  if (!sky.outer) return '';
  const south = sky.outer.lat < 0;
  return ` (${cellText(sky.outer.cellM)} cells ${south ? 'north' : 'south'} of ${Math.abs(sky.outer.lat)}° ${south ? 'S' : 'N'})`;
}

/** One line naming the terrain under a skyline: the report's Skyline row, and the notes below. */
export function terrainShort(sky: Skyline, site: Site, globe: GlobeStatus): string {
  // A polar map: 240 m cells near the south pole, 1.2 km near the north pole.
  if (sky.grid === 'dem' || sky.grid === 'north') return `Terrain from LOLA, ${cellText(sky.cellM ?? 0)} cells${outerText(sky)}`;
  if (sky.grid === 'globe') return `Coarse terrain: LOLA whole-Moon height map, ${cellText(sky.cellM ?? 0)} cells`;
  if (site.lat <= SKYLINE_MIN_LAT) return 'Smooth Moon, no terrain: the height map isn\'t loaded';
  return globe === 'loading'
    ? 'Smooth Moon until the whole-Moon height map loads'
    : 'Smooth Moon, no terrain: the whole-Moon height map didn\'t load';
}

/**
 * The readout's and the nudge's note: nothing for the 240 m polar terrain on its own (as before
 * T37), the same words as terrainShort for any coarser terrain or a smooth Moon.
 */
export function terrainNote(sky: Skyline, site: Site, globe: GlobeStatus): string {
  return sky.grid === 'dem' && !sky.outer ? '' : terrainShort(sky, site, globe);
}

/** The sky panorama's caption, before the Sun and Earth part. */
export function terrainCaption(sky: Skyline, site: Site, globe: GlobeStatus): string {
  if (sky.grid === 'dem' || sky.grid === 'north') {
    return `Terrain skyline from LOLA heights, ${cellText(sky.cellM ?? 0)} cells${outerText(sky)}`;
  }
  if (sky.grid === 'globe') {
    return `Coarse terrain skyline from LOLA's whole-Moon height map, ${cellText(sky.cellM ?? 0)} cells: ` +
      'crater walls and massifs, not small ridges';
  }
  return terrainShort(sky, site, globe);
}
