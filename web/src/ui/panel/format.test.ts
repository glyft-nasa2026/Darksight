import { describe, expect, it } from 'vitest';
import { powerText } from './format';

describe('powerText', () => {
  it('rounds to a whole percentage', () => {
    expect(powerText(0.01745)).toBe('2 %');
    expect(powerText(0.99985)).toBe('100 %');
    expect(powerText(0.5)).toBe('50 %');
  });
  it('never shows a sliver of power as 0 %', () => {
    expect(powerText(0.004)).toBe('under 1 %');
  });
  it('shows no power, a negative or NaN as 0 % and caps at 100 %', () => {
    expect(powerText(0)).toBe('0 %');
    expect(powerText(-0.1)).toBe('0 %');
    expect(powerText(Number.NaN)).toBe('0 %');
    expect(powerText(1.2)).toBe('100 %');
  });
});

// T40: the battery lines. Imports on lines of their own.
import { chargeText, hoursText } from './format';

describe('battery text (T40)', () => {
  it('writes hours, days and "for ever"', () => {
    expect(hoursText(20)).toBe('20 h');
    expect(hoursText(2.25)).toBe('2.3 h');
    expect(hoursText(100)).toBe('4 days');
    expect(hoursText(Infinity)).toBe('for ever');
  });
  it('writes a charge, never 0 % or 100 % unless it is', () => {
    expect(chargeText(0)).toBe('0 %');
    expect(chargeText(0.001)).toBe('1 %');
    expect(chargeText(0.999)).toBe('99 %');
    expect(chargeText(1)).toBe('100 %');
  });
});
