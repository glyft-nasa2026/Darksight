import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { MOON_RADIUS_KM } from '../core/types';
import { moonCentre } from './coordinates';
import { hiddenByMoon, poleLines, POLES, POLE_REACH, poleStub, viewportFraction } from './poles';

const R = MOON_RADIUS_KM;
const north = POLES.find((p) => p.id === 'north')!, south = POLES.find((p) => p.id === 'south')!;

describe('poleStub', () => {
  it('rises from each pole along the spin axis, out to POLE_REACH radii', () => {
    const [sBase, sTip] = poleStub(south), [nBase, nTip] = poleStub(north);
    // Render frame: the origin is the south pole, +Y is south, the centre is (0, -R, 0).
    expect(sBase.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-9);
    expect(nBase.distanceTo(new Vector3(0, -2 * R, 0))).toBeLessThan(1e-9);
    expect(sTip.y).toBeCloseTo((POLE_REACH - 1) * R, 6);
    expect(nTip.y).toBeCloseTo(-R - POLE_REACH * R, 6);
    for (const tip of [sTip, nTip]) {
      expect(tip.x).toBeCloseTo(0, 9); expect(tip.z).toBeCloseTo(0, 9);
      expect(tip.distanceTo(moonCentre())).toBeCloseTo(POLE_REACH * R, 6);
    }
  });

  it('draws two segments, one per pole', () => {
    const lines = poleLines();
    expect(lines.geometry.getAttribute('position').count).toBe(4);
    lines.geometry.dispose(); lines.material.dispose();
  });
});

describe('hiddenByMoon', () => {
  const [, sTip] = poleStub(south), [, nTip] = poleStub(north);
  it('hides the far pole when looking from over the other one', () => {
    const eye = new Vector3(0, 3 * R, 0);
    expect(hiddenByMoon(eye, sTip)).toBe(false);
    expect(hiddenByMoon(eye, nTip)).toBe(true);
  });

  it('shows both tips from over the equator, since they stand clear of the limb', () => {
    const eye = new Vector3(0, -R, -6 * R);
    expect(hiddenByMoon(eye, sTip)).toBe(false);
    expect(hiddenByMoon(eye, nTip)).toBe(false);
  });

  it('is false for a point in front of the sphere, even on the line to it', () => {
    const eye = new Vector3(0, -R, -6 * R);
    expect(hiddenByMoon(eye, new Vector3(0, -R, -2 * R))).toBe(false);
    expect(hiddenByMoon(eye, new Vector3(0, -R, 2 * R))).toBe(true);
  });
});

describe('viewportFraction', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  it('puts the point looked at in the middle', () => {
    const at = viewportFraction(camera, new Vector3(0, 0, 0))!;
    expect(at.x).toBeCloseTo(0.5, 9); expect(at.y).toBeCloseTo(0.5, 9);
  });
  it('measures down from the top', () => {
    expect(viewportFraction(camera, new Vector3(0, 1, 0))!.y).toBeLessThan(0.5);
  });
  it('is null behind the camera or off screen', () => {
    expect(viewportFraction(camera, new Vector3(0, 0, 20))).toBeNull();
    expect(viewportFraction(camera, new Vector3(100, 0, 0))).toBeNull();
  });
});
