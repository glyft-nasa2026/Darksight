import { describe, expect, it } from 'vitest';
import {
  batteryRun, chargeAfter, EXAMPLE_BATTERY, hoursOnBattery, netWatts, panelWatts, validBattery, type Battery,
} from './battery';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 15);
// Sun on the horizontal and fully clear: an upright panel makes full power. Below: none.
const lit = (i: number) => ({ tMs: T0 + i * HOUR, sun: { alt: 0, az: 0 }, sunFrac: 1 });
const dark = (i: number) => ({ tMs: T0 + i * HOUR, sun: { alt: -5, az: 0 }, sunFrac: 0 });
const B: Battery = { capacityWh: 1000, panelW: 300, useW: 100 };

describe('battery', () => {
  it('the panel makes its rated power with the Sun full on its face, none in the dark', () => {
    expect(panelWatts(lit(0), B)).toBeCloseTo(300, 9);
    expect(panelWatts(dark(0), B)).toBe(0);
    expect(netWatts(lit(0), B)).toBeCloseTo(200, 9);
    expect(netWatts(dark(0), B)).toBe(-100);
  });

  it('a polar Sun 1 degree up gives an upright panel almost full power', () => {
    expect(panelWatts({ sun: { alt: 1, az: 0 }, sunFrac: 1 }, B)).toBeCloseTo(300 * Math.cos(Math.PI / 180), 9);
  });

  it('a full battery runs the load capacity ÷ use hours; with no load, for ever', () => {
    expect(hoursOnBattery(B)).toBe(10);
    expect(hoursOnBattery({ ...B, useW: 0 })).toBe(Infinity);
  });

  it('checks the inputs', () => {
    expect(validBattery(EXAMPLE_BATTERY)).toBe(true);
    expect(validBattery({ ...B, capacityWh: 0 })).toBe(false);
    expect(validBattery({ ...B, useW: -1 })).toBe(false);
    expect(validBattery({ ...B, panelW: Number.NaN })).toBe(false);
  });

  it('drains in the dark, charges in the light, and stays between empty and full', () => {
    const night = [0, 1, 2, 3].map(dark);
    expect(chargeAfter(1000, night, T0, T0 + 4 * HOUR, B)).toBeCloseTo(600, 9);
    // Half an hour of a dark hour: 50 Wh.
    expect(chargeAfter(1000, night, T0, T0 + HOUR / 2, B)).toBeCloseTo(950, 9);
    // Starting part-way through: only the time asked for counts.
    expect(chargeAfter(1000, night, T0 + 2.5 * HOUR, T0 + 3 * HOUR, B)).toBeCloseTo(950, 9);
    expect(chargeAfter(50, night, T0, T0 + 4 * HOUR, B)).toBe(0);
    const day = [0, 1, 2].map(lit);
    expect(chargeAfter(900, day, T0, T0 + 3 * HOUR, B)).toBe(1000);
    // Empty in the dark, then charging again from empty once the Sun is up.
    const mixed = [dark(0), dark(1), lit(2)];
    expect(chargeAfter(100, mixed, T0, T0 + 3 * HOUR, B)).toBeCloseTo(200, 9);
    // Backwards or no time: unchanged.
    expect(chargeAfter(500, night, T0 + HOUR, T0, B)).toBe(500);
  });

  it('runs hour by hour and counts the times it ran flat', () => {
    // 12 dark hours from full: empty after 10, flat for 2; then light, then 15 dark: flat again.
    const samples = [
      ...Array.from({ length: 12 }, (_, i) => dark(i)),
      ...Array.from({ length: 5 }, (_, i) => lit(12 + i)),
      ...Array.from({ length: 15 }, (_, i) => dark(17 + i)),
    ];
    const run = batteryRun(samples, B);
    expect(run.frac[0]).toBe(1);
    expect(run.frac[10]).toBeCloseTo(0, 9);
    expect(run.lowestFrac).toBe(0);
    expect(run.flatSpells).toBe(2);
    // First dark stretch: 2 h flat. Light: +1000 Wh (full). Second: 15 h, empty after 10, flat 5.
    expect(run.flatHours).toBeCloseTo(7, 9);
    expect(run.longestFlatHours).toBeCloseTo(5, 9);
    expect(run.endFrac).toBe(0);
  });

  it('never runs flat in steady sunlight', () => {
    const run = batteryRun(Array.from({ length: 48 }, (_, i) => lit(i)), B, 0.5);
    expect(run.flatSpells).toBe(0);
    expect(run.lowestFrac).toBe(0.5);
    expect(run.endFrac).toBe(1);
  });
});
