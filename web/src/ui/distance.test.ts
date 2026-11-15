import { describe, expect, it } from 'vitest';
import { distanceText } from './distance';

describe('distanceText (T43)', () => {
  it('writes metres under a kilometre and kilometres above', () => {
    expect(distanceText(240)).toBe('240 m');
    expect(distanceText(480)).toBe('480 m');
    expect(distanceText(1200)).toBe('1.2 km');
    expect(distanceText(3790.4)).toBe('3.8 km');
    expect(distanceText(9990)).toBe('10 km');
    expect(distanceText(15162)).toBe('15 km');
  });
});
