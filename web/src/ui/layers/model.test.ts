// T14: layer settings, fading and colouring (no DOM).
import { describe, expect, it } from 'vitest';
import {
  colorize, createLayerStore, DEFAULT_OPACITY, fadeTowards, LAYER_COLORS, LAYER_KEYS, normalise,
  parseColor, targetAlpha,
} from './model';

describe('layer store', () => {
  it('starts with every layer off at the default opacity', () => {
    const s = createLayerStore().get();
    for (const k of LAYER_KEYS) expect(s[k]).toEqual({ on: false, opacity: DEFAULT_OPACITY });
  });

  it('toggles each layer on and off and tells subscribers', () => {
    const store = createLayerStore();
    const seen: boolean[] = [];
    const stop = store.subscribe((s) => seen.push(s.psr.on));
    store.toggle('psr');
    store.toggle('psr');
    stop();
    store.toggle('psr');
    expect(seen).toEqual([true, false]);
    expect(store.get().psr.on).toBe(true);
    expect(store.get().sun.on).toBe(false);
  });

  it('keeps opacity within 0..1', () => {
    const store = createLayerStore();
    store.setOpacity('sun', 1.7);
    expect(store.get().sun.opacity).toBe(1);
    store.setOpacity('sun', -1);
    expect(store.get().sun.opacity).toBe(0);
    store.setOpacity('sun', Number.NaN);
    expect(store.get().sun.opacity).toBe(0);
  });
});

describe('fading', () => {
  it('fades in when switched on and out when switched off', () => {
    expect(targetAlpha({ on: true, opacity: 0.6 })).toBe(0.6);
    expect(targetAlpha({ on: false, opacity: 0.6 })).toBe(0);
    let a = 0;
    const frames: number[] = [];
    while (a !== 0.6 && frames.length < 100) { a = fadeTowards(a, 0.6, 50, 300); frames.push(a); }
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.at(-1)).toBe(0.6);
    expect(frames.every((v, i) => i === 0 || v >= frames[i - 1])).toBe(true);
    expect(fadeTowards(0.6, 0, 50, 300)).toBeLessThan(0.6);
  });

  it('jumps straight to the target with reduced motion', () => {
    expect(fadeTowards(0, 0.6, 16, 300, true)).toBe(0.6);
    expect(fadeTowards(0.6, 0, 16, 300, true)).toBe(0);
  });
});

describe('colours', () => {
  it('reads the theme\'s colour formats', () => {
    expect(parseColor('#f0e442')).toEqual([240, 228, 66]);
    expect(parseColor('#abc')).toEqual([170, 187, 204]);
    expect(parseColor(' rgb(86, 180, 233) ')).toEqual([86, 180, 233]);
    expect(parseColor('rgba(1 2 3 / 0.5)')).toEqual([1, 2, 3]);
    expect(parseColor('')).toBeNull();
  });

  it('names theme variables only, never colour codes', () => {
    for (const [lo, hi] of Object.values(LAYER_COLORS)) {
      expect(lo).toMatch(/^--[a-z0-9-]+$/);
      expect(hi).toMatch(/^--[a-z0-9-]+$/);
    }
  });

  it('ramps from low to high, and draws "alpha" layers transparent at 0', () => {
    const ramp = colorize([0, 1, Number.NaN], [0, 0, 0], [200, 100, 50], 'ramp');
    expect([...ramp.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...ramp.slice(4, 8)]).toEqual([200, 100, 50, 255]);
    expect([...ramp.slice(8, 12)]).toEqual([0, 0, 0, 0]);
    const alpha = colorize([0, 0.5, 1], [0, 0, 0], [10, 20, 30], 'alpha');
    expect(alpha[3]).toBe(0);
    expect(alpha[7]).toBe(128);
    expect(alpha[11]).toBe(255);
  });

  it('scales heights to 0..1', () => {
    expect([...normalise([-2000, 0, 2000, Number.NaN])].slice(0, 3)).toEqual([0, 0.5, 1]);
  });
});
