// Battery (T40, extending F15): how a battery charged by an upright panel turned to face the Sun
// holds up against a steady power use. Pure functions on the hourly samples state.ts already
// computes (the same Sun samples as the strips and the panel percentages); no ephemeris here.
//
// Model: the panel makes panelW × panelPower(sample).upright watts (full sunlight on its face
// gives panelW), the load always draws useW, and the charge moves by (panel − use) × time, kept
// between empty and full. Each hourly sample holds for the hour after it. No losses, no ageing,
// no heating: a planning picture, not a power-system design.

import { panelPower } from './panel';
import type { Sample } from './types';

const HOUR_MS = 3_600_000;

/** The battery and its load. Watt-hours and watts. */
export type Battery = { capacityWh: number; panelW: number; useW: number };

/** Example values: a small lander or rover. Edit them to match a real one. */
export const EXAMPLE_BATTERY: Battery = { capacityWh: 2000, panelW: 400, useW: 100 };

/** The input limits the page accepts. */
export const BATTERY_LIMITS = {
  capacityWh: { min: 1, max: 1_000_000 },
  panelW: { min: 0, max: 1_000_000 },
  useW: { min: 0, max: 1_000_000 },
} as const;

/** A battery the model can run: finite numbers inside the limits. */
export function validBattery(b: Battery): boolean {
  return (Object.keys(BATTERY_LIMITS) as (keyof Battery)[]).every((k) =>
    Number.isFinite(b[k]) && b[k] >= BATTERY_LIMITS[k].min && b[k] <= BATTERY_LIMITS[k].max);
}

type SunSample = Pick<Sample, 'tMs' | 'sun' | 'sunFrac'>;

/** What the panel makes at one sample, watts. */
export function panelWatts(sample: Pick<Sample, 'sun' | 'sunFrac'>, b: Battery): number {
  return panelPower(sample).upright * b.panelW;
}

/** Panel output minus use at one sample, watts: positive while it charges. */
export function netWatts(sample: Pick<Sample, 'sun' | 'sunFrac'>, b: Battery): number {
  return panelWatts(sample, b) - b.useW;
}

/** How long a full battery runs the load with no sunlight, hours. Infinity with no load. */
export function hoursOnBattery(b: Battery): number {
  return b.useW > 0 ? b.capacityWh / b.useW : Infinity;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The charge after running from fromMs to toMs, starting at chargeWh. samples are hourly and in
 * order; each holds from its time until the next one (the last for an hour). Time before the first
 * sample uses the first. Charging and draining are applied in order, so a battery that runs flat
 * in the dark and then sees the Sun charges again from empty.
 */
export function chargeAfter(chargeWh: number, samples: readonly SunSample[], fromMs: number, toMs: number, b: Battery): number {
  let charge = clamp(chargeWh, 0, b.capacityWh);
  if (!(toMs > fromMs) || samples.length === 0) return charge;
  for (let i = 0; i < samples.length; i++) {
    const start = i === 0 ? Math.min(samples[0].tMs, fromMs) : samples[i].tMs;
    const end = i + 1 < samples.length ? samples[i + 1].tMs : samples[i].tMs + HOUR_MS;
    const a = Math.max(start, fromMs);
    const z = Math.min(end, toMs);
    if (z > a) charge = clamp(charge + (netWatts(samples[i], b) * (z - a)) / HOUR_MS, 0, b.capacityWh);
    if (end >= toMs) break;
  }
  return charge;
}

/** The charge hour by hour over the samples, and what it means for the mission. */
export type BatteryRun = {
  /** Charge at each sample's time, 0..1 of full. */
  frac: number[];
  lowestFrac: number;
  endFrac: number;
  /** Hours with the battery empty (the load not met). */
  flatHours: number;
  /** Separate times it ran flat. */
  flatSpells: number;
  /** The longest of them, hours. */
  longestFlatHours: number;
};

/** Runs the battery over hourly samples, starting at startFrac of full (1 by default). */
export function batteryRun(samples: readonly SunSample[], b: Battery, startFrac = 1): BatteryRun {
  let charge = clamp(startFrac, 0, 1) * b.capacityWh;
  const frac: number[] = [];
  let lowest = charge / b.capacityWh;
  let flatHours = 0;
  let flatSpells = 0;
  let longest = 0;
  let run = 0;
  for (let i = 0; i < samples.length; i++) {
    frac.push(charge / b.capacityWh);
    const hours = i + 1 < samples.length ? (samples[i + 1].tMs - samples[i].tMs) / HOUR_MS : 1;
    const net = netWatts(samples[i], b);
    // Hours of this step spent empty: all of it if it starts empty and can't charge, else from
    // the moment it runs out.
    let emptyH = 0;
    if (net < 0) {
      const lasts = charge / -net;
      if (lasts < hours) emptyH = hours - lasts;
    }
    charge = clamp(charge + net * hours, 0, b.capacityWh);
    lowest = Math.min(lowest, charge / b.capacityWh);
    if (emptyH > 0) {
      if (run === 0) flatSpells++;
      run += emptyH;
      flatHours += emptyH;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return {
    frac, lowestFrac: lowest, endFrac: charge / b.capacityWh,
    flatHours, flatSpells, longestFlatHours: longest,
  };
}
