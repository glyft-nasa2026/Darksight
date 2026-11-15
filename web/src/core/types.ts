// Shared types, exactly as docs/data-contract.md section 3.

export type Site = { lat: number; lon: number; eye_m?: number };   // eye_m default 2
export type AltAz = { alt: number; az: number };
export type TerrainGrid = 'dem' | 'globe';   // T37: dem.bin (240 m) or globe.bin (3.8 km)
export type Skyline = {
  elev: Float32Array;                // 360 values, index = azimuth
  terrain: boolean;                  // false: a smooth Moon (all zeros)
  grid: TerrainGrid | null;          // T37: which height map the walk used; null when terrain is false
  cellM: number | null;              // T37: that grid's cell size, metres; null when terrain is false
};
export type Sample = {
  tMs: number;
  sun: AltAz; earth: AltAz;
  sunAbove: number;    // Sun centre minus skyline at its azimuth, degrees
  earthAbove: number;
  sunFrac: number;     // 0..1, fraction of the Sun's disc above the skyline, by height
  earthUp: boolean;
};
export type Body = 'sun' | 'earth';
export type Flip = { type: 'rise' | 'set'; tMs: number } | null;
export type Summary = {
  litPct: number; longestLit_h: number; longestDark_h: number;
  earthPct: number; longestEarthGap_h: number;
};
export type CuratedSite = { id: string; name: string; lat: number; lon: number; agency: string;
  year: number; status: string; group: string; note: string; source: string };

/** Moon radius in km. Heights are metres above this sphere. */
export const MOON_RADIUS_KM = 1737.4;
/** Eye height above the ground in metres when a Site has no eye_m. */
export const DEFAULT_EYE_M = 2;
