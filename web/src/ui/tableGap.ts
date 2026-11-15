// What a module says when the Sun and Earth table has no row for a time (T33, issue #32 row 4):
// the time is before 1900 or after 2100, or its decade's file did not download and state.ts is
// trying again. One place for the words, so the readout, panel, nudge, sky, timeline, 3D view
// and status line all say the same. Pure: the caller passes state.ts's tableGap().

import type { TableGap } from '../state';

/** The decade holding tMs, by name: '2050s'. The table's files are one per calendar decade. */
export function decadeText(tMs: number): string {
  return `${Math.floor(new Date(tMs).getUTCFullYear() / 10) * 10}s`;
}

/** The sentence for a time with no row: a failed download when gap is 'failed', outside the table otherwise. */
export function noRowText(gap: TableGap, tMs: number): string {
  return gap === 'failed'
    ? `The Sun and Earth table for the ${decadeText(tMs)} did not download. Trying again…`
    : 'This time is outside the Sun and Earth table';
}

/** The status line's words for the decades that failed (their start times), or '' for none. */
export function failedDecadesText(startsMs: number[]): string {
  return startsMs.length === 0 ? '' : `Sun and Earth table for the ${startsMs.map(decadeText).join(', ')} (trying again)`;
}
