// T14 map layers: settings, fading, colouring and the legend's words. Pure functions, no DOM:
// model.test.ts runs them in node. index.ts holds the one store the page uses and draws with these.
// The layer keys, values and sources come from core/layers.ts (T43); this file only words them.
import { LAYER_KEYS, type LayerKey, type LayerSource } from '../../core/layers';
import { SLOPE_RAMP_MAX_DEG } from '../../core/slope';
import { distanceText } from '../distance';

export { LAYER_KEYS, type LayerKey } from '../../core/layers';

export const LAYER_LABELS: Record<LayerKey, string> = {
  sun: 'Sunlight (share of time lit)',
  earth: 'Earth in view (share of time)',
  psr: 'Never lit (permanent shadow)',
  height: 'Height',
  slope: `Slope (level to ${SLOPE_RAMP_MAX_DEG}° and steeper)`,
};

/** Theme variables (never colour codes) for the low and high end of each layer's colours. */
export const LAYER_COLORS: Record<LayerKey, readonly [string, string]> = {
  sun: ['--dark', '--sun'],
  earth: ['--dark', '--earth'],
  psr: ['--bg', '--accent'],
  height: ['--terrain-lo', '--terrain-hi'],
  // T41: brighter is steeper, so it reads without telling red from green.
  slope: ['--dark', '--bad'],
};

/** 'ramp': every cell drawn, low to high colour. 'alpha': the high colour, as opaque as the value. */
export const LAYER_MODE: Record<LayerKey, 'ramp' | 'alpha'> = {
  sun: 'ramp', earth: 'ramp', psr: 'alpha', height: 'ramp', slope: 'ramp',
};

export const DEFAULT_OPACITY = 0.6;
export const FADE_MS = 300;

export type LayerSetting = { on: boolean; opacity: number };
export type LayerSettings = Record<LayerKey, LayerSetting>;

export type LayerStore = {
  get(): LayerSettings;
  toggle(key: LayerKey): void;
  setOn(key: LayerKey, on: boolean): void;
  /** 0..1, clamped. */
  setOpacity(key: LayerKey, opacity: number): void;
  subscribe(fn: (s: LayerSettings) => void): () => void;
};

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function createLayerStore(): LayerStore {
  let settings = Object.fromEntries(
    LAYER_KEYS.map((k) => [k, { on: false, opacity: DEFAULT_OPACITY }]),
  ) as LayerSettings;
  const listeners = new Set<(s: LayerSettings) => void>();
  const update = (key: LayerKey, change: Partial<LayerSetting>): void => {
    settings = { ...settings, [key]: { ...settings[key], ...change } };
    for (const fn of listeners) fn(settings);
  };
  return {
    get: () => settings,
    toggle: (key) => update(key, { on: !settings[key].on }),
    setOn: (key, on) => update(key, { on }),
    setOpacity: (key, opacity) => update(key, { opacity: clamp01(opacity) }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** How opaque a layer should end up: its opacity when on, 0 when off. */
export function targetAlpha(s: LayerSetting): number {
  return s.on ? clamp01(s.opacity) : 0;
}

/**
 * One animation step from the current opacity towards the target: a full fade (0 to 1) takes
 * durationMs. With reduced motion asked for, the layer jumps straight to the target.
 */
export function fadeTowards(
  current: number, target: number, dtMs: number, durationMs = FADE_MS, reducedMotion = false,
): number {
  if (reducedMotion || durationMs <= 0) return target;
  const step = Math.max(0, dtMs) / durationMs;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

/** '#rgb', '#rrggbb' or 'rgb(r, g, b)' / 'rgba(...)' as [r, g, b]; null for anything else. */
export function parseColor(css: string): [number, number, number] | null {
  const s = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.round(Math.min(255, v))) as [number, number, number];
  return null;
}

/**
 * RGBA pixels for values in 0..1 (NaN = no data, drawn transparent). 'ramp' blends lo to hi and is
 * opaque; 'alpha' draws hi with alpha = value, so 0 is transparent. The layer's own opacity is
 * applied when it is drawn, so fading needs no new pixels.
 */
export function colorize(
  values: ArrayLike<number>, lo: readonly number[], hi: readonly number[], mode: 'ramp' | 'alpha',
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(values.length * 4));
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const t = Math.min(1, Math.max(0, v));
    const o = i * 4;
    if (mode === 'ramp') {
      out[o] = lo[0] + (hi[0] - lo[0]) * t;
      out[o + 1] = lo[1] + (hi[1] - lo[1]) * t;
      out[o + 2] = lo[2] + (hi[2] - lo[2]) * t;
      out[o + 3] = 255;
    } else {
      out[o] = hi[0];
      out[o + 1] = hi[1];
      out[o + 2] = hi[2];
      out[o + 3] = 255 * t;
    }
  }
  return out;
}

/** Heights in metres scaled to 0..1 between their lowest and highest finite value. */
export function normalise(values: ArrayLike<number>): Float32Array {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const out = new Float32Array(values.length);
  const span = hi > lo ? hi - lo : 1;
  for (let i = 0; i < values.length; i++) out[i] = Number.isFinite(values[i]) ? (values[i] - lo) / span : NaN;
  return out;
}

/** T41: slopes in degrees (NaN = none) as 0..1 along the Slope layer's ramp, steeper than its end as 1. */
export function slopeRamp(degrees: ArrayLike<number>, maxDeg = SLOPE_RAMP_MAX_DEG): Float32Array {
  const out = new Float32Array(degrees.length);
  for (let i = 0; i < degrees.length; i++) {
    const d = degrees[i];
    out[i] = Number.isFinite(d) ? Math.min(1, Math.max(0, d / maxDeg)) : NaN;
  }
  return out;
}

/** T43: the legend's short name of each layer. */
export const LAYER_SHORT: Record<LayerKey, string> = {
  sun: 'Sunlight', earth: 'Earth in view', psr: 'Never lit', height: 'Height', slope: 'Slope',
};

/** T43: a layer's value at a point as the legend writes it: "43 % of the time", "−1,234 m", "7°". */
export function valueText(key: LayerKey, v: number): string {
  switch (key) {
    case 'sun': case 'earth': return `${Math.round(v * 100)} % of the time`;
    case 'psr': return `${Math.round(v * 100)} % of the ground`;
    case 'height': return `${Math.round(v).toLocaleString('en-GB').replace('-', '−')} m`;
    case 'slope': return v < 0.5 ? 'under 1°' : `${Math.round(v)}°`;
  }
}

/**
 * T43: the source of a layer's value at a point, in words (contract section 2, "Which source
 * applies where"): "LOLA, 480 m cells, with terrain", "Smooth Moon, no terrain shadows".
 */
export function sourceText(key: LayerKey, src: LayerSource): string {
  const cell = src.cellM === null ? '' : distanceText(src.cellM);
  const over = key === 'slope' ? `slope over ${cell}` : `${cell} cells`;
  switch (src.id) {
    case 'lola-south': return `LOLA, ${cell} cells, with terrain (south polar map)`;
    case 'lola-north': return `LOLA, ${cell} cells, with terrain (north polar map)`;
    case 'smooth': return key === 'psr' ? 'Smooth Moon: no terrain, so no permanent shadow' : `Smooth Moon, no terrain shadows (${cell} cells)`;
    case 'dem-south': return `LOLA south-pole height map, ${over}`;
    case 'dem-north': return `LOLA north-pole height map, ${over}`;
    case 'globe': return `LOLA whole-Moon height map, ${over}`;
  }
}
