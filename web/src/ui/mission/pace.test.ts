import { describe, expect, it } from 'vitest';
import { EXAMPLE_LANDER, planMission, type OkPlan } from '../../core/mission';
import { padById } from '../../core/pads';
import { AUTO_SPEED, BURN_SPEED, MANOEUVRE_SPEED, nextPace, paceLimit, RAMP, rateText, regions } from './pace';

const plan = planMission({
  site: { lat: -89.6866, lon: -162.81 }, touchdownMs: Date.parse('2026-11-21T16:04:00Z'),
  pad: padById('ksc-39a'), lander: EXAMPLE_LANDER, earthMoonKm: 380_000,
}) as OkPlan;
const at = (id: string) => plan.steps.find((s) => s.id === id)!;

/** Plays the whole mission at FPS frames a second; returns the speeds and times seen. */
const FPS = 20;
function play(mode: 'auto' | number) {
  const rs = regions(plan, mode);
  const dt = 1 / FPS;
  let t = plan.launchMs;
  let pace = paceLimit(rs, t);
  const seen: { t: number; pace: number }[] = [];
  while (t < plan.touchdownMs) {
    pace = nextPace(pace, paceLimit(rs, t), dt);
    seen.push({ t, pace });
    t += pace * dt * 1000;
  }
  return seen;
}

describe('playback speed', () => {
  it('follows Auto\'s table in the middle of long stages', () => {
    const rs = regions(plan, 'auto');
    const mid = (id: string) => (at(id).startMs + at(id).endMs) / 2;
    expect(paceLimit(rs, mid('parking'))).toBe(AUTO_SPEED.parking);
    expect(paceLimit(rs, (at('coast').startMs + at('coast').startMs + 30 * 3600e3) / 2)).toBe(AUTO_SPEED.coast);
    expect(paceLimit(rs, mid('lunar-orbit'))).toBe(AUTO_SPEED['lunar-orbit']);
    // The descent orbit is about an hour, between DOI and the powered descent: it ramps up and
    // down again without reaching its full 30 min/s.
    expect(paceLimit(rs, mid('descent-orbit'))).toBeLessThan(AUTO_SPEED['descent-orbit']);
    expect(paceLimit(rs, mid('descent-orbit'))).toBeGreaterThan(MANOEUVRE_SPEED);
    expect(paceLimit(rs, mid('powered-descent'))).toBe(BURN_SPEED);
  });

  it('never jumps: from one frame to the next the speed changes by at most the ramp', () => {
    for (const mode of ['auto', 60, 3600, 21600] as const) {
      const seen = play(mode);
      for (let i = 1; i < seen.length; i++) {
        const ratio = seen[i].pace / seen[i - 1].pace;
        expect(Math.abs(Math.log(ratio)), `${mode} at ${i}`).toBeLessThanOrEqual((RAMP / FPS) * 1.04);   // 1 − x vs e^−x: a few % in a frame
      }
    }
  });

  it('is already slow when a burn starts, so no burn is skipped', () => {
    for (const mode of ['auto', 21600] as const) {
      const seen = play(mode);
      const paceAt = (tMs: number) => seen.find((x) => x.t >= tMs)!.pace;
      expect(paceAt(at('powered-descent').startMs)).toBeLessThanOrEqual(BURN_SPEED * 1.05);
      expect(paceAt(at('loi').startMs)).toBeLessThanOrEqual(MANOEUVRE_SPEED * 1.05);
      expect(paceAt(at('doi').startMs)).toBeLessThanOrEqual(MANOEUVRE_SPEED * 1.05);
      // The powered descent takes at least its length at the burn speed, in real seconds.
      const frames = seen.filter((x) => x.t >= at('powered-descent').startMs && x.t < plan.touchdownMs).length;
      expect(frames / FPS).toBeGreaterThan(((plan.touchdownMs - at('powered-descent').startMs) / 1000 / BURN_SPEED) * 0.95);
    }
  });

  it('glides to a new speed button instead of jumping', () => {
    let pace = 60;
    const steps: number[] = [];
    for (let i = 0; i < 600; i++) { pace = nextPace(pace, 21600, 1 / 60); steps.push(pace); }
    expect(steps[0]).toBeLessThan(62);
    expect(steps[59]).toBeLessThan(60 * Math.exp(RAMP) * 1.01);
    expect(steps[599]).toBe(21600);
  });

  it('writes the speed in the largest whole unit', () => {
    expect(rateText(30)).toBe('30 s/s');
    expect(rateText(1800)).toBe('30 min/s');
    expect(rateText(3600)).toBe('1 h/s');
    expect(rateText(5400)).toBe('1.5 h/s');
    expect(rateText(21600)).toBe('6 h/s');
  });
});
