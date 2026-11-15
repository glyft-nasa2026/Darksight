import { describe, expect, it } from 'vitest';
import { SUN_ANGULAR_RADIUS_DEG, SUN_HALO, sunAlpha, sunSpriteScale } from './sun';

describe('Sun sprite', () => {
  it('uses the Sun\'s mean angular radius seen from the Moon, about 0.267 degrees', () => {
    expect(SUN_ANGULAR_RADIUS_DEG).toBeCloseTo(0.2665, 3);
  });
  it('draws the disc at its true apparent size, inside a glow SUN_HALO disc radii wide', () => {
    const drawnKm = 21_000;
    const discDiameter = sunSpriteScale(drawnKm) / SUN_HALO;
    const angleDeg = 2 * Math.atan(discDiameter / 2 / drawnKm) * 180 / Math.PI;
    expect(angleDeg).toBeCloseTo(2 * SUN_ANGULAR_RADIUS_DEG, 6);
  });
  it('is solid across the disc and fades to nothing at the sprite\'s edge', () => {
    expect(sunAlpha(0)).toBe(1);
    expect(sunAlpha(1)).toBe(1);
    expect(sunAlpha(SUN_HALO)).toBe(0);
    let last = 1;
    for (let r = 1.01; r <= SUN_HALO; r += 0.1) {
      const a = sunAlpha(r);
      expect(a).toBeLessThan(last);
      expect(a).toBeGreaterThanOrEqual(0);
      last = a;
    }
  });
});
