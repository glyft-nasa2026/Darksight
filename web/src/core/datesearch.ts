// Date search (T42): the first time, from a scenario's time on, when the Sun, Earth or both stay
// up without a break for at least a given number of hours. Built on windows.ts: every sample
// comes from series(), so "up" means exactly what the countdowns and strips mean by it (the Sun
// while any of its disc shows, Earth while its centre clears the skyline), and an edge is found
// the way nextFlip() finds one. No angles are worked out here.

import type { Ephemeris } from './ephemeris';
import type { Sample, Site, Skyline } from './types';
import { series } from './windows';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** What has to be up: the Sun, Earth, or both at once. */
export type Need = 'both' | 'sun' | 'earth';

/**
 * How far past a window's start its end is looked for, in days, as the countdowns look 60 days
 * ahead. A window still going then is reported with `endMs: null`, "more than 60 days".
 */
export const END_LOOK_DAYS = 60;

/**
 * - `found`: the window starts at `startMs` (the search's own start when it is already under
 *   way then, else rounded up to the whole minute) and ends at `endMs`, or null when it lasts
 *   more than END_LOOK_DAYS (or runs to the end of the table).
 * - `none`: no window starts before `checkedToMs`: the search's end, or the end of the table
 *   (2100) when that comes first.
 * - `no-rows`: the table has no row at `atMs` (before 1900, or a decade not in memory), so the
 *   search stopped there without an answer. Never read as "hidden".
 */
export type DateSearch =
  | { status: 'found'; startMs: number; endMs: number | null }
  | { status: 'none'; checkedToMs: number }
  | { status: 'no-rows'; atMs: number };

/** tMs plus whole calendar months, in UTC. A day the month doesn't have becomes its last day. */
export function monthsLater(tMs: number, months: number): number {
  const d = new Date(tMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

const isUp = (s: Sample, need: Need): boolean =>
  need === 'sun' ? s.sunFrac > 0 : need === 'earth' ? s.earthUp : s.sunFrac > 0 && s.earthUp;

/**
 * The first window at or after startMs, starting before endMs, in which `need` holds without a
 * break for at least minHours. Samples hourly from startMs, as the compare table does, so a dip
 * shorter than an hour between two samples is not seen; each edge is then halved to under one
 * minute, as nextFlip() does, so a window's start agrees with the countdown's rise. A window
 * under way at startMs counts from startMs. One that starts before endMs but ends after it is
 * still found: its end is looked for up to END_LOOK_DAYS past its start.
 */
export function firstWindow(
  eph: Ephemeris, site: Site, groundM: number, skyline: Skyline,
  startMs: number, endMs: number, need: Need, minHours: number,
): DateSearch {
  if (!Number.isFinite(startMs) || !(endMs > startMs) || !(minHours > 0)) {
    return { status: 'none', checkedToMs: Number.isFinite(startMs) ? startMs : 0 };
  }
  const minMs = minHours * HOUR_MS;
  const lookMs = Math.max(minMs, END_LOOK_DAYS * DAY_MS);

  /**
   * Up or not at t; 'end' at or after the end of the table; 'no-row' without a row there. A
   * decade not in memory is asked about first: vectorsAt() would quietly hand back the nearest
   * loaded row, a Sun and Earth standing still, not NaN.
   */
  const read = (t: number): boolean | 'end' | 'no-row' => {
    if (t >= eph.endMs) return 'end';
    if (t < eph.startMs || eph.missing(t, t).length > 0) return 'no-row';
    const s = series(eph, site, groundM, skyline, t, t + 1, HOUR_MS)[0];
    if (!s || !Number.isFinite(s.sun.alt) || !Number.isFinite(s.earth.alt)) return 'no-row';
    return isUp(s, need);
  };
  /** Between lo and hi (under an hour apart, and read differently), the first time read as hi. */
  const edge = (lo: number, hi: number): number => {
    const hiUp = read(hi) === true;
    while (hi - lo >= MIN_MS) {
      const mid = (lo + hi) / 2;
      if ((read(mid) === true) === hiUp) hi = mid; else lo = mid;
    }
    return hi;
  };

  let t = startMs;
  let first = true;
  while (t < endMs) {
    const r = read(t);
    if (r === 'end') return { status: 'none', checkedToMs: eph.endMs };
    if (r === 'no-row') return { status: 'no-rows', atMs: t };
    if (!r) {
      first = false;
      t += HOUR_MS;
      continue;
    }
    // A window starts: at startMs itself, or within the hour before t.
    const winStart = first ? startMs : Math.min(t, Math.ceil(edge(t - HOUR_MS, t) / MIN_MS) * MIN_MS);
    first = false;
    // Walk on to its end.
    let u = t + HOUR_MS;
    for (;;) {
      if (u - HOUR_MS - winStart >= lookMs) return { status: 'found', startMs: winStart, endMs: null };
      const ru = read(u);
      if (ru === true) {
        u += HOUR_MS;
        continue;
      }
      if (ru === 'end') {
        return eph.endMs - winStart >= minMs
          ? { status: 'found', startMs: winStart, endMs: null }
          : { status: 'none', checkedToMs: eph.endMs };
      }
      if (ru === 'no-row') {
        // Up at least until the last row: enough, or no answer yet.
        return u - HOUR_MS - winStart >= minMs
          ? { status: 'found', startMs: winStart, endMs: null }
          : { status: 'no-rows', atMs: u };
      }
      const winEnd = edge(u - HOUR_MS, u);
      if (winEnd - winStart >= minMs) return { status: 'found', startMs: winStart, endMs: winEnd };
      break;
    }
    t = u;   // hidden at u: carry on from there
  }
  return { status: 'none', checkedToMs: endMs };
}
