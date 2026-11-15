// Map layers (T14, spec F14): Sun visibility, Earth visibility, permanent shadow and height over
// the south-polar map, each with on/off and transparency, fading in and out.
//
// Data: web/public/data/layers/ (data-prep/make_layers.py, from the LOLA team's illumination
// maps), read with core/layers.ts; the height layer comes from the height map already in state.
//
// Wiring (contract section 5): the scene mounts the controls in its `.scene-layers` section; the
// 2D map's draw step calls drawLayers(ctx, toScreen) after its terrain on the south-polar map,
// where toScreen maps polar stereographic metres (contract section 2) to canvas pixels, and
// redraws whenever onLayersChange() fires (data arriving, opacity, every frame of a fade).
import './layers.css';
import { gridLatLon, parseLayer, readLayersMeta, type LayersMeta } from '../../core/layers';
import { getState, selected, subscribe } from '../../state';
import { themeColor } from '../plotTheme';
import {
  colorize, createLayerStore, fadeTowards, LAYER_COLORS, LAYER_KEYS, LAYER_LABELS, LAYER_MODE,
  normalise, parseColor, targetAlpha, type LayerKey, type LayerSettings,
} from './model';

/** The one store the controls and the map share. */
export const layerStore = createLayerStore();

const base = (): string => import.meta.env.BASE_URL + 'data/';
let metaPromise: Promise<LayersMeta> | null = null;
const images = new Map<LayerKey, HTMLCanvasElement>();
const loading = new Map<LayerKey, Promise<void>>();
const alpha = new Map<LayerKey, number>(LAYER_KEYS.map((k) => [k, 0]));
const changeListeners = new Set<() => void>();
let gridMeta: LayersMeta | null = null;

function emitChange(): void {
  for (const fn of changeListeners) fn();
}

/** Called on every change the map must redraw for: data arriving, opacity, each fade frame. */
export function onLayersChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function loadMeta(): Promise<LayersMeta> {
  metaPromise ??= fetch(base() + 'layers/layers.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`layers.json: HTTP ${r.status}`))))
    .then((json: unknown) => readLayersMeta(json));
  return metaPromise;
}

function rgb(name: string): [number, number, number] {
  const c = parseColor(themeColor(name));
  if (!c) throw new Error(`theme colour ${name} could not be read`);
  return c;
}

function toCanvas(meta: LayersMeta, pixels: Uint8ClampedArray<ArrayBuffer>): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = meta.size;
  canvas.height = meta.size;
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, meta.size, meta.size), 0, 0);
  return canvas;
}

/** Fetches (once) and colours one layer into a canvas, one pixel per grid cell. */
function ensureLayer(key: LayerKey): Promise<void> {
  if (images.has(key)) return Promise.resolve();
  let p = loading.get(key);
  if (p) return p;
  p = loadMeta().then(async (meta) => {
    gridMeta = meta;
    const [lo, hi] = LAYER_COLORS[key].map(rgb);
    let values: ArrayLike<number>;
    if (key === 'height') {
      const dem = getState().dem;
      if (!dem) throw new Error('the height map is still loading');
      const heights = new Float32Array(meta.size * meta.size);
      for (let row = 0; row < meta.size; row++) {
        for (let col = 0; col < meta.size; col++) {
          const { lat, lon } = gridLatLon(meta, row, col);
          heights[row * meta.size + col] = dem.covers(lat, lon) ? dem.heightAt(lat, lon) : Number.NaN;
        }
      }
      values = normalise(heights);
    } else {
      const res = await fetch(base() + meta.layers[key].file);
      if (!res.ok) throw new Error(`${meta.layers[key].file}: HTTP ${res.status}`);
      const layer = parseLayer(meta, key, await res.arrayBuffer());
      const v = new Float32Array(layer.bytes.length);
      for (let i = 0; i < v.length; i++) v[i] = layer.bytes[i] * meta.value_scale;
      values = v;
    }
    images.set(key, toCanvas(meta, colorize(values, lo, hi, LAYER_MODE[key])));
    emitChange();
  }).finally(() => loading.delete(key));
  loading.set(key, p);
  return p;
}

/**
 * Draws every visible layer, at its current (fading) opacity. toScreen maps polar stereographic
 * metres to canvas pixels; the layers are drawn as one image each, scaled to the grid's extent.
 */
