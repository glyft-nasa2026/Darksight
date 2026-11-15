// Nudge (F11): the difference between the live scenario and a ghost one step away, in words.
// Kept apart from the page so it can be tested. Every number comes from core/ through state.ts;
// this file only compares and words them.

import type { Flip, TerrainGrid } from '../../core/types';

const HOUR_MS = 3_600_000;
/** Hours in the 30 days that summaryFor covers. */
export const WINDOW_H = 30 * 24;
/**
 * Below this a difference isn't worth reporting, hours: under 1 % of the 30 days. On a smooth
 * Moon a 1 km move tilts the horizon by 0.03 degrees, and Earth, which creeps across the horizon
 * at about half a degree a day, then rises an hour or two sooner or later. That is real but
 * tiny next to what terrain does; the countdown table still shows the exact times.
 */
export const MEANINGFUL_H = 6;

/** One step. Bearings are clockwise from north, as for destination(). */
/** A step: a bearing (moved the slider's distance), a number of days, or straight to a latitude (a pole). */
export type Nudge = { id: string; text: string; bearing?: number; days?: number; lat?: number };
export const NUDGES: readonly Nudge[] = [
  { id: 'n', text: 'N', bearing: 0 },
  { id: 'w', text: 'W', bearing: 270 },
  { id: 's', text: 'S', bearing: 180 },
  { id: 'e', text: 'E', bearing: 90 },
  { id: 'minus-day', text: '−1 day', days: -1 },
  { id: 'plus-day', text: '+1 day', days: 1 },
];

/** Straight to a pole (issue #126), beside the N step: the live site's latitude becomes ±90. */
export const POLES: readonly Nudge[] = [
  { id: 'n-pole', text: 'N pole', lat: 90 },
  { id: 's-pole', text: 'S pole', lat: -90 },
];

/** The distance slider, km. */
export const NUDGE_KM = { min: 0.1, max: 10, step: 0.1, start: 1 } as const;

/** A slider value made safe: inside the range and on a step. Anything unreadable gives the start. */
export function clampKm(km: number): number {
  if (!Number.isFinite(km)) return NUDGE_KM.start;
  const stepped = Math.round(km / NUDGE_KM.step) * NUDGE_KM.step;
  return Math.min(NUDGE_KM.max, Math.max(NUDGE_KM.min, Math.round(stepped * 10) / 10));
}

/** "2.5 km", always one decimal, so the digits keep their width as the slider moves. */
export const kmText = (km: number): string => `${clampKm(km).toFixed(1)} km`;

/** What a step reads as with this distance: "2.5 km S", or "+1 day". */
export const stepText = (n: Nudge, km: number): string =>
  n.bearing === undefined ? n.text : `${kmText(km)} ${n.text}`;

/** The same, spelled out for a screen reader. */
const WORDS: Record<string, string> = { n: 'north', s: 'south', e: 'east', w: 'west' };
export const stepLabel = (n: Nudge, km: number): string =>
  n.lat !== undefined
    ? `Move the live site to the ${n.lat > 0 ? 'north' : 'south'} pole`
    : n.bearing === undefined
    ? `Move the live time ${n.text.replace('−', 'back ').replace('+', 'forward ')}`
    : `Move the live site ${kmText(km)} ${WORDS[n.id]}`;

/** The four corners of the map the panel can sit in, in the order the picker shows them. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];
export const CORNER_NAMES: Record<Corner, string> = {
  tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right',
};
/** Where the panel starts (issue #177): top left, clear of the layer icons in the top right. */
export const START_CORNER: Corner = 'tl';
/** Where to look next when a corner is taken: round the map clockwise from it. */
const CLOCKWISE: readonly Corner[] = ['tl', 'tr', 'br', 'bl'];

/**
 * The corner the panel goes to: the wanted one if the map's own controls leave it free,
 * otherwise the next free one clockwise. Null only if every corner is taken.
 */
export function freeCorner(wanted: Corner, taken: ReadonlySet<Corner>): Corner | null {
  const i = CLOCKWISE.indexOf(wanted);
  for (let k = 0; k < CLOCKWISE.length; k++) {
    const c = CLOCKWISE[(i + k) % CLOCKWISE.length];
    if (!taken.has(c)) return c;
  }
  return null;
}

/** The one corner button's order (issue #126): top left, top right, bottom left, bottom right, round again. */
export const CYCLE: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];

/** The corner after `at` in that order that the map's own controls leave free; `at` if none is. */
export function nextCorner(at: Corner, taken: ReadonlySet<Corner>): Corner {
  const i = CYCLE.indexOf(at);
  for (let k = 1; k <= CYCLE.length; k++) {
    const c = CYCLE[(i + k) % CYCLE.length];
    if (!taken.has(c)) return c;
  }
  return at;
}

/** A corner name read back from the page (a data attribute), or null if it isn't one. */
export const asCorner = (v: string | null | undefined): Corner | null =>
  (CORNERS as readonly string[]).includes(v ?? '') ? (v as Corner) : null;

export const DAY_MS = 24 * HOUR_MS;

/** What the comparison needs from one scenario. */
export type Facts = {
  tMs: number;
  litPct: number;      // summaryFor: share of the next 30 days with any of the Sun up
  earthPct: number;    // summaryFor: share with Earth up
  sunUp: boolean;      // at tMs
  earthUp: boolean;
  sunFlip: Flip;       // flipFor: next rise or set within 60 days, or null
  earthFlip: Flip;
  grid: TerrainGrid | null;    // T37: skylineFor(...).grid: 240 m, 1.2 km, 3.8 km, or null for a smooth Moon
};

