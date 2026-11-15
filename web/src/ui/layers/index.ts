// Map layers (T14, spec F14) over the whole Moon (T43, SPEC section 6): Sun visibility, Earth
// visibility, permanent shadow, height and slope, each with on/off and transparency, fading in and
// out, on the south polar, north polar and whole-Moon maps.
//
// Every value and its source comes from core/layers.ts (layerAt, layerValueAt): this file fetches
// the files, colours what core gives, and words it. Files: web/public/data/layers/ (the LOLA polar
// maps, data-prep/make_layers.py; the smooth-Moon Sun and Earth, make_layers_global.py); the
// height map in state (dem.bin), and north.bin and globe.bin through the scene's shared downloads.
//
// Wiring (contract section 5): the scene mounts the controls in its `.scene-layers` section; the
// 2D map's draw step calls drawLayers(ctx, { kind, view, reachDeg, unitPx }) after its terrain,
// and redraws whenever onLayersChange() fires (data arriving, opacity, every frame of a fade).
import './layers.css';
import {
  gridLatLon, heightRange, LAYER_NAMES, layerAt, layerValueAt, parseLayer, parseSmooth, readLayersMeta,
  readSmoothMeta, seamLats, SMOOTH_NAMES, type LayerInputs, type LayersMeta, type PolarGrid, type SmoothMeta,
} from '../../core/layers';
import { polarForward, polarInverse, viewToScreen, type MapView, type Pole } from '../../core/projection';
import { SLOPE_RAMP_MAX_DEG } from '../../core/slope';
import { MOON_RADIUS_KM } from '../../core/types';
import { sharedGlobe, sharedNorth } from '../../scene/globeHeights';
import { getState, selected, subscribe } from '../../state';
import { themeColor } from '../plotTheme';
import {
  colorize, createLayerStore, fadeTowards, LAYER_COLORS, LAYER_KEYS, LAYER_LABELS, LAYER_MODE, LAYER_SHORT,
  parseColor, sourceText, targetAlpha, valueText, type LayerKey, type LayerSettings,
} from './model';

/** The one store the controls and the map share. */
export const layerStore = createLayerStore();

/** Which map view a picture is for: the 2D map's three (web/src/map/). */
export type MapKind = Pole | 'global';
export type DrawOptions = {
  kind: MapKind;
  view: MapView;
  /** How far from its pole a polar view reaches, degrees (its fading ring ends there). */
  reachDeg: number;
  /** The width of --space-1 in canvas pixels, for the seam's line. */
  unitPx: number;
};

const base = (): string => import.meta.env.BASE_URL + 'data/';
const HALF_WORLD_KM = Math.PI * MOON_RADIUS_KM;
/** The whole-Moon picture of Sun, Earth and never lit: 0.25 degrees a pixel (the smooth source is 0.5). */
const GLOBAL_W = 1440, GLOBAL_H = 720;
/** Pixels per side of a polar view's ring picture, beyond the polar grid (about 2 km a pixel). */
const RING_PX = 640;

/** Everything loaded so far; core/layers.ts reads it. */
const inputs: LayerInputs = { polar: { south: {}, north: {} }, smooth: {} };
let metaPromise: Promise<LayersMeta> | null = null;
let smoothPromise: Promise<SmoothMeta> | null = null;
/** Layers whose files have all arrived or failed: their pictures can be built. */
const ready = new Set<LayerKey>();
const loading = new Map<LayerKey, Promise<void>>();
/** What did not load, per layer, for the status line. */
const missing = new Map<LayerKey, string[]>();
const alpha = new Map<LayerKey, number>(LAYER_KEYS.map((k) => [k, 0]));
const changeListeners = new Set<() => void>();

/** One layer's picture for one map view. Polar views: the polar grid's cells, and a ring beyond them. */
type Picture = { cap?: HTMLCanvasElement; capGrid?: PolarGrid; ring?: HTMLCanvasElement; ringHalf?: number; global?: HTMLCanvasElement };
const pictures = new Map<string, Picture>();
/**
 * Pictures being built. A picture asks core for a value at up to 4 million pixels, which took
 * about a second at once; it is built a slice of rows at a time between frames instead, so the
 * page never freezes, and the map redraws when it is done.
 */
