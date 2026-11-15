import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_KM } from '../core/types';
import { moonCentre, siteNorth, sitePosition, siteUp } from './coordinates';
import {
  ABOVE_MAX_KM, ABOVE_MIN_KM, abovePose, blendPose, easeInOut, FADE_MS, fadeAt, fadeDone, heightFor,
  MAX_STEP_MS, mapUp, startFade, stepFade, type Pose,
} from './transition';

const near = (a: Vector3, b: Vector3, tol = 1e-9): void => { expect(a.distanceTo(b)).toBeLessThan(tol); };

describe('easeInOut', () => {
  it('runs from 0 to 1, symmetric, always forward', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    let last = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v + easeInOut(1 - t)).toBeCloseTo(1, 9);
      last = v;
    }
  });
  it('starts and ends with no speed, so neither end jumps', () => {
    expect(easeInOut(0.01) / 0.01).toBeLessThan(0.01);
    expect((1 - easeInOut(0.99)) / 0.01).toBeLessThan(0.01);
  });
});

describe('fade progress', () => {
  it('is null when the view is already there; otherwise takes its share of FADE_MS', () => {
    expect(startFade(1, 1)).toBeNull();
    expect(startFade(0, 0)).toBeNull();
    expect(startFade(0, 1)!.durationMs).toBe(FADE_MS);
    expect(startFade(0.25, 0)!.durationMs).toBeCloseTo(FADE_MS / 4, 9);
  });
  it('shows its start on the first frame and exactly its end at the end', () => {
    const fade = startFade(0, 1)!;
    expect(stepFade(fade, 5000)).toBe(0);
    let shown = 0;
    for (let now = 5016; !fadeDone(fade); now += 16) {
      const next = stepFade(fade, now);
      expect(next).toBeGreaterThanOrEqual(shown);
      // At 60 frames a second, no frame moves the cross-fade by more than a tenth.
      expect(next - shown).toBeLessThan(0.1);
      shown = next;
    }
    expect(shown).toBe(1);
    expect(fadeAt(fade)).toBe(1);
  });
  it('moves on by MAX_STEP_MS at most for a long frame', () => {
    const fade = startFade(0, 1)!;
    stepFade(fade, 0);
    stepFade(fade, 2000);   // a two-second pause
    expect(fade.elapsedMs).toBe(MAX_STEP_MS);
    expect(fadeDone(fade)).toBe(false);
  });
  it('holds at its start while the 3D view is built, then runs', () => {
    const fade = startFade(0, 1)!;
    stepFade(fade, 0, true);
    expect(stepFade(fade, 50, true)).toBe(0);
    expect(stepFade(fade, 100, true)).toBe(0);
    expect(stepFade(fade, 150)).toBeGreaterThan(0);
  });
  it('turned round half-way, goes back from where it is', () => {
    const forward = startFade(0, 1)!;
    stepFade(forward, 0);
    let shown = 0;
    for (let now = 16; now <= 400; now += 16) shown = stepFade(forward, now);
    expect(shown).toBeGreaterThan(0.2);
    expect(shown).toBeLessThan(0.8);
    const back = startFade(shown, 0)!;
    expect(back.durationMs).toBeCloseTo(FADE_MS * shown, 9);
    expect(stepFade(back, 416)).toBe(shown);   // no snap: the same place
    const next = stepFade(back, 432);
    expect(next).toBeLessThan(shown);
    expect(shown - next).toBeLessThan(0.01);   // and it eases into the way back
  });
});

