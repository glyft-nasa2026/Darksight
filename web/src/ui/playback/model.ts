// Timeline playback (T40): the parts that can be tested without a page. How far the live time
// moves for the wall-clock time that passed, when playing has to stop or wait, and the words for
// the Sun, Earth, the radio link and the battery. Every number comes from core/ through state.ts
// (the samples) and core/battery.ts; this file only moves time and words the results.

import type { Sample } from '../../core/types';

const HOUR_MS = 3_600_000;

/** Simulated hours per real second (P5's choice for T40). */
export const SPEEDS: readonly { id: string; text: string; label: string; hoursPerS: number }[] = [
  { id: '2h', text: '2 h/s', label: '2 hours a second', hoursPerS: 2 },
  { id: '6h', text: '6 h/s', label: '6 hours a second', hoursPerS: 6 },
  { id: '12h', text: '12 h/s', label: '12 hours a second', hoursPerS: 12 },
  { id: '1d', text: '1 day/s', label: '1 day a second', hoursPerS: 24 },
];
export const START_SPEED = '6h';

/**
 * The live time moves this often, ms of wall clock. Each move redraws the strips, charts and map,
 * so not every animation frame. With reduced motion on it moves once a second instead of gliding.
 */
export const stepEveryMs = (reducedMotion: boolean): number => (reducedMotion ? 1000 : 100);

/**
 * A browser tab in the background gets no frames; when it comes back the wall clock has run on.
 * Longer gaps than this count as this, so the time doesn't leap ahead by days.
 */
export const MAX_GAP_MS = 1000;

/** The time after realMs of wall clock at hoursPerS. */
export function advance(tMs: number, hoursPerS: number, realMs: number): number {
  const ms = Math.min(Math.max(0, realMs), MAX_GAP_MS);
  return tMs + (hoursPerS * HOUR_MS * ms) / 1000;
}

export type Gap = 'none' | 'outside' | 'failed';

/**
 * What one step does. 'wait': the hours aren't in yet (a decade is downloading, or failed and is
 * being tried again): stay put, carry on when they arrive. 'stop': the next time is past the end
 * of the table. 'move': go there.
 */
export function stepAction(hoursReady: boolean, nowGap: Gap, nextGap: Gap): 'move' | 'wait' | 'stop' {
  if (nextGap === 'outside') return 'stop';
  if (!hoursReady || nowGap === 'failed' || nextGap === 'failed') return 'wait';
  return 'move';
}

/** What the playback watches to notice a change it didn't make (a drag, a typed time, a nudge, a new site). */
export type Watched = { tMs: number; lat: number; lon: number; selectedLive: boolean };

/** True when something other than the playback moved the live scenario: playing pauses. */
export function changedElsewhere(expected: Watched, now: Watched): boolean {
  return now.tMs !== expected.tMs || now.lat !== expected.lat || now.lon !== expected.lon || !now.selectedLive;
}

export type Tone = 'ok' | 'bad' | 'warn' | 'muted';
export type Line = { text: string; detail: string; tone: Tone };

const deg = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}°`;

/** The Sun at one sample: in view, partly, or hidden, with its height above the skyline. */
export function sunLine(s: Pick<Sample, 'sunFrac' | 'sunAbove'>): Line {
  const pct = Math.round(Math.min(1, Math.max(0, s.sunFrac)) * 100);
  const detail = `${deg(s.sunAbove)} above the skyline`;
  if (s.sunFrac >= 1) return { text: 'In view', detail, tone: 'ok' };
  if (s.sunFrac > 0) return { text: `Partly in view, ${Math.max(1, Math.min(99, pct))} % of the disc`, detail, tone: 'warn' };
  return { text: 'Hidden behind the skyline', detail, tone: 'bad' };
}

/** Earth at one sample. */
export function earthLine(s: Pick<Sample, 'earthUp' | 'earthAbove'>): Line {
  const detail = `${deg(s.earthAbove)} above the skyline`;
  return s.earthUp
    ? { text: 'In view', detail, tone: 'ok' }
    : { text: 'Hidden behind the skyline', detail, tone: 'bad' };
}

/** Direct-to-Earth radio: open while Earth clears the skyline, blocked otherwise. */
export function commsLine(s: Pick<Sample, 'earthUp'>): Line {
  return s.earthUp
    ? { text: 'Open', detail: 'Earth is above the skyline: a direct link works', tone: 'ok' }
    : { text: 'Blocked', detail: 'Earth is below the skyline: no direct link, a relay is needed', tone: 'bad' };
}

const watts = (w: number): string => `${Math.round(Math.abs(w)).toLocaleString('en-GB')} W`;

/** The panel and the load: charging, draining or balanced, with the panel's output. */
export function powerLine(panelW: number, net: number): Line {
  const detail = `panel makes ${watts(panelW)}`;
  if (net > 0.5) return { text: `Charging +${watts(net)}`, detail, tone: 'ok' };
  if (net < -0.5) return { text: `Draining −${watts(net)}`, detail, tone: panelW > 0 ? 'warn' : 'bad' };
  return { text: 'Balanced', detail, tone: 'muted' };
}

/** The battery's charge, 0..1, as a line. */
export function batteryLine(frac: number, net: number): Line {
  const pct = Math.min(100, Math.max(0, frac * 100));
  const text = `${pct >= 99.95 ? 100 : pct < 0.05 ? 0 : pct.toFixed(1)} %`;
  if (pct < 0.05 && net < 0) return { text, detail: 'Empty: the load is not met', tone: 'bad' };
  if (pct >= 99.95) return { text, detail: 'Full', tone: 'ok' };
  if (pct < 20) return { text, detail: net > 0 ? 'Low, charging' : 'Low', tone: 'warn' };
  return { text, detail: net > 0 ? 'Charging' : net < 0 ? 'Draining' : 'Holding', tone: 'muted' };
}
