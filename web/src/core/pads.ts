// Launch pads on Earth for the mission simulation (T34). The brief's seven (page 6) first, with their
// coordinates checked against each pad's page (docs/sources/T34.md), not copied from the brief:
// the brief's numbers for ELA-4 and SLS-2 belong to the pads next to them.
// Each coordinate is the pad's own, not its spaceport's: a spaceport's page title often gives its
// centre, kilometres from the pad (Taiyuan's is 2.2 km from LC-9).
// Latitude north-positive, longitude east-positive, -180 to 180, degrees.

export type Pad = {
  id: string;
  name: string;      // the launch site
  pad: string;       // the pad itself
  country: string;
  lat: number;
  lon: number;
};

export const PADS: readonly Pad[] = [
  { id: 'ksc-39a', name: 'Kennedy Space Center', pad: 'LC-39A', country: 'United States', lat: 28.60833, lon: -80.60444 },
  { id: 'ccsfs-slc40', name: 'Cape Canaveral', pad: 'SLC-40', country: 'United States', lat: 28.5619, lon: -80.5772 },
  { id: 'csg-ela4', name: 'Guiana Space Centre', pad: 'ELA-4', country: 'French Guiana', lat: 5.265, lon: -52.792 },
  { id: 'baikonur-31', name: 'Baikonur Cosmodrome', pad: 'Site 31/6', country: 'Kazakhstan', lat: 45.99611, lon: 63.56417 },
  { id: 'jiuquan-sls2', name: 'Jiuquan Satellite Launch Center', pad: 'SLS-2', country: 'China', lat: 40.960671, lon: 100.298186 },
  { id: 'wenchang-101', name: 'Wenchang Space Launch Site', pad: 'LC-101', country: 'China', lat: 19.6144917, lon: 110.9511333 },
  { id: 'mahia-lc1', name: 'Rocket Lab Launch Complex 1', pad: 'LC-1', country: 'New Zealand', lat: -39.26085, lon: 177.86586 },
  // More pads in use today, for the launch-site picker. Coordinates from the page element named
  // for each pad in docs/sources/T34.md, read by a Playwright script on 15 Nov 2026.
  { id: 'ksc-39b', name: 'Kennedy Space Center', pad: 'LC-39B', country: 'United States', lat: 28.62722, lon: -80.62083 },
  { id: 'ccsfs-slc41', name: 'Cape Canaveral', pad: 'SLC-41', country: 'United States', lat: 28.58341, lon: -80.58303 },
  { id: 'vsfb-slc4e', name: 'Vandenberg Space Force Base', pad: 'SLC-4E', country: 'United States', lat: 34.63208, lon: -120.61059 },
  { id: 'starbase-olpa', name: 'Starbase', pad: 'Orbital Launch Pad A', country: 'United States', lat: 25.99689, lon: -97.15434 },
  { id: 'wallops-0a', name: 'Mid-Atlantic Regional Spaceport', pad: 'LP-0A', country: 'United States', lat: 37.83379, lon: -75.48810 },
  { id: 'vostochny-1s', name: 'Vostochny Cosmodrome', pad: 'Site 1S', country: 'Russia', lat: 51.88444, lon: 128.33361 },
  { id: 'plesetsk-43', name: 'Plesetsk Cosmodrome', pad: 'Site 43/4', country: 'Russia', lat: 62.92889, lon: 40.45694 },
  { id: 'xichang-lc2', name: 'Xichang Satellite Launch Center', pad: 'LC-2', country: 'China', lat: 28.24556, lon: 102.02667 },
  { id: 'taiyuan-lc9', name: 'Taiyuan Satellite Launch Center', pad: 'LC-9', country: 'China', lat: 38.8632, lon: 111.589639 },
  { id: 'tanegashima-lp1', name: 'Tanegashima Space Center', pad: 'Yoshinobu LP-1', country: 'Japan', lat: 30.40095, lon: 130.97750 },
  { id: 'sdsc-slp', name: 'Satish Dhawan Space Centre', pad: 'Second Launch Pad', country: 'India', lat: 13.71991, lon: 80.23040 },
  { id: 'naro-lc2', name: 'Naro Space Center', pad: 'LC-2', country: 'South Korea', lat: 34.43194, lon: 127.53500 },
];

/** How many of PADS are the brief's (page 6), in the brief's order. */
export const BRIEF_PAD_COUNT = 7;

export const DEFAULT_PAD_ID = 'ksc-39a';

/** The pad with this id, or the default pad (Kennedy LC-39A) for an unknown id. */
export function padById(id: string | null | undefined): Pad {
  return PADS.find((p) => p.id === id) ?? (PADS.find((p) => p.id === DEFAULT_PAD_ID) as Pad);
}
