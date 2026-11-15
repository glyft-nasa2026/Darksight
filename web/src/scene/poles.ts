// Issue #107: the Moon's north and south poles marked in the 3D view. A short stub of the spin
// axis rises from each pole, with a label at its tip, so the globe's orientation can be read at a
// glance. A picture only: no number shown to the user comes from here.
import { BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments, Vector3, type Camera } from 'three';
import { MOON_RADIUS_KM } from '../core/types';
import { moonCentre, sitePosition } from './coordinates';

/** Each stub reaches this far from the Moon's centre, in Moon radii: about 430 km above the pole. */
export const POLE_REACH = 1.25;

export type Pole = { id: 'north' | 'south'; label: string; lat: number };
export const POLES: readonly Pole[] = [
  { id: 'north', label: 'N', lat: 90 },
  { id: 'south', label: 'S', lat: -90 },
];

/** Where a pole's stub starts (on the sphere) and ends, in the render frame. */
export function poleStub(pole: Pole): [Vector3, Vector3] {
  const base = sitePosition({ lat: pole.lat, lon: 0 });
  const tip = sitePosition({ lat: pole.lat, lon: 0 }, (POLE_REACH - 1) * MOON_RADIUS_KM * 1000);
  return [base, tip];
}

/** True when the Moon's sphere lies between the eye and the point, so the point can't be seen. */
export function hiddenByMoon(eye: Vector3, point: Vector3, radius = MOON_RADIUS_KM): boolean {
  const centre = moonCentre();
  const d = point.clone().sub(eye), length = d.length();
  if (length === 0) return false;
  d.divideScalar(length);
  const toCentre = centre.sub(eye);
  const along = toCentre.dot(d);
  const miss2 = toCentre.lengthSq() - along * along;
  if (miss2 >= radius * radius) return false;
  const half = Math.sqrt(radius * radius - miss2);
  const enter = along - half;
  // The sphere is entered somewhere between the eye and the point.
  return enter > 0 && enter < length;
}

/**
 * Where a point is drawn in the viewport, as fractions from its left and top (0 to 1), or null
 * when it is behind the camera or outside the view.
 */
export function viewportFraction(camera: Camera, point: Vector3): { x: number; y: number } | null {
  const p = point.clone().project(camera);
  if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
}

/** The two stubs as one line object. Its colour is set by the caller from the theme. */
export function poleLines(): LineSegments<BufferGeometry, LineBasicMaterial> {
  const positions = POLES.flatMap((pole) => poleStub(pole).flatMap((v) => v.toArray()));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: new Color() }));
  lines.name = 'Poles';
  return lines;
}