export function drawLayers(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => { px: number; py: number }): void {
  if (!gridMeta) return;
  const m = gridMeta;
  const half = m.pixel_m / 2;
  const tl = toScreen(m.x_min_m - half, m.y_max_m + half);
  const br = toScreen(m.x_min_m + (m.size - 1) * m.pixel_m + half, m.y_max_m - (m.size - 1) * m.pixel_m - half);
  for (const key of LAYER_KEYS) {
    const a = alpha.get(key) ?? 0;
    const img = images.get(key);
    if (!img || a <= 0) continue;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, tl.px, tl.py, br.px - tl.px, br.py - tl.py);
    ctx.restore();
  }
}

// --- Fading ------------------------------------------------------------------------------------

let frame = 0;
let last = 0;
const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function animate(now: number): void {
  const dt = last ? now - last : 16;
  last = now;
  const s = layerStore.get();
  let moving = false;
  for (const key of LAYER_KEYS) {
    const ready = images.has(key);
    const target = ready ? targetAlpha(s[key]) : 0;
    const next = fadeTowards(alpha.get(key) ?? 0, target, dt, undefined, reducedMotion());
    alpha.set(key, next);
    if (next !== target) moving = true;
  }
  emitChange();
  frame = moving ? requestAnimationFrame(animate) : 0;
  if (!moving) last = 0;
}

function kick(): void {
  if (!frame && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(animate);
}

// --- Controls ----------------------------------------------------------------------------------

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

const mounted = new WeakMap<HTMLElement, () => void>();

export function mount(el: HTMLElement): void {
  mounted.get(el)?.();
  const box = make('fieldset', 'ly-box');
  box.append(make('legend', 'ly-title', 'Map layers'));
  const status = make('p', 'ly-status muted');
  status.setAttribute('role', 'status');
  const rows = new Map<LayerKey, { check: HTMLInputElement; range: HTMLInputElement }>();

  for (const key of LAYER_KEYS) {
    const row = make('div', 'ly-row');
    const id = `ly-${key}`;
    const check = make('input');
    check.type = 'checkbox';
    check.id = id;
    const label = make('label', 'ly-label', LAYER_LABELS[key]);
    label.htmlFor = id;
    const range = make('input', 'ly-opacity');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.setAttribute('aria-label', `${LAYER_LABELS[key]}: transparency`);
    check.addEventListener('change', () => layerStore.setOn(key, check.checked));
    // 'input' while dragging; 'change' too, for anything that sets the value without dragging.
    const setOpacity = (): void => layerStore.setOpacity(key, Number(range.value) / 100);
    range.addEventListener('input', setOpacity);
    range.addEventListener('change', setOpacity);
    row.append(check, label, range);
    box.append(row);
    rows.set(key, { check, range });
  }

  const where = make('p', 'ly-where muted', 'Layers show on the south-polar map: pick a site south of 80° S.');
  const note = make('p', 'ly-note muted');
  note.textContent = 'Averages over 18.6 years from the LOLA team (Mazarico et al. 2011): any part of ' +
    'the Sun’s or Earth’s disc counts as visible, at the surface, on 480 m cells. The readout uses ' +
    'its own calculation, so its numbers can differ.';
  box.append(status, where, note);
  el.replaceChildren(box);

  const render = (s: LayerSettings): void => {
    for (const [key, { check, range }] of rows) {
      check.checked = s[key].on;
      range.value = String(Math.round(s[key].opacity * 100));
      range.disabled = !s[key].on;
    }
  };

  /** Starts loading every layer that is on and has no data yet. */
  const load = (): void => {
    const s = layerStore.get();
    for (const key of LAYER_KEYS) {
      if (!s[key].on || images.has(key) || loading.has(key)) continue;
      // The height layer is built from the height map, which may still be downloading.
      if (key === 'height' && !getState().dem) { status.textContent = 'Waiting for the height map'; continue; }
      status.textContent = 'Loading';
      ensureLayer(key)
        .then(() => { if (!loading.size) status.textContent = ''; kick(); })
        .catch((err: unknown) => {
          status.textContent = `${LAYER_LABELS[key]} could not be loaded: ${(err as Error).message ?? err}`;
          layerStore.setOn(key, false);
        });
    }
  };

  /** Shown in 2D mode only (the 3D view draws no layers); says so when the map is the whole Moon. */
  const place = (): void => {
    const s = getState();
    el.hidden = s.mode !== '2d';
    const site = selected().site;
    where.hidden = !!s.dem && s.dem.covers(site.lat, site.lon);
  };

  const offStore = layerStore.subscribe((s) => { render(s); load(); kick(); });
  const offState = subscribe(() => { place(); load(); });
  mounted.set(el, () => { offStore(); offState(); mounted.delete(el); });
  render(layerStore.get());
  place();
}

/** For tests and the map: which layers have data ready. */
export function readyLayers(): LayerKey[] {
  return LAYER_KEYS.filter((k) => images.has(k));
}