const building = new Map<string, Generator<void, Picture>>();
const pictureKey = (key: LayerKey, kind: MapKind, reach = 0): string => `${key}|${kind}|${reach}`;
function dropPictures(keys: readonly LayerKey[]): void {
  const mine = (k: string): boolean => keys.some((key) => k.startsWith(`${key}|`));
  for (const k of [...pictures.keys()]) if (mine(k)) pictures.delete(k);
  // A picture half built from the old data is started again.
  for (const k of [...building.keys()]) if (mine(k)) building.delete(k);
}

function emitChange(): void {
  for (const fn of changeListeners) fn();
}

/** Called on every change the map must redraw for: data arriving, opacity, each fade frame. */
export function onLayersChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

async function fetchJson(rel: string): Promise<unknown> {
  const r = await fetch(base() + rel);
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  // A dev server answers a missing file with the page itself, which is not JSON.
  return r.json().catch(() => { throw new Error(`${rel}: missing, or not JSON`); });
}

async function fetchBytes(rel: string): Promise<ArrayBuffer> {
  const r = await fetch(base() + rel);
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

function loadMeta(): Promise<LayersMeta> {
  metaPromise ??= fetchJson('layers/layers.json').then((json) => (inputs.layers = readLayersMeta(json)));
  return metaPromise;
}

function loadSmoothMeta(): Promise<SmoothMeta> {
  smoothPromise ??= fetchJson('layers/smooth.json').then(readSmoothMeta);
  return smoothPromise;
}

/** Height and slope come from the height maps, not from files of their own. */
const fromHeights = (key: LayerKey): key is 'height' | 'slope' => key === 'height' || key === 'slope';

/** The files one layer needs, each a job that puts its piece into `inputs`. */
function jobsFor(key: LayerKey, meta: LayersMeta): [string, Promise<unknown>][] {
  if (fromHeights(key)) {
    return [
      ['north.bin', inputs.north ? Promise.resolve() : sharedNorth().then((d) => { inputs.north = d; })],
      ['globe.bin', inputs.globe ? Promise.resolve() : sharedGlobe().then((g) => { inputs.globe = g; })],
    ];
  }
  const name = key as (typeof LAYER_NAMES)[number];
  const jobs: [string, Promise<unknown>][] = (['south', 'north'] as const).map((pole) => {
    const file = meta.polar[pole].files[name];
    return [file, inputs.polar![pole]![name] ? Promise.resolve()
      : fetchBytes(file).then((b) => { inputs.polar![pole]![name] = parseLayer(meta, pole, name, b); })];
  });
  if ((SMOOTH_NAMES as readonly string[]).includes(key)) {
    const s = key as (typeof SMOOTH_NAMES)[number];
    jobs.push(['layers/smooth.json', inputs.smooth![s] ? Promise.resolve() : loadSmoothMeta()
      .then((m) => fetchBytes(m.files[s]).then((b) => { inputs.smooth![s] = parseSmooth(m, s, b); }))]);
  }
  return jobs;
}

/**
 * Fetches (once) every file a layer needs. It is ready when all have arrived or failed, and at
 * least one arrived: core/layers.ts then gives a value wherever a file reaches, and the legend says
 * "no data here" elsewhere.
 */
function ensureLayer(key: LayerKey): Promise<void> {
  if (ready.has(key)) return Promise.resolve();
  let p = loading.get(key);
  if (p) return p;
  p = loadMeta().then(async (meta) => {
    if (fromHeights(key)) inputs.dem = getState().dem;
    const jobs = jobsFor(key, meta);
    const done = await Promise.allSettled(jobs.map(([, job]) => job));
    const failed = jobs.filter((_, i) => done[i].status === 'rejected').map(([file]) => file);
    if (failed.length === jobs.length && !fromHeights(key)) {
      throw (done[0] as PromiseRejectedResult).reason;
    }
    missing.set(key, failed);
    ready.add(key);
    dropPictures([key]);
    emitChange();
  }).finally(() => loading.delete(key));
  loading.set(key, p);
  return p;
}

// --- Pictures ----------------------------------------------------------------------------------

function rgb(name: string): [number, number, number] {
  const c = parseColor(themeColor(name));
  if (!c) throw new Error(`theme colour ${name} could not be read`);
  return c;
}

/** core's value as 0..1 along the layer's colour ramp (NaN stays NaN: drawn transparent). */
function ramp(key: LayerKey): (v: number) => number {
  if (key === 'height') {
    const [lo, hi] = heightRange(inputs);
    const span = hi > lo ? hi - lo : 1;
    return (v) => (v - lo) / span;
  }
  if (key === 'slope') return (v) => Math.min(1, v / SLOPE_RAMP_MAX_DEG);
  return (v) => v;
}

function paint(key: LayerKey, values: Float32Array, w: number, h: number, fade?: Uint8Array): HTMLCanvasElement {
  const [lo, hi] = LAYER_COLORS[key].map(rgb);
  const px = colorize(values, lo, hi, LAYER_MODE[key]);
  if (fade) for (let i = 0; i < fade.length; i++) px[i * 4 + 3] = (px[i * 4 + 3] * fade[i]) / 255;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
  return canvas;
}

/** The whole Moon, a pixel a cell of a latitude-longitude grid: globe.bin's for height and slope. Yields after each row. */
function* buildGlobal(key: LayerKey): Generator<void, Picture> {
  const g = fromHeights(key) ? inputs.globe : null;
  const w = g ? g.meta.width : GLOBAL_W, h = g ? g.meta.height : GLOBAL_H;
  const values = new Float32Array(w * h);
  const toRamp = ramp(key);
  for (let j = 0; j < h; j++) {
    const lat = 90 - ((j + 0.5) * 180) / h;
    for (let i = 0; i < w; i++) {
      values[j * w + i] = toRamp(layerValueAt(key, lat, -180 + ((i + 0.5) * 360) / w, inputs));
    }
    yield;
  }
  return { global: paint(key, values, w, h) };
}

/**
 * A polar view: the polar grid's own cells (layers.json, 480 m; in the grid's layout, which for the
 * north is the map upside down), and a ring of RING_PX pixels a side out to reachDeg, fading out
 * as the map's own ring does from the grid's edge.
 */
function* buildPolar(key: LayerKey, pole: Pole, reachDeg: number): Generator<void, Picture> {
  const grid = inputs.layers!.polar[pole];
  const toRamp = ramp(key);
  const n = grid.size;
  const capDeg = 90 - Math.abs(grid.min_lat);
  const cap = new Float32Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const { lat, lon } = gridLatLon(grid, row, col);
      // The square's corners lie beyond the polar grid's circle: the fading ring draws them.
      cap[row * n + col] = 90 - Math.abs(lat) > capDeg ? Number.NaN : toRamp(layerValueAt(key, lat, lon, inputs));
    }
    yield;
  }
  const ringHalf = polarForward(-90 + reachDeg, 0).y;
  const ring = new Float32Array(RING_PX * RING_PX).fill(Number.NaN);
  const fade = new Uint8Array(RING_PX * RING_PX);
  for (let row = 0; row < RING_PX; row++) {
    const y = ringHalf - ((row + 0.5) * 2 * ringHalf) / RING_PX;
    for (let col = 0; col < RING_PX; col++) {
      const x = -ringHalf + ((col + 0.5) * 2 * ringHalf) / RING_PX;
      const { lat, lon } = polarInverse(x, y, pole);
      const fromPole = 90 - Math.abs(lat);
      // Inside the polar grid's circle the cap picture is drawn over it.
      if (fromPole > reachDeg || fromPole < capDeg - 0.5) continue;
      const k = row * RING_PX + col;
      ring[k] = toRamp(layerValueAt(key, lat, lon, inputs));
      fade[k] = Math.round(255 * Math.min(1, (reachDeg - fromPole) / Math.max(1e-9, reachDeg - capDeg)));
    }
    yield;
  }
  return { cap: paint(key, cap, n, n), capGrid: grid, ring: paint(key, ring, RING_PX, RING_PX, fade), ringHalf };
}

