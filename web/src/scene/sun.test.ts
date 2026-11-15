import { describe, expect, it } from 'vitest';
import { discAlpha, glareAlpha, SUN_ANGULAR_RADIUS_DEG, sunDiscScale } from './sun';

describe('Sun sprites', () => {
  it('uses the Sun\'s mean angular radius seen from the Moon, about 0.267 degrees', () => {
    expect(SUN_ANGULAR_RADIUS_DEG).toBeCloseTo(0.2665, 3);
  });
  it('draws the disc at its true apparent size', () => {
    const drawnKm = 21_000;
    const angleDeg = 2 * Math.atan(sunDiscScale(drawnKm) / 2 / drawnKm) * 180 / Math.PI;
    expect(angleDeg).toBeCloseTo(2 * SUN_ANGULAR_RADIUS_DEG, 6);
  });
  it('keeps the disc solid to its rim and empty outside it', () => {
    expect(discAlpha(0)).toBe(1);
    expect(discAlpha(0.9)).toBeCloseTo(1, 6);
    expect(discAlpha(0.95)).toBeCloseTo(0.5, 6);
    expect(discAlpha(1)).toBe(0);
  });
  it('fades the glare from the middle to nothing at its edge', () => {
    expect(glareAlpha(1)).toBe(0);
    let last = 1;
    for (let r = 0; r < 1; r += 0.05) {
      const a = glareAlpha(r);
      expect(a).toBeLessThan(last);
      expect(a).toBeGreaterThan(0);
      last = a;
    }
  });
});
