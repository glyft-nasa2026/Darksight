// How a distance core/ gives (a cell size, the ground a slope is measured over) is written, in one
// place, so the map-layer legend and the readout's slope line say the same (T43). Pure: it only
// rounds and labels.

/** "240 m", "1.2 km", "3.8 km", "15 km". */
export function distanceText(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 9950) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}
