// T42: the words for the date search in the scenario panel. Pure: no DOM, no state, so vitest
// can run it in node. Every time and duration in it comes from core/ (datesearch.ts and
// windows.ts's durationText); this only words them.

import { END_LOOK_DAYS, type Need } from '../../core/datesearch';
import { durationText } from '../../core/windows';
import type { DateSearchFor, TableGap } from '../../state';
import { noRowText } from '../tableGap';
import { utcText } from './input';

/** The choices in the panel, defaults first. Agreed in the pull request. */
export const NEED_CHOICES: readonly { value: Need; label: string }[] = [
  { value: 'both', label: 'Sun and Earth' },
  { value: 'sun', label: 'Sun only' },
  { value: 'earth', label: 'Earth only' },
];
export const HOUR_CHOICES: readonly number[] = [48, 24, 96, 168];
export const MONTH_CHOICES: readonly number[] = [6, 1, 3, 12];

const NEED_WORDS: Record<Need, { what: string; are: string }> = {
  both: { what: 'Sun and Earth together', are: 'The Sun and Earth are up together' },
  sun: { what: 'sunlight', are: 'The Sun is up' },
  earth: { what: 'Earth in view', are: 'Earth is in view' },
};

/** "48 h", "7 d": how a threshold reads in a menu and a message. */
export function hoursText(hours: number): string {
  return hours % 24 === 0 && hours >= 168 ? `${hours / 24} d` : `${hours} h`;
}

/** "1 month", "6 months". */
export function monthsText(months: number): string {
  return months === 1 ? '1 month' : `${months} months`;
}

/**
 * The line under the button for a search from fromMs. gapAt is state.ts's tableGap(), asked
 * only for a time with no row.
 */
export function dateSearchText(
  r: DateSearchFor, need: Need, hours: number, months: number, fromMs: number,
  gapAt: (tMs: number) => TableGap, searchEndMs: number,
): string {
  const words = NEED_WORDS[need];
  switch (r.status) {
    case 'loading':
      return 'Searching…';
    case 'failed':
      return noRowText('failed', r.decadeMs);
    case 'no-rows':
      return `Searched to ${utcText(r.atMs)} UTC. ${noRowText(gapAt(r.atMs), r.atMs)}`;
    case 'none':
      return r.checkedToMs < searchEndMs
        ? `No ${hoursText(hours)} window of ${words.what} before the end of the table (${utcText(r.checkedToMs)} UTC)`
        : `No ${hoursText(hours)} window of ${words.what} in the next ${monthsText(months)}`;
    case 'found': {
      const lasts = r.endMs === null
        ? `for more than ${END_LOOK_DAYS} days`
        : `for ${durationText(r.endMs - r.startMs)}`;
      return r.startMs === fromMs
        ? `${words.are} now, ${lasts}`
        : `${words.what[0].toUpperCase()}${words.what.slice(1)} ${lasts} from ${utcText(r.startMs)} UTC`;
    }
  }
}
