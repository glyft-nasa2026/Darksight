// Launch pads on Earth for the mission simulation (T34). The brief's seven (page 6), with their
// coordinates checked against each pad's page (docs/sources/T34.md), not copied from the brief:
// the brief's numbers for ELA-4 and SLS-2 belong to the pads next to them.
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
];

export const DEFAULT_PAD_ID = 'ksc-39a';

/** The pad with this id, or the default pad (Kennedy LC-39A) for an unknown id. */
export function padById(id: string | null | undefined): Pad {
  return PADS.find((p) => p.id === id) ?? (PADS.find((p) => p.id === DEFAULT_PAD_ID) as Pad);
}
