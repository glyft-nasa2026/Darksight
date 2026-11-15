import { describe, expect, it } from 'vitest';
import { END_LOOK_DAYS } from '../../core/datesearch';
import { dateSearchText, HOUR_CHOICES, hoursText, MONTH_CHOICES, monthsText, NEED_CHOICES } from './dateSearchText';

const FROM = Date.parse('2026-11-15T00:00:00Z');
const END = Date.parse('2027-05-15T00:00:00Z');
const HOUR = 3_600_000;
const none = () => 'none' as const;
const text = (r: Parameters<typeof dateSearchText>[0], need: 'both' | 'sun' | 'earth' = 'both') =>
  dateSearchText(r, need, 48, 6, FROM, none, END);

describe('date search wording (T42)', () => {
  it('says when the window starts and how long it lasts, with the countdowns\' durations', () => {
    const start = Date.parse('2027-03-12T06:40:00Z');
    expect(text({ status: 'found', startMs: start, endMs: start + 76 * HOUR + 59 * 60_000 }))
      .toBe('Sun and Earth together for 3 d 4 h from 2027-03-12 06:40 UTC');
    expect(text({ status: 'found', startMs: start, endMs: start + 5 * HOUR + 20 * 60_000 }, 'sun'))
      .toBe('Sunlight for 5 h 20 min from 2027-03-12 06:40 UTC');
    expect(text({ status: 'found', startMs: start, endMs: null }, 'earth'))
      .toBe(`Earth in view for more than ${END_LOOK_DAYS} days from 2027-03-12 06:40 UTC`);
  });

  it('says "now" when the window is already under way', () => {
    expect(text({ status: 'found', startMs: FROM, endMs: FROM + 50 * HOUR }))
      .toBe('The Sun and Earth are up together now, for 2 d 2 h');
  });

  it('says what it looked for when there is none, and where the table ends first', () => {
    expect(text({ status: 'none', checkedToMs: END }))
      .toBe('No 48 h window of Sun and Earth together in the next 6 months');
    expect(text({ status: 'none', checkedToMs: Date.parse('2101-01-01T00:00:00Z') - 1 }).startsWith(
      'No 48 h window of Sun and Earth together in the next 6 months')).toBe(true);
    expect(dateSearchText({ status: 'none', checkedToMs: FROM + HOUR }, 'sun', 24, 12, FROM, none, END))
      .toBe('No 24 h window of sunlight before the end of the table (2026-11-15 01:00 UTC)');
  });

  it('says "Searching…" while decades load, and why when a decade did not download', () => {
    expect(text({ status: 'loading' })).toBe('Searching…');
    const d2030 = Date.parse('2030-01-01T00:00:00Z');
    expect(text({ status: 'failed', decadeMs: d2030 }))
      .toBe('The Sun and Earth table for the 2030s did not download. Trying again…');
    expect(dateSearchText({ status: 'no-rows', atMs: d2030 }, 'both', 48, 6, FROM, () => 'failed', END))
      .toBe('Searched to 2030-01-01 00:00 UTC. The Sun and Earth table for the 2030s did not download. Trying again…');
  });

  it('words the menus', () => {
    expect(HOUR_CHOICES.map(hoursText)).toEqual(['48 h', '24 h', '96 h', '7 d']);
    expect(MONTH_CHOICES.map(monthsText)).toEqual(['6 months', '1 month', '3 months', '12 months']);
    expect(NEED_CHOICES[0].value).toBe('both');
  });
});