const SLICE_MS = 12;
let slicing = 0;
function buildSlices(): void {
  slicing = 0;
  const until = performance.now() + SLICE_MS;
  for (const [id, job] of building) {
    for (;;) {
      const step = job.next();
      if (step.done) {
        building.delete(id);
        pictures.set(id, step.value);
        emitChange();
        break;
      }
      if (performance.now() > until) { slicing = window.setTimeout(buildSlices, 0); return; }
    }
  }
}

function pictureFor(key: LayerKey, kind: MapKind, reachDeg: number): Picture | null {
  if (!ready.has(key) || !inputs.layers) return null;
  const id = pictureKey(key, kind, kind === 'global' ? 0 : reachDeg);
  const pic = pictures.get(id);
  if (pic) return pic;
  if (!building.has(id)) {
    building.set(id, kind === 'global' ? buildGlobal(key) : buildPolar(key, kind, reachDeg));
    if (!slicing) slicing = window.setTimeout(buildSlices, 0);
  }
  return null;
}

/** A dashed line where a layer's polar sources give way to its whole-Moon one. */
function drawSeams(ctx: CanvasRenderingContext2D, o: DrawOptions, lats: number[], a: number): void {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = themeColor('--text');
  ctx.lineWidth = o.unitPx / 3;
  ctx.setLineDash([o.unitPx, o.unitPx]);
  const { view } = o;
  for (const lat of lats) {
    if (o.kind === 'global') {
      const py = viewToScreen(view, 0, (lat * Math.PI / 180) * MOON_RADIUS_KM).py;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(view.width, py); ctx.stroke();
    } else if ((lat < 0) === (o.kind === 'south')) {
      const centre = viewToScreen(view, 0, 0);
      const r = Math.abs(polarForward(o.kind === 'south' ? lat : -lat, 0).y) * view.scale;
      ctx.beginPath(); ctx.arc(centre.px, centre.py, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Draws every visible layer on the map view described by `o`, at its current (fading) opacity,
 * then the seams where its sources meet. A view's picture of a layer is built the first time it
 * is needed, from core/layers.ts at every pixel.
 */
export function drawLayers(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { view } = o;
  const seams = new Map<number, number>();
  for (const key of LAYER_KEYS) {
    const a = alpha.get(key) ?? 0;
    if (a <= 0) continue;
    const pic = pictureFor(key, o.kind, o.reachDeg);
    if (!pic) continue;
    ctx.save();
    ctx.globalAlpha = a;
    if (pic.global) {
      const tl = viewToScreen(view, -HALF_WORLD_KM, HALF_WORLD_KM / 2);
      const w = 2 * HALF_WORLD_KM * view.scale, h = HALF_WORLD_KM * view.scale;
      ctx.imageSmoothingEnabled = false;
      // The whole Moon repeats east and west, as the map's own picture does.
      for (let k = Math.floor(-tl.px / w) - 1; tl.px + k * w < view.width; k++) {
        if (tl.px + (k + 1) * w < 0) continue;
        ctx.drawImage(pic.global, tl.px + k * w, tl.py, w, h);
      }
    } else if (pic.cap && pic.capGrid && pic.ring && pic.ringHalf) {
      const half = pic.ringHalf, tl = viewToScreen(view, -half, half);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(pic.ring, tl.px, tl.py, 2 * half * view.scale, 2 * half * view.scale);
      const g = pic.capGrid, cell = g.pixel_m;
      // The north grid is the north map upside down (contract section 2): its first row lies along the bottom.
      const flip = o.kind === 'north' ? -1 : 1;
      const corner = viewToScreen(view, g.x_min_m - cell / 2, flip * (g.y_max_m + cell / 2));
      const sizePx = g.size * cell * view.scale;
      ctx.imageSmoothingEnabled = false;
      ctx.translate(corner.px, corner.py);
      ctx.scale(1, flip);
      ctx.drawImage(pic.cap, 0, 0, sizePx, sizePx);
    }
    ctx.restore();
    for (const lat of seamLats(key, inputs)) seams.set(lat, Math.max(seams.get(lat) ?? 0, a));
  }
  for (const [lat, a] of seams) drawSeams(ctx, o, [lat], a);
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
    const target = ready.has(key) ? targetAlpha(s[key]) : 0;
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

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Line drawings on a 24-unit square, in the button's text colour: one per layer. */
const ICONS: Record<LayerKey, string[]> = {
  // A sun: a disc and eight rays.
  sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1'],
  // Earth: a globe with its equator and a meridian.
  earth: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M3 12h18', 'M12 3c-3 3-3 15 0 18c3-3 3-15 0-18'],
  // Never lit: the sun, struck out.
  psr: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M12 2v3M12 19v3M2 12h3M19 12h3', 'M4 4l16 16'],
  // Height: two peaks.
  height: ['M2 20l7-12l4 6l3-4l6 10z'],
  // Slope: a ramp and its angle.
  slope: ['M3 20h18V6z', 'M9 20a6 6 0 0 0-1-3.5'],
};

function icon(key: LayerKey): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICONS[key]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const mounted = new WeakMap<HTMLElement, () => void>();

export function mount(el: HTMLElement): void {
  mounted.get(el)?.();
  const box = make('fieldset', 'ly-box');
  box.append(make('legend', 'ly-title', 'Map layers'));
  const status = make('p', 'ly-status muted');
  status.setAttribute('role', 'status');
  // The controls float over the map (in its top right corner): one icon switch per layer in a
  // row, and a fold button that shows the transparency sliders and the notes under them, as the
  // nudge panel does. Folded, only the row, the status and the legend show (layers.css).
  const head = make('div', 'ly-head');
  const fold = make('button', 'btn ly-fold');
  fold.type = 'button';
  head.append(fold);
  box.append(head);
  const setFolded = (f: boolean): void => {
    box.toggleAttribute('data-folded', f);
    fold.textContent = f ? '▼' : '▲';
    fold.setAttribute('aria-expanded', String(!f));
    fold.setAttribute('aria-label', f ? 'Show layer transparency and notes' : 'Hide layer transparency and notes');
    fold.title = f ? 'Transparency and notes' : 'Hide';
  };
  fold.addEventListener('click', () => setFolded(!box.hasAttribute('data-folded')));
  setFolded(true);
  const rows = new Map<LayerKey, { check: HTMLButtonElement; range: HTMLInputElement }>();

  for (const key of LAYER_KEYS) {
    const row = make('div', 'ly-row');
    const id = `ly-${key}`;
    const check = make('button', 'btn ly-icon');
    check.type = 'button';
    check.id = id;
    check.dataset.layer = key;
    check.setAttribute('aria-label', LAYER_LABELS[key]);
    check.title = LAYER_LABELS[key];
    check.append(icon(key));
    head.insertBefore(check, fold);
    const label = make('label', 'ly-label', LAYER_LABELS[key]);
    label.htmlFor = `${id}-opacity`;
    const range = make('input', 'ly-opacity');
    range.id = `${id}-opacity`;
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.setAttribute('aria-label', `${LAYER_LABELS[key]}: transparency`);
    check.addEventListener('click', () => layerStore.toggle(key));
    // 'input' while dragging; 'change' too, for anything that sets the value without dragging.
    const setOpacity = (): void => layerStore.setOpacity(key, Number(range.value) / 100);
    range.addEventListener('input', setOpacity);
    range.addEventListener('change', setOpacity);
    row.append(label, range);
    box.append(row);
    rows.set(key, { check, range });
  }

  // T43: the value and source of each layer that is on, at the selected site.
  const legend = make('dl', 'ly-legend');
  legend.setAttribute('aria-live', 'polite');
  const note = make('p', 'ly-note muted');
  note.textContent = 'Sunlight, Earth and never lit: within 10° of each pole, averages over 18.6 years ' +
    'from the LOLA team (Mazarico et al. 2011), over the real terrain, on 480 m cells; elsewhere a ' +
    'smooth Moon over 18.6 years of the same Sun and Earth (JPL DE440), with no terrain shadows. ' +
    'A dashed line marks where they meet. Any part of the Sun’s or Earth’s disc counts as visible, ' +
    'at the surface. The readout uses its own calculation, so its numbers can differ.';
  const heightNote = make('p', 'ly-note muted', 'Height and slope come from the LOLA height maps: ' +
    '240 m cells near the south pole, 1.2 km near the north pole, 3.8 km elsewhere. Slope is measured ' +
    'over those cells, so a boulder or a small crater does not show.');
  box.append(status, legend, note, heightNote);
  el.replaceChildren(box);

  const render = (s: LayerSettings): void => {
    for (const [key, { check, range }] of rows) {
      check.setAttribute('aria-pressed', String(s[key].on));
      range.value = String(Math.round(s[key].opacity * 100));
      range.disabled = !s[key].on;
    }
  };

  /** The legend: for each layer that is on, its value and source at the selected site, from core. */
  const describe = (): void => {
    const s = layerStore.get();
    const site = selected().site;
    const items: HTMLElement[] = [];
    for (const key of LAYER_KEYS) {
      if (!s[key].on) continue;
      const dd = make('dd', 'ly-at');
      if (!ready.has(key)) dd.textContent = 'Loading';
      else {
        const p = layerAt(key, site.lat, site.lon, inputs);
        dd.textContent = p ? `${valueText(key, p.value)} · ${sourceText(key, p.source)}`
          : `no data here (${(missing.get(key) ?? []).join(', ') || 'a file'} did not load)`;
      }
      items.push(make('dt', 'ly-at-name', LAYER_SHORT[key]), dd);
    }
    legend.replaceChildren(...items);
    legend.hidden = items.length === 0;
  };

  /** Starts loading every layer that is on and has no data yet. */
  const load = (): void => {
    const s = layerStore.get();
    for (const key of LAYER_KEYS) {
      if (!s[key].on || ready.has(key) || loading.has(key)) continue;
      // The height and slope layers need the height map, which may still be downloading.
      if (fromHeights(key) && !getState().dem) { status.textContent = 'Waiting for the height map'; continue; }
      status.textContent = 'Loading';
      ensureLayer(key)
        .then(() => {
          if (!loading.size) {
            const gaps = LAYER_KEYS.flatMap((k) => (s[k].on ? missing.get(k) ?? [] : []));
            status.textContent = gaps.length ? `Not loaded, so no layer there: ${[...new Set(gaps)].join(', ')}` : '';
          }
          describe();
          kick();
        })
        .catch((err: unknown) => {
          status.textContent = `${LAYER_LABELS[key]} could not be loaded: ${(err as Error).message ?? err}`;
          layerStore.setOn(key, false);
        });
    }
  };

  /** Shown in 2D mode only (the 3D view draws no layers). */
  const place = (): void => {
    const s = getState();
    el.hidden = s.mode !== '2d';
    // A new height map (real data replacing mock, say) gives new height and slope pictures.
    if (s.dem && inputs.dem !== s.dem && (ready.has('height') || ready.has('slope'))) {
      inputs.dem = s.dem;
      dropPictures(['height', 'slope']);
      emitChange();
    }
    describe();
  };

  const offStore = layerStore.subscribe((s) => { render(s); load(); describe(); kick(); });
  const offState = subscribe(() => { place(); load(); });
  mounted.set(el, () => { offStore(); offState(); mounted.delete(el); });
  render(layerStore.get());
  place();
}

/** For tests and the map: which layers have data ready. */
export function readyLayers(): LayerKey[] {
  return LAYER_KEYS.filter((k) => ready.has(k));
}
