import { describe, expect, it } from 'vitest';
import {
  coordText, dayText, durationText, dvText, elapsedText, kgText, kmText, pctText, shortUtcText,
  speedText, utcText,
} from './format';

const T = Date.parse('2026-11-17T09:24:39Z');

describe('mission card text', () => {
  it('writes times in UTC', () => {
    expect(utcText(T)).toBe('2026-11-17 09:24');
    expect(shortUtcText(T)).toBe('11-17 09:24');
    expect(dayText(T)).toBe('17 Nov · 09:24 UTC');
  });

  it('writes lengths of time at a sensible precision', () => {
    expect(durationText(47.4)).toBe('47 s');
    expect(durationText(699.41)).toBe('11 min 39 s');
    expect(durationText(9156.79)).toBe('2 h 33 min');
    expect(durationText(262777.34)).toBe('3 d 1 h');
    expect(elapsedText(0)).toBe('T+ 00:00:00');
    expect(elapsedText(1 * 86400 + 18 * 3600 + 44 * 60 + 5.9)).toBe('T+ 1 d 18:44:05');
  });

  it('writes Δv and speed in km/s, or m/s when small', () => {
    expect(dvText(3.1547)).toBe('3.15 km/s');
    expect(dvText(0.912)).toBe('0.91 km/s');
    expect(dvText(0.0057)).toBe('6 m/s');
    expect(speedText(1.1149)).toBe('1.115 km/s');
    expect(speedText(0.938)).toBe('938 m/s');
    expect(speedText(0.00063)).toBe('0.6 m/s');
  });

  it('writes distances, masses and shares', () => {
    expect(kmText(272971.2)).toBe('272,971 km');
    expect(kmText(74.385)).toBe('74.4 km');
    expect(kmText(0.42)).toBe('420 m');
    expect(kgText(1908)).toBe('1,908 kg');
    expect(pctText(0.0696)).toBe('7 %');
  });

  it('writes coordinates with N, S, E and W, never a negative sign', () => {
    expect(coordText(-89.6866, -162.81)).toBe('89.6866° S · 162.8100° W');
    expect(coordText(28.60833, 80.60444)).toBe('28.6083° N · 80.6044° E');
  });
});
