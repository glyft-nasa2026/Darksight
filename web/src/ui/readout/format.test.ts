import { describe, expect, it } from 'vitest';
import { azText, degText, pctText, slopeText } from './format';

describe('degText', () => {
  it('rounds to two decimals with a true minus sign', () => {
    expect(degText(1.2345)).toBe('1.23°');
    expect(degText(-1.25)).toBe('−1.25°');
    expect(degText(-0.001)).toBe('0.00°');
  });
});

describe('azText', () => {
  it('adds the compass point, clockwise from north', () => {
    expect(azText(0)).toBe('0.0° (N)');
    expect(azText(90)).toBe('90.0° (E)');
    expect(azText(135)).toBe('135.0° (SE)');
    expect(azText(270)).toBe('270.0° (W)');
    expect(azText(359.99)).toBe('0.0° (N)');
    expect(azText(-10)).toBe('350.0° (N)');
  });
});

describe('pctText', () => {
  it('shows whole percentages, clamped', () => {
    expect(pctText(0)).toBe('0 %');
    expect(pctText(0.734)).toBe('73 %');
    expect(pctText(1)).toBe('100 %');
    expect(pctText(1.2)).toBe('100 %');
  });
  it('never rounds a sliver to none or all', () => {
    expect(pctText(0.001)).toBe('1 %');
    expect(pctText(0.999)).toBe('99 %');
  });
});

describe('slopeText (T41)', () => {
  it('rounds to whole degrees and says what it is measured over', () => {
    expect(slopeText({ kind: 'ok', deg: 7.3, baselineM: 240 })).toBe('Ground slope 7° (over 240 m)');
    expect(slopeText({ kind: 'ok', deg: 29.6, baselineM: 240 })).toBe('Ground slope 30° (over 240 m)');
    expect(slopeText({ kind: 'ok', deg: 0.2, baselineM: 960 })).toBe('Ground slope under 1° (over 960 m)');
  });

  it('says why there is no slope', () => {
    expect(slopeText({ kind: 'outside', minLat: -80 })).toBe('Ground slope: no height map here (it covers 80° S to the pole)');
    expect(slopeText({ kind: 'loading' })).toBe('Ground slope: waiting for the height map');
    expect(slopeText({ kind: 'nodata' })).toBe('Ground slope: the height map has no data around this point');
  });
});
