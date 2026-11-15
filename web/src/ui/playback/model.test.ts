import { describe, expect, it } from 'vitest';
import {
  advance, batteryLine, changedElsewhere, commsLine, earthLine, MAX_GAP_MS, powerLine, SPEEDS, stepAction,
  stepEveryMs, sunLine,
} from './model';

const HOUR = 3_600_000;

describe('playback model', () => {
  it('offers the four speeds P5 asked for', () => {
    expect(SPEEDS.map((s) => s.text)).toEqual(['2 h/s', '6 h/s', '12 h/s', '1 day/s']);
  });

  it('moves the time by speed × wall-clock time', () => {
    expect(advance(0, 6, 1000)).toBe(6 * HOUR);
    expect(advance(0, 24, 100)).toBeCloseTo(2.4 * HOUR, 6);
    expect(advance(0, 2, 500)).toBe(HOUR);
  });

  it('never leaps after a long gap (a tab in the background), and never goes back', () => {
    expect(advance(0, 24, 60_000)).toBe(advance(0, 24, MAX_GAP_MS));
    expect(advance(5, 24, -100)).toBe(5);
  });

  it('steps once a second with reduced motion, glides otherwise', () => {
    expect(stepEveryMs(true)).toBe(1000);
    expect(stepEveryMs(false)).toBeLessThan(1000);
  });

  it('stops at the end of the table and waits while a decade loads', () => {
    expect(stepAction(true, 'none', 'none')).toBe('move');
    expect(stepAction(true, 'none', 'outside')).toBe('stop');
    expect(stepAction(false, 'none', 'none')).toBe('wait');
    expect(stepAction(true, 'none', 'failed')).toBe('wait');
    expect(stepAction(true, 'failed', 'none')).toBe('wait');
  });

  it('pauses on a drag, a typed time, a nudge, a new site or another scenario selected', () => {
    const at = { tMs: 1000, lat: -89, lon: 0, selectedLive: true };
    expect(changedElsewhere(at, { ...at })).toBe(false);
    expect(changedElsewhere(at, { ...at, tMs: 2000 })).toBe(true);
    expect(changedElsewhere(at, { ...at, lat: -88.9 })).toBe(true);
    expect(changedElsewhere(at, { ...at, lon: 1 })).toBe(true);
    expect(changedElsewhere(at, { ...at, selectedLive: false })).toBe(true);
  });

  it('words the Sun by how much of its disc clears the skyline', () => {
    expect(sunLine({ sunFrac: 1, sunAbove: 2.04 })).toMatchObject({ text: 'In view', detail: '+2.0° above the skyline', tone: 'ok' });
    expect(sunLine({ sunFrac: 0.4, sunAbove: 0 })).toMatchObject({ text: 'Partly in view, 40 % of the disc', tone: 'warn' });
    expect(sunLine({ sunFrac: 0.001, sunAbove: -0.2 }).text).toBe('Partly in view, 1 % of the disc');
    expect(sunLine({ sunFrac: 0, sunAbove: -3 })).toMatchObject({ text: 'Hidden behind the skyline', detail: '−3.0° above the skyline', tone: 'bad' });
  });

  it('says the radio link is blocked whenever Earth is behind the skyline', () => {
    expect(earthLine({ earthUp: true, earthAbove: 4 }).text).toBe('In view');
    expect(commsLine({ earthUp: true })).toMatchObject({ text: 'Open', tone: 'ok' });
    expect(commsLine({ earthUp: false })).toMatchObject({ text: 'Blocked', tone: 'bad' });
  });

  it('words the power balance and the charge', () => {
    expect(powerLine(400, 300)).toMatchObject({ text: 'Charging +300 W', detail: 'panel makes 400 W', tone: 'ok' });
    expect(powerLine(0, -100)).toMatchObject({ text: 'Draining −100 W', tone: 'bad' });
    expect(powerLine(100, 0)).toMatchObject({ text: 'Balanced' });
    expect(batteryLine(1, 300)).toMatchObject({ text: '100 %', detail: 'Full' });
    expect(batteryLine(0.5234, -100)).toMatchObject({ text: '52.3 %', detail: 'Draining' });
    expect(batteryLine(0.1, 50)).toMatchObject({ detail: 'Low, charging', tone: 'warn' });
    expect(batteryLine(0, -100)).toMatchObject({ text: '0 %', detail: 'Empty: the load is not met', tone: 'bad' });
  });
});
