import { describe, expect, it } from 'vitest';
import { decadeText, failedDecadesText, noRowText } from './tableGap';

const at = (iso: string): number => Date.parse(iso);

describe('decadeText', () => {
  it('names the calendar decade, in UTC', () => {
    expect(decadeText(at('2050-01-01T00:00:00Z'))).toBe('2050s');
    expect(decadeText(at('2055-06-15T12:00:00Z'))).toBe('2050s');
    expect(decadeText(at('2059-12-31T23:59:59Z'))).toBe('2050s');
    expect(decadeText(at('1900-01-01T00:00:00Z'))).toBe('1900s');
  });
});

describe('noRowText', () => {
  it('a failed decade says it did not download and is tried again, not "outside"', () => {
    const text = noRowText('failed', at('2055-01-01T00:00:00Z'));
    expect(text).toBe('The Sun and Earth table for the 2050s did not download. Trying again…');
    expect(text).not.toMatch(/outside/);
  });

  it('outside the table keeps the old words', () => {
    expect(noRowText('outside', at('1850-01-01T00:00:00Z'))).toBe('This time is outside the Sun and Earth table');
  });
});

describe('failedDecadesText', () => {
  it('lists the decades for the status line, or nothing', () => {
    expect(failedDecadesText([])).toBe('');
    expect(failedDecadesText([at('2050-01-01T00:00:00Z')])).toBe('Sun and Earth table for the 2050s (trying again)');
    expect(failedDecadesText([at('2030-01-01T00:00:00Z'), at('2050-01-01T00:00:00Z')]))
      .toBe('Sun and Earth table for the 2030s, 2050s (trying again)');
  });
});