export type Tone = 'ok' | 'bad' | 'muted';
export type Line = { text: string; tone: Tone };

const sign = (v: number): string => (v > 0 ? '+' : '−');

/** "31 h" under two days, otherwise "2 days" or "2.5 days". */
export function amountText(hours: number): string {
  const h = Math.abs(hours);
  if (h < 48) return `${Math.round(h)} h`;
  const d = Math.round((h / 24) * 2) / 2;
  return `${d} days`;
}

function pctLine(liveP: number, ghostP: number, what: string): Line | null {
  const dh = ((ghostP - liveP) / 100) * WINDOW_H;
  if (Math.abs(dh) < MEANINGFUL_H) return null;
  return { text: `${sign(dh)}${amountText(dh)} of ${what} in 30 days`, tone: dh > 0 ? 'ok' : 'bad' };
}

type Words = { set: [string, string]; rise: [string, string]; upNow: string; downNow: string; noSet: string; noRise: string;
  setSoon: string; riseSoon: string };
// [better, worse], each with {t} for the amount.
const SUN: Words = {
  set: ['sunset {t} later', 'sunset {t} earlier'],
  rise: ['sunrise {t} sooner', 'sunrise {t} later'],
  upNow: 'Sun up now (hidden before)',
  downNow: 'Sun hidden now (up before)',
  noSet: 'no sunset now in the next 60 days',
  noRise: 'no sunrise now in the next 60 days',
  setSoon: 'sunset now within 60 days (none before)',
  riseSoon: 'sunrise now within 60 days (none before)',
};
const EARTH: Words = {
  set: ['keeps Earth {t} longer', 'loses Earth {t} earlier'],
  rise: ['sees Earth {t} sooner', 'sees Earth {t} later'],
  upNow: 'Earth in view now (hidden before)',
  downNow: 'Earth hidden now (in view before)',
  noSet: 'keeps Earth for the next 60 days',
  noRise: 'no Earth now in the next 60 days',
  setSoon: 'loses Earth now within 60 days (kept it before)',
  riseSoon: 'sees Earth now within 60 days (not before)',
};

/**
 * The next rise or set now against the one before the step (issue #126: the step is taken at once). The events are compared as moments in
 * time, so a ±1 day nudge, which sees the same sunset from a day nearer or further, reports no
 * change here; the countdown lines show the day.
 */
function flipLine(upL: boolean, upG: boolean, fL: Flip, fG: Flip, w: Words): Line | null {
  if (upL !== upG) return { text: upG ? w.upNow : w.downNow, tone: upG ? 'ok' : 'bad' };
  if (!fL && !fG) return null;
  if (upL) {
    // Waiting for a set: later is better; no set within 60 days is best.
    if (!fG) return { text: w.noSet, tone: 'ok' };
    if (!fL) return { text: w.setSoon, tone: 'bad' };
    const dh = (fG.tMs - fL.tMs) / HOUR_MS;
    if (Math.abs(dh) < MEANINGFUL_H) return null;
    return { text: w.set[dh > 0 ? 0 : 1].replace('{t}', amountText(dh)), tone: dh > 0 ? 'ok' : 'bad' };
  }
  // Waiting for a rise: sooner is better; none within 60 days is worst.
  if (!fG) return { text: w.noRise, tone: 'bad' };
  if (!fL) return { text: w.riseSoon, tone: 'ok' };
  const dh = (fG.tMs - fL.tMs) / HOUR_MS;
  if (Math.abs(dh) < MEANINGFUL_H) return null;
  return { text: w.rise[dh < 0 ? 0 : 1].replace('{t}', amountText(dh)), tone: dh < 0 ? 'ok' : 'bad' };
}

/** Shown in place of the comparison when the two points' skylines come from different terrain models. */
export const ACROSS_EDGE =
  'This step crosses the edge of a height map, where the terrain model changes: one point uses a '
  + 'polar height map (240 m or 1.2 km cells), the other the 3.8 km whole-Moon map or a smooth Moon. '
  + 'The difference between them is the model changing, not the ground.';

/**
 * The difference in plain words, the most important first. `note` names the terrain when it
 * isn't the detailed polar map (T37, ui/terrain.ts terrainNote): coarse, or a smooth Moon and why.
 */
export function compare(live: Facts, ghost: Facts, note = ''): Line[] {
  // Across the edge of a terrain model (80 S, 80 N, or 85 S while globe.bin is not in) the two
  // skylines aren't the same kind of thing: a step of 1 km north from 85.01 S read as "+11.5 days
  // of sunlight" when the far side was a smooth Moon, and a 240 m skyline against a 3.8 km one is
  // no fairer. No gain or loss is claimed.
  if (live.grid !== ghost.grid) return [{ text: ACROSS_EDGE, tone: 'muted' }];
  const lines: Line[] = [];
  const add = (l: Line | null): void => {
    if (l) lines.push(l);
  };
  add(pctLine(live.litPct, ghost.litPct, 'sunlight'));
  add(flipLine(live.sunUp, ghost.sunUp, live.sunFlip, ghost.sunFlip, SUN));
  add(pctLine(live.earthPct, ghost.earthPct, 'Earth contact'));
  add(flipLine(live.earthUp, ghost.earthUp, live.earthFlip, ghost.earthFlip, EARTH));
  if (lines.length === 0) {
    lines.push({ text: `No meaningful change (under ${MEANINGFUL_H} h)`, tone: 'muted' });
  }
  if (note) lines.push({ text: `${note}.`, tone: 'muted' });
  return lines;
}
