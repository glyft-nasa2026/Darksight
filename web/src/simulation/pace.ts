// Playback speed of the launch simulation (issue #105): simulated seconds per real second.
// Speeds change gradually, never in a jump: each stage has a speed, and near a slower stage the
// speed is held to `slow + RAMP * distance` (distance in simulated seconds). That is the speed
// that, easing at RAMP per real second, arrives at the slow stage exactly as it starts, so
// slowing down begins before a burn and nothing is skipped. Leaving it speeds up the same way.
import type { OkPlan, StepId } from '../core/mission';
import { approachSeconds } from '../core/mission';

/** Rate of change of the speed: e-fold per 1 / RAMP real seconds (30 s/s to 1 h/s in about 4 s). */
export const RAMP = 1.2;

export type Mode = 'auto' | number;
type Region = { from: number; to: number; pace: number };

/** Auto's speed per step (the issue's table). */
export const AUTO_SPEED: Record<StepId, number> = {
  launch: 3600, parking: 3600,
  tli: 6 * 3600, coast: 6 * 3600,
  loi: 3600, 'lunar-orbit': 3600,
  doi: 1800, 'descent-orbit': 1800, 'powered-descent': 1800, touchdown: 1800,
};

/** The burns that last minutes play at most at this speed in every mode. */
export const BURN_SPEED = 30;
/** Around an instant burn (TLI, LOI, DOI) the playback slows to this, so the change shows. */
export const MANOEUVRE_SPEED = 60;
export const MANOEUVRE_WINDOW_S = 15 * 60;
/** Auto plays the arrival at the Moon (inside its sphere of influence) at this. */
export const APPROACH_SPEED = 3600;

/** The stages and the speed each asks for, in simulated milliseconds. */
export function regions(plan: OkPlan, mode: Mode): Region[] {
  const out: Region[] = [];
  for (const s of plan.steps) {
    const base = mode === 'auto' ? AUTO_SPEED[s.id] : mode;
    if (s.endMs > s.startMs) {
      const burn = s.id === 'launch' || s.id === 'powered-descent';
      out.push({ from: s.startMs, to: s.endMs, pace: burn ? Math.min(base, BURN_SPEED) : base });
    } else if (s.id === 'tli' || s.id === 'loi' || s.id === 'doi') {
      const w = MANOEUVRE_WINDOW_S * 1000;
      out.push({ from: s.startMs - w, to: s.startMs + w, pace: Math.min(base, MANOEUVRE_SPEED) });
    }
  }
  if (mode === 'auto') {
    const loi = plan.steps.find((s) => s.id === 'loi')!.startMs;
    out.push({ from: loi - approachSeconds(plan) * 1000, to: loi, pace: APPROACH_SPEED });
  }
  return out;
}

/** The speed the playback may have at simulated time tMs: the slowest stage's limit there. */
export function paceLimit(rs: Region[], tMs: number): number {
  let best = Infinity;
  for (const r of rs) {
    const d = tMs < r.from ? r.from - tMs : tMs > r.to ? tMs - r.to : 0;
    best = Math.min(best, r.pace + RAMP * (d / 1000));
  }
  return Number.isFinite(best) ? best : 3600;
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
