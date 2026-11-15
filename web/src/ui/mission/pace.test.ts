import { describe, expect, it } from 'vitest';
import { EXAMPLE_LANDER, planMission, type OkPlan } from '../../core/mission';
import { padById } from '../../core/pads';
import { AUTO_SPEED, BURN_SPEED, heldText, MANOEUVRE_SPEED, nextPace, paceLimit, RAMP, rateText, regions } from './pace';

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
    for (const mode of ['auto', 60, 3600, 21600] as const) {
      const seen = play(mode);
      const paceAt = (tMs: number) => seen.find((x) => x.t >= tMs)!.pace;
      expect(paceAt(at('powered-descent').startMs), `${mode}`).toBeLessThanOrEqual(BURN_SPEED * 1.05);
      // The ascent and the powered descent take at least their length at the burn speed.
      for (const id of ['launch', 'powered-descent']) {
        const frames = seen.filter((x) => x.t >= at(id).startMs && x.t < at(id).endMs).length;
        expect(frames / FPS, `${mode} ${id}`).toBeGreaterThan(((at(id).endMs - at(id).startMs) / 1000 / BURN_SPEED) * 0.95);
      }
    }
    // Auto also slows for the instant burns, so the change shows.
    const seen = play('auto');
    const paceAt = (tMs: number) => seen.find((x) => x.t >= tMs)!.pace;
    expect(paceAt(at('loi').startMs)).toBeLessThanOrEqual(MANOEUVRE_SPEED * 1.05);
    expect(paceAt(at('doi').startMs)).toBeLessThanOrEqual(MANOEUVRE_SPEED * 1.05);
  });

  // Issue #196: Auto's slow windows round TLI, LOI and DOI held 1 h/s and 6 h/s at Auto's speed
  // for most of the mission. A speed button now plays through them at its own speed.
  it('plays TLI, LOI and DOI at a speed button\'s own speed', () => {
    const seen = play(3600);
    const paceAt = (tMs: number) => seen.find((x) => x.t >= tMs)!.pace;
    for (const id of ['tli', 'loi', 'doi']) expect(paceAt(at(id).startMs), id).toBeCloseTo(3600, 0);
    expect(regions(plan, 3600).some((r) => r.pace === MANOEUVRE_SPEED)).toBe(false);
  });

  it('reaches a speed button\'s speed in the long stages, where Auto plays another', () => {
    const top = (mode: 'auto' | number, id: string) =>
      Math.max(...play(mode).filter((x) => x.t >= at(id).startMs && x.t < at(id).endMs).map((x) => x.pace));
    for (const id of ['parking', 'coast', 'lunar-orbit', 'descent-orbit']) expect(top(3600, id), `1 h/s ${id}`).toBeGreaterThan(3600 * 0.99);
    for (const id of ['coast', 'lunar-orbit']) expect(top(21600, id), `6 h/s ${id}`).toBeGreaterThan(21600 * 0.99);
    // In lunar orbit Auto plays 1 h/s: 6 h/s is six times faster there, not held to Auto's speed.
    expect(top('auto', 'lunar-orbit')).toBeCloseTo(AUTO_SPEED['lunar-orbit'], 0);
    // Over the whole mission, 6 h/s now plays in well under half of Auto's time.
    expect(play(21600).length).toBeLessThan(play('auto').length / 2);
  });

  it('says why a speed button is held back, and nothing in Auto or at the speed chosen', () => {
    const fast = regions(plan, 21600);
    const s = 1000;
    expect(heldText(regions(plan, 'auto'), 'auto', 30, at('launch').startMs + 60 * s)).toBe('');
    expect(heldText(fast, 21600, 21600, (at('coast').startMs + at('coast').endMs) / 2)).toBe('');
    expect(heldText(fast, 21600, 30, at('launch').startMs + 60 * s)).toBe('now 30 s/s during the ascent');
    const ramp = BURN_SPEED + RAMP * 600;   // 10 simulated minutes from a burn
    expect(heldText(fast, 21600, ramp, at('powered-descent').startMs - 600 * s))
      .toBe(`now ${rateText(ramp)}, slowing for the powered descent`);
    expect(heldText(fast, 21600, ramp, at('launch').endMs + 600 * s))
      .toBe(`now ${rateText(ramp)}, speeding up after the ascent`);
    // Gliding to a new button, in the coast where nothing holds it back.
    const mid = (at('coast').startMs + at('coast').endMs) / 2;
    expect(heldText(fast, 21600, 3600, mid)).toBe('now 1 h/s, speeding up');
    expect(heldText(regions(plan, 60), 60, 3600, mid)).toBe('now 1 h/s, slowing down');
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
