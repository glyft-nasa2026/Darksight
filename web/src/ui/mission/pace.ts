// Playback speed of the mission animations, the card's and the simulation page's (issue #105): simulated seconds per real second.
// Speeds change gradually, never in a jump: each stage has a speed, and near a slower stage the
// speed is held to `slow + RAMP * distance` (distance in simulated seconds). That is the speed
// that, easing at RAMP per real second, arrives at the slow stage exactly as it starts, so
// slowing down begins before a burn and nothing is skipped. Leaving it speeds up the same way.
// In every mode the ascent and the powered descent play at most at BURN_SPEED. Only Auto also
// slows down around the instant burns (TLI, LOI, DOI) and for the arrival: a speed button plays
// through them at its own speed (issue #196: with those slow windows, 1 h/s and 6 h/s spent most
// of the mission at Auto's speed).
import type { OkPlan, StepId } from '../../core/mission';
import { approachSeconds } from '../../core/mission';

/** Rate of change of the speed: e-fold per 1 / RAMP real seconds (30 s/s to 1 h/s in about 4 s). */
export const RAMP = 1.2;

export type Mode = 'auto' | number;
/** A stretch of the mission and the speed it asks for; `id` names it in the "held" note. */
type Region = { from: number; to: number; pace: number; id: StepId | 'approach' };

/** Auto's speed per step (the issue's table). */
export const AUTO_SPEED: Record<StepId, number> = {
  launch: 3600, parking: 3600,
  tli: 6 * 3600, coast: 6 * 3600,
  loi: 3600, 'lunar-orbit': 3600,
  doi: 1800, 'descent-orbit': 1800, 'powered-descent': 1800, touchdown: 1800,
};

/** The burns that last minutes play at most at this speed in every mode. */
export const BURN_SPEED = 30;
/** Around an instant burn (TLI, LOI, DOI) Auto slows to this, so the change shows. */
export const MANOEUVRE_SPEED = 60;
export const MANOEUVRE_WINDOW_S = 15 * 60;
/** Auto plays the arrival at the Moon (inside its sphere of influence) at this. */
export const APPROACH_SPEED = 3600;

/**
 * The stages and the speed each asks for, in simulated milliseconds. A manual speed (a number)
 * asks for itself everywhere except the ascent and the powered descent; Auto also adds the slow
 * windows round the instant burns and the arrival.
 */
export function regions(plan: OkPlan, mode: Mode): Region[] {
  const out: Region[] = [];
  for (const s of plan.steps) {
    const base = mode === 'auto' ? AUTO_SPEED[s.id] : mode;
    if (s.endMs > s.startMs) {
      const burn = s.id === 'launch' || s.id === 'powered-descent';
      out.push({ from: s.startMs, to: s.endMs, pace: burn ? Math.min(base, BURN_SPEED) : base, id: s.id });
    } else if (mode === 'auto' && (s.id === 'tli' || s.id === 'loi' || s.id === 'doi')) {
      const w = MANOEUVRE_WINDOW_S * 1000;
      out.push({ from: s.startMs - w, to: s.startMs + w, pace: Math.min(base, MANOEUVRE_SPEED), id: s.id });
    }
  }
  if (mode === 'auto') {
    const loi = plan.steps.find((s) => s.id === 'loi')!.startMs;
    out.push({ from: loi - approachSeconds(plan) * 1000, to: loi, pace: APPROACH_SPEED, id: 'approach' });
  }
  return out;
}

/** The speed the playback may have at simulated time tMs, and the stage that sets it (null if none). */
function limitAt(rs: Region[], tMs: number): { pace: number; by: Region | null } {
  let pace = Infinity;
  let by: Region | null = null;
  for (const r of rs) {
    const d = tMs < r.from ? r.from - tMs : tMs > r.to ? tMs - r.to : 0;
    const p = r.pace + RAMP * (d / 1000);
    if (p < pace) { pace = p; by = r; }
  }
  return Number.isFinite(pace) ? { pace, by } : { pace: 3600, by: null };
}

/** The speed the playback may have at simulated time tMs: the slowest stage's limit there. */
export function paceLimit(rs: Region[], tMs: number): number {
  return limitAt(rs, tMs).pace;
}

/** How the "held" note names each stage that can hold a manual speed back. */
const HELD_BY: Partial<Record<Region['id'], string>> = {
  launch: 'the ascent', 'powered-descent': 'the powered descent',
  tli: 'TLI', loi: 'LOI', doi: 'DOI', approach: 'the arrival',
};

/**
 * With a manual speed, what is playing and why, while that isn't the speed chosen (issue #196):
 * "now 30 s/s during the ascent", "now 4 min/s, slowing for the powered descent", "now 12 min/s,
 * speeding up after the ascent", "now 2 h/s, speeding up" or "slowing down" while it glides to a
 * new button. Empty in Auto (its button says its speed) and at the speed chosen.
 */
export function heldText(rs: Region[], mode: Mode, pace: number, tMs: number): string {
  if (mode === 'auto' || Math.abs(Math.log(pace / mode)) <= 0.01) return '';
  const now = `now ${rateText(pace)}`;
  if (pace > mode) return `${now}, slowing down`;
  const { pace: limit, by } = limitAt(rs, tMs);
  const name = by ? HELD_BY[by.id] : undefined;
  if (limit >= mode * 0.99 || !by || !name) return `${now}, speeding up`;
  if (tMs < by.from) return `${now}, slowing for ${name}`;
  if (tMs > by.to) return `${now}, speeding up after ${name}`;
  return `${now} during ${name}`;
}

/**
 * One step of the playback: the speed eases toward the limit at RAMP per real second (both ways,
 * so a new speed button glides too), and never above the limit, so it is slow in time for burns.
 */
export function nextPace(current: number, limit: number, dtS: number): number {
  const max = Math.exp(RAMP * dtS);
  const eased = Math.min(Math.max(limit, current / max), current * max);
  return Math.min(eased, limit);
}

/** "30 s/s", "12 min/s", "1.5 h/s". */
export function rateText(s: number): string {
  if (s < 59.5) return `${Math.round(s)} s/s`;
  if (s < 3570) return `${Math.round(s / 60)} min/s`;
  const h = s / 3600;
  return `${h < 9.95 ? Number(h.toFixed(1)) : Math.round(h)} h/s`;
}
