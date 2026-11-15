// The Earth globe shared by the launch-site picker and the launch simulation page (T34).
// The picture is NASA's Blue Marble (public domain, docs/sources/T34.md), an equirectangular
// image with longitude -180 at its left edge, so it wraps three.js's sphere as it is.
// This file only draws: no number shown to the user is computed here.
import * as THREE from 'three';
import { themeColor } from '../plotTheme';

const TEXTURE = 'textures/earth.jpg';

/**
 * The unit vector to a latitude and longitude (degrees) on a three.js sphere wearing an
 * equirectangular map: longitude 0 on +x, 90 E on -z, the north pole on +y.
 */
export function earthDirection(latDeg: number, lonDeg: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

/** A globe of this radius. It shows --earth until the picture arrives, and stays so if it can't load. */
export function makeEarth(radius: number, shaded: boolean): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 96, 64);
  const material = shaded
    ? new THREE.MeshLambertMaterial({ color: themeColor('--earth') })
    : new THREE.MeshBasicMaterial({ color: themeColor('--earth') });
  new THREE.TextureLoader().load(import.meta.env.BASE_URL + TEXTURE, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
    material.color.setScalar(1);   // white: the picture's own colours, untinted
    material.needsUpdate = true;
  });
  return new THREE.Mesh(geometry, material);
}

/** A theme length ('8px', '0.5rem') in pixels, for three.js sizes. */
export function themeLength(name: string): number {
  const raw = themeColor(name);
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith('rem') ? value * parseFloat(getComputedStyle(document.documentElement).fontSize) : value;
}

/** Frees a scene's geometries, materials and textures. */
export function disposeScene(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}

export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