describe('mapUp', () => {
  it('is a unit vector along the ground', () => {
    for (const [site, kind] of [[{ lat: -88, lon: 45 }, 'south'], [{ lat: -89.67, lon: 129.78 }, 'south'], [{ lat: 85, lon: -30 }, 'north'], [{ lat: 10, lon: 170 }, 'global'], [{ lat: -60, lon: -100 }, 'global']] as const) {
      const v = mapUp(site, kind);
      expect(v.length()).toBeCloseTo(1, 9);
      expect(Math.abs(v.dot(siteUp(site)))).toBeLessThan(1e-6);
    }
  });
  it('points north on the whole-Moon map', () => {
    for (const site of [{ lat: 0, lon: 0 }, { lat: 45, lon: 120 }, { lat: -70, lon: -179 }]) {
      near(mapUp(site, 'global'), siteNorth(siteUp(site)), 1e-6);
    }
  });
  it('points toward longitude 0 at the south pole, and the map\'s up elsewhere on its cap', () => {
    // At the pole, longitude 0 is -Z in the render frame (coordinates.ts).
    near(mapUp({ lat: -90, lon: 0 }, 'south'), new Vector3(0, 0, -1), 1e-6);
    // On the polar map, y grows toward longitude 0 from the pole: at 90 E, up the map is along -Z too.
    near(mapUp({ lat: -88, lon: 90 }, 'south'), new Vector3(0, 0, -1), 1e-3);
    // At longitude 0, up the map is away from the pole along the meridian: north.
    near(mapUp({ lat: -88, lon: 0 }, 'south'), siteNorth(siteUp({ lat: -88, lon: 0 })), 1e-6);
  });
  it('turns round where up leaves the whole-Moon map past the north pole', () => {
    const v = mapUp({ lat: 90, lon: 0 }, 'global');
    expect(v.length()).toBeCloseTo(1, 9);
  });
});

describe('abovePose', () => {
  const site = { lat: -88, lon: 45 };
  const target = sitePosition(site, 1200, 2);
  it('looks straight down at the site, high enough to see what the map shows', () => {
    const pose = abovePose(target, site, 'south', 150, 45);
    near(pose.target, target);
    const height = pose.position.clone().sub(target);
    near(height.clone().normalize(), siteUp(site), 1e-9);
    expect(height.length()).toBeCloseTo(heightFor(150, 45), 9);
    // 150 km tall in a 45 degree view: 2 h tan(22.5 degrees) = 150.
    expect(2 * height.length() * Math.tan(22.5 * Math.PI / 180)).toBeCloseTo(150, 9);
    near(pose.up, mapUp(site, 'south'));
  });
  it('stays between the orbit\'s closest and a view well past the whole Moon', () => {
    expect(abovePose(target, site, 'south', 0, 45).position.distanceTo(target)).toBeCloseTo(ABOVE_MIN_KM, 9);
    expect(abovePose(target, site, 'global', 1e9, 45).position.distanceTo(target)).toBeCloseTo(ABOVE_MAX_KM, 6);
  });
});

describe('blendPose', () => {
  const site = { lat: -88, lon: 45 };
  const target = sitePosition(site);
  const above = abovePose(target, site, 'south', 150, 45);
  const orbit: Pose = {
    position: target.clone().add(new Vector3(30, 45, 55)), target: target.clone(), up: siteUp(site),
  };
  it('is exactly the first pose at 0 and exactly the second at 1', () => {
    const a = blendPose(above, orbit, 0), b = blendPose(above, orbit, 1);
    expect(a.position.equals(above.position) && a.target.equals(above.target) && a.up.equals(above.up)).toBe(true);
    expect(b.position.equals(orbit.position) && b.target.equals(orbit.target) && b.up.equals(orbit.up)).toBe(true);
    // Fresh vectors: moving the result never moves the poses it came from.
    b.position.x += 1;
    expect(b.position.equals(orbit.position)).toBe(false);
  });
  it('moves smoothly: no jump anywhere, including next to either end', () => {
    const steps = 1000;
    const whole = above.position.distanceTo(orbit.position);
    let last = blendPose(above, orbit, 0);
    for (let i = 1; i <= steps; i++) {
      const pose = blendPose(above, orbit, i / steps);
      expect(pose.position.distanceTo(last.position)).toBeLessThan((3 * whole) / steps);
      expect(pose.up.distanceTo(last.up)).toBeLessThan(0.01);
      expect(pose.up.length()).toBeCloseTo(1, 9);
      last = pose;
    }
  });
  it('goes round the Moon, not through it, between views on opposite sides', () => {
    const far: Pose = {
      position: moonCentre().addScaledVector(siteUp({ lat: 60, lon: -135 }), MOON_RADIUS_KM * 3),
      target: moonCentre(), up: new Vector3(0, -1, 0),
    };
    const start = abovePose(target, site, 'south', 150, 45);
    for (let i = 0; i <= 100; i++) {
      const pose = blendPose(start, far, i / 100);
      expect(pose.position.distanceTo(moonCentre())).toBeGreaterThan(MOON_RADIUS_KM);
    }
  });
});
