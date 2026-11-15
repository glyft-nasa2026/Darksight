// The flat 2D map (T31): a plain 2D canvas, no three.js. Two projections, as LROC QuickMap does:
// polar stereographic when the selected site is on a polar cap (the south height map, or the
// north cap's grid, issue #112), each cap in its own grid, and equidistant cylindrical for the
// whole Moon otherwise. Around a cap, 10 more degrees of the whole-Moon picture fade out, so the
// map shows there is more beyond it (issue #112). Every coordinate and every light value
// comes from core/ (projection.ts, shade.ts); this file only draws them and turns pointer
// positions into calls to core/. The whole-Moon picture is coloured by height and its relief
// lit from the whole-Moon height grid (globe.bin, issue #66): illustration, as on the 3D globe.

import type { Dem } from '../core/dem';
import type { Ephemeris, Vec3 } from '../core/ephemeris';
import {
  clampView, cylForward, cylInverse, fitScale, panView, polarForward, polarInverse, screenToView,
  viewToScreen, zoomView, type LatLon, type MapBounds, type MapView, type Pole,
} from '../core/projection';
import { shadeGlobal, shadePolar, subPoint, type PolarShade } from '../core/shade';
import { MOON_RADIUS_KM, type Site } from '../core/types';
import { sharedNorth } from '../scene/globe';
import { globeSlopes, sharedGlobe, type GlobeHeights } from '../scene/globeHeights';
import { getState, select, selected, setLiveSite, subscribe, type AppState } from '../state';
import { drawLayers, onLayersChange } from '../ui/layers';
import { themeColor } from '../ui/plotTheme';
import './map.css';

type Kind = Pole | 'global';
type Rgb = [number, number, number];
type Pin = { site: Site; color: string; scenarioId?: string; big: boolean };

const mounts = new WeakMap<HTMLElement, () => void>();
const demIds = new WeakMap<Dem, number>();
let nextDemId = 1;
/** A number per height map object, so a new grid (even with the same metadata) rebuilds the layers. */
function demId(d: Dem | null): number {
  if (!d) return 0;
  if (!demIds.has(d)) demIds.set(d, nextDemId++);
  return demIds.get(d)!;
}
const HALF_WORLD_KM = Math.PI * MOON_RADIUS_KM;   // 180 degrees of longitude, in map km
const GLOBAL_W = 1440, GLOBAL_H = 720;            // the whole-Moon layer without globe.bin: 0.25 degrees a cell
/** How strongly a slope toward or away from the Sun brightens or darkens the whole-Moon map. */
const RELIEF_LIGHT = 1.2;
/** Cosine of the Sun's zenith angle at which the whole-Moon map reaches full daylight (about 5 degrees up). */
const DAWN = 0.08;
/** A press that moves less than this many CSS pixels is a click, not a drag (as in the 3D scene). */
const CLICK_SLOP = 5;
const POLAR_STEPS = [5, 2, 1, 0.5, 0.25, 0.1];    // parallels, degrees apart
const MERIDIAN_STEPS = [90, 45, 30, 15, 10, 5, 2, 1];
const GLOBAL_STEPS = [30, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1];
/** How far a polar view reaches, degrees from its pole: the cap, then a ring of whole-Moon picture fading out. */
const POLAR_REACH = 20;
/** Pixels per side of the fading ring's layer (about 2 km a pixel; the whole-Moon grid is 3.8 km a cell). */
const RING_PX = 640;

/** A theme length in CSS pixels (theme.css may write it in rem). */
function themeLength(host: HTMLElement, name: string): number {
  const probe = document.createElement('div');
  probe.style.position = 'absolute'; probe.style.visibility = 'hidden'; probe.style.width = `var(${name})`;
  host.append(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px;
}

/** Any CSS colour the theme gives, as RGB bytes (the canvas does the parsing). */
function rgbOf(color: string): Rgb {
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function degLabel(value: number, pos: string, neg: string): string {
  const a = Math.abs(value);
  const text = Number.isInteger(a) ? String(a) : a.toFixed(a < 1 ? 2 : 1).replace(/0+$/, '');
  return a === 0 || a === 180 ? `${text}°` : `${text}°${value > 0 ? pos : neg}`;
}

/** Whether the table has a row for this time: outside it, the map is drawn without light, as the scene is. */
function tabled(eph: Ephemeris | null, tMs: number): eph is Ephemeris {
  return !!eph && tMs >= eph.startMs && tMs <= eph.endMs && eph.missing(tMs, tMs).length === 0;
}

export function unmount(el: HTMLElement): void { mounts.get(el)?.(); }

export function mount(el: HTMLElement): void {
  unmount(el);
  el.classList.add('map');
  el.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'map-canvas'; canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Flat map of the Moon. Click to select a site; arrow keys pan, plus and minus zoom.');
  el.append(canvas);
  const ctx = canvas.getContext('2d')!;

  let disposed = false, frame = 0;
  let kind: Kind = 'global', dem: Dem | null = null, siteKey = '', framed = false;
  // The north cap (north.bin, latitudes negated: see parseNorth), once fetched; null without the files.
  let north: Dem | null = null;
  /** The height map the polar view draws: the south height map or the north cap. */
  const cap = (): Dem | null => kind === 'south' ? dem : kind === 'north' ? north : null;
  const pole = (): Pole => kind === 'north' ? 'north' : 'south';
  let view: MapView = { cx: 0, cy: 0, scale: 1, width: 1, height: 1 };
  let minScale = 0, maxScale = Infinity;
  let pins: Pin[] = [];
  // Cached layers, rebuilt only when what they depend on changes.
  let base: HTMLCanvasElement | null = null, baseKey = '', baseDirty = true;
  // The fading ring around a polar cap, and for each of its pixels the whole-Moon cell it shows.
  let ring: HTMLCanvasElement | null = null, ringKey = '';
  let ringCells: { key: string; cell: Int32Array; alpha: Uint8Array } | null = null;
  let shade: PolarShade | null = null, shadeKey = '';
  let sunPoint: LatLon | null = null, earthPoint: LatLon | null = null;
  // The whole-Moon heights, once fetched; the map is plain grey outside the polar grid until then.
  let globe: GlobeHeights | null = null, slopes: Int8Array | null = null;
  let tones: Uint8Array | null = null, tonesKey = '';
  let theme = { key: '', lo: [0, 0, 0] as Rgb, hi: [0, 0, 0] as Rgb, pinPx: 4, fontPx: 12, font: '' };

  function readTheme(): void {
    const key = ['--terrain-lo', '--terrain-hi', '--bg', '--text', '--muted', '--border', '--sun', '--earth', '--font', '--fs-sm', '--space-1'].map(themeColor).join('|');
    if (key === theme.key) return;
    const fontPx = themeLength(el, '--fs-sm') || 12;
    theme = {
      key, lo: rgbOf(themeColor('--terrain-lo')), hi: rgbOf(themeColor('--terrain-hi')),
      pinPx: Math.max(2, themeLength(el, '--space-1')), fontPx,
      font: `${fontPx}px ${themeColor('--font') || 'sans-serif'}`,
    };
    baseKey = '';
  }

  /** Height colour times brightness, into an RGBA buffer. */
  function paint(data: Uint8ClampedArray, i: number, t: number, light: number): void {
    const { lo, hi } = theme;
    data[i] = (lo[0] + (hi[0] - lo[0]) * t) * light;
    data[i + 1] = (lo[1] + (hi[1] - lo[1]) * t) * light;
    data[i + 2] = (lo[2] + (hi[2] - lo[2]) * t) * light;
    data[i + 3] = 255;
  }
  /**
   * Brightness from core's light layer. Shadow keeps a little, so the ground's shape still shows
   * through the height colours. Flat ground under a low Sun reads as lit, slopes facing it brighter.
   */
  const brightness = (frac: number, cosI: number): number =>
    0.3 + 0.7 * frac * Math.min(1, Math.max(0, 0.4 + 2 * cosI));

  function buildPolarBase(s: AppState, lit: boolean): void {
    const sc = selected();
    const vectors = lit ? s.eph!.vectorsAt(sc.tMs) : null;
    const sun: Vec3 | null = vectors ? vectors.sun : null;
    const grid = cap()!;
    buildRing(vectors);
    const key = `polar|${theme.key}|${demId(grid)}|${demId(dem)}|${sun ? sun.join(',') : 'unlit'}`;
    if (base && baseKey === key && shade) return;
    const sunKey = `${demId(grid)}|${sun ? sun.join(',') : 'unlit'}`;
    if (!shade || shadeKey !== sunKey) {
      // With no Sun, any direction gives the heights; the light is then left out below. The north
      // cap is stored mirrored about the equator, so the Sun is mirrored too: the shadows match.
      const toSun: Vec3 = sun ? (kind === 'north' ? [sun[0], sun[1], -sun[2]] : sun) : [0, 0, -1];
      shade = shadePolar(grid, toSun);
      shadeKey = sunKey;
    }
    // The south cap uses its own colour ramp; the north cap the whole-Moon map's, so its colours
    // match the ring around it and the whole-Moon map.
    const { size, frac, cosI, height } = shade;
    const [lo, hi] = kind === 'north' ? rampRange() : shade.heightRange;
    const image = new ImageData(size, size);
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < size * size; i++) {
      if (Number.isNaN(height[i])) continue;   // outside coverage: transparent
      paint(image.data, i * 4, (height[i] - lo) / span, sun ? brightness(frac[i], cosI[i]) : 0.6);
    }
    base = base && base.width === size ? base : document.createElement('canvas');
    base.width = base.height = size;
    base.getContext('2d')!.putImageData(image, 0, 0);
    baseKey = key;
  }

  function buildGlobalBase(s: AppState, lit: boolean): void {
    const sc = selected();
    const vectors = lit ? s.eph!.vectorsAt(sc.tMs) : null;
    const key = `global|${theme.key}|${demId(dem)}|${globe ? 'heights' : 'plain'}|${vectors ? vectors.sun.join(',') : 'unlit'}`;
    sunPoint = vectors ? subPoint(vectors.sun) : null;
    earthPoint = vectors ? subPoint(vectors.earthKm) : null;
    if (base && baseKey === key) return;
    const image = globalPixels(vectors ? vectors.sun : null, 0, Infinity);
    const W = image.width, H = image.height;
    base = base && base.width === W ? base : document.createElement('canvas');
    base.width = W; base.height = H;
    base.getContext('2d')!.putImageData(image, 0, 0);
    baseKey = key;
  }
  /** The ramp's range: the same as the south polar map's, so a site keeps its colour when the map changes. */
  function rampRange(): [number, number] {
    return dem ? capRange(dem) : globe ? globe.range : [0, 1];
  }
  /**
   * The whole-Moon picture, one pixel a cell of the whole-Moon grid (or of a plain grid until it
   * arrives): rows `j0` to `j1 - 1` of it, so the image's row 0 is grid row `j0`.
   */
  function globalPixels(sun: Vec3 | null, j0: number, j1: number): ImageData {
    const W = globe ? globe.meta.width : GLOBAL_W, H = globe ? globe.meta.height : GLOBAL_H;
    const rows: [number, number] = [Math.max(0, j0), Math.min(H, j1)];
    const day = sun ? shadeGlobal(sun, W, H, rows[0], rows[1]) : null;
    const image = new ImageData(W, rows[1] - rows[0]);
    const range = rampRange();
    const span = Math.max(1, range[1] - range[0]);
    if (globe) paintHeights(image.data, globe, range, span, sun, day, rows);
    else {
      // No whole-Moon heights: the polar cap's own, where the height map covers it; grey elsewhere.
      for (let j = rows[0]; j < rows[1]; j++) {
        const lat = 90 - ((j + 0.5) * 180) / H;
        for (let i = 0; i < W; i++) {
          const lon = -180 + ((i + 0.5) * 360) / W;
          let t = 0.5;
          if (dem && lat <= dem.meta.min_lat && dem.covers(lat, lon)) {
            t = Math.min(1, Math.max(0, (dem.heightAt(lat, lon) - range[0]) / span));
          }
          const k = (j - rows[0]) * W + i;
          paint(image.data, k * 4, t, day ? (day[k] > 0 ? 0.6 + 0.4 * day[k] : 0.3) : 0.6);
        }
      }
    }
    return image;
  }

  /**
   * The ring around a polar cap: the whole-Moon picture in the cap's polar projection, out to
   * POLAR_REACH degrees from the pole. Opaque up to the cap's edge (80 degrees), then fading to
   * nothing over the next 10 degrees, so the map shows there is more beyond the cap (issue #112).
   */
  function buildRing(vectors: { sun: Vec3 } | null): void {
    const grid = cap()!, p = pole();
    const W = globe ? globe.meta.width : GLOBAL_W, H = globe ? globe.meta.height : GLOBAL_H;
    const key = `${theme.key}|${p}|${demId(dem)}|${demId(grid)}|${globe ? 'heights' : 'plain'}|${vectors ? vectors.sun.join(',') : 'unlit'}`;
    if (ring && ringKey === key) return;
    const half = ringHalf();
    // Which whole-Moon cell each ring pixel shows, and how opaque: worked out once per pole and grid.
    const cellsKey = `${p}|${W}x${H}|${grid.meta.min_lat}`;
    if (!ringCells || ringCells.key !== cellsKey) {
      const capDeg = 90 - Math.abs(grid.meta.min_lat), fade = POLAR_REACH - capDeg;
      const cell = new Int32Array(RING_PX * RING_PX).fill(-1), alpha = new Uint8Array(RING_PX * RING_PX);
      for (let row = 0; row < RING_PX; row++) {
        const y = half - ((row + 0.5) * 2 * half) / RING_PX;
        for (let col = 0; col < RING_PX; col++) {
          const x = -half + ((col + 0.5) * 2 * half) / RING_PX;
          const { lat, lon } = polarInverse(x, y, p);
          const fromPole = 90 - Math.abs(lat);
          if (fromPole > POLAR_REACH) continue;
          const k = row * RING_PX + col;
          const j = Math.min(H - 1, Math.floor(((90 - lat) * H) / 180));
          const i = Math.min(W - 1, Math.floor(((lon + 180) * W) / 360));
          cell[k] = j * W + i;
          alpha[k] = Math.round(255 * Math.min(1, (POLAR_REACH - fromPole) / Math.max(1e-9, fade)));
        }
      }
      ringCells = { key: cellsKey, cell, alpha };
    }
    // Only the rows near the pole are painted.
    const rows = Math.ceil((POLAR_REACH * H) / 180) + 1;
    const j0 = p === 'north' ? 0 : H - rows;
    const image = globalPixels(vectors ? vectors.sun : null, j0, p === 'north' ? rows : H);
    const out = new ImageData(RING_PX, RING_PX);
    const { cell, alpha } = ringCells;
    for (let k = 0; k < cell.length; k++) {
      const c = cell[k] - j0 * W;
      if (cell[k] < 0 || c < 0 || c * 4 >= image.data.length) continue;
      out.data[k * 4] = image.data[c * 4]; out.data[k * 4 + 1] = image.data[c * 4 + 1];
      out.data[k * 4 + 2] = image.data[c * 4 + 2]; out.data[k * 4 + 3] = alpha[k];
    }
    ring ??= document.createElement('canvas');
    ring.width = ring.height = RING_PX;
    ring.getContext('2d')!.putImageData(out, 0, 0);
    ringKey = key;
  }
  /** Half the side of a polar view's square, in map metres: POLAR_REACH degrees from the pole. */
  function ringHalf(): number {
    return polarForward(-90 + POLAR_REACH, 0).y;
  }
  /**
   * The whole Moon from its height grid: height colour, times core's day and night, with slopes
   * facing the Sun brighter and slopes facing away darker so craters and mountains show.
   */
  function paintHeights(data: Uint8ClampedArray, g: GlobeHeights, range: number[], span: number, sun: Vec3 | null, day: Float32Array | null, rows: [number, number]): void {
    const { width, height } = g.meta, count = width * height;
    slopes ??= globeSlopes(g);
    const key = `${range[0]},${range[1]}`;
    if (!tones || tonesKey !== key) {
      // Each cell's place on the colour ramp, 0..255: it changes only with the ramp's range.
      tones = new Uint8Array(count);
      for (let row = 0, k = 0; row < height; row++) {
        for (let col = 0; col < width; col++, k++) {
          tones[k] = Math.round(255 * Math.min(1, Math.max(0, (g.cell(row, col) - range[0]) / span)));
        }
      }
      tonesKey = key;
    }
    const { lo, hi } = theme;
    const ramp = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) ramp[i * 3 + c] = lo[c] + ((hi[c] - lo[c]) * i) / 255;
    const n = sun ? Math.hypot(sun[0], sun[1], sun[2]) || 1 : 1;
    // Slopes are stored as n * 127: fold that into the Sun's direction.
    const sx = sun ? sun[0] / n / 127 : 0, sy = sun ? sun[1] / n / 127 : 0, sz = sun ? sun[2] / n / 127 : 0;
    for (let k = rows[0] * width, d = 0; k < rows[1] * width; k++, d++) {
      let light = 0.6;
      if (day) {
        const up = day[d];
        if (up > 0) {
          const facing = slopes[k * 3] * sx + slopes[k * 3 + 1] * sy + slopes[k * 3 + 2] * sz;
          // Daylight comes in over the first few degrees of Sun, so the day's edge is not a hard step.
          light = Math.min(1, Math.max(0.3, 0.3 + Math.min(1, up / DAWN) * (0.3 + 0.4 * up + RELIEF_LIGHT * (facing - up))));
        } else light = 0.3;
      }
      const r = tones[k] * 3, o = d * 4;
      data[o] = ramp[r] * light; data[o + 1] = ramp[r + 1] * light; data[o + 2] = ramp[r + 2] * light; data[o + 3] = 255;
    }
  }
  const capRanges = new WeakMap<Dem, [number, number]>();
  function capRange(d: Dem): [number, number] {
    let r = capRanges.get(d);
    if (!r) { r = shadePolar(d, [0, 0, -1], 400).heightRange; capRanges.set(d, r); }
    return r;
  }

  /** Map point of a site in the current projection. Global: the copy of it nearest the view centre. */
  function project(site: Site): { x: number; y: number } {
    if (kind !== 'global') return polarForward(site.lat, site.lon, kind);
    const p = cylForward(site.lat, site.lon);
    const turns = Math.round((view.cx - p.x) / (2 * HALF_WORLD_KM));
    return { x: p.x + turns * 2 * HALF_WORLD_KM, y: p.y };
  }
  /** The site under a screen point, from core's inverse projections. */
  function unproject(px: number, py: number): LatLon | null {
    const p = screenToView(view, px, py);
    return kind !== 'global' ? polarInverse(p.x, p.y, kind) : cylInverse(p.x, p.y);
  }

  /**
   * How far the view zooms for the current canvas size: out until the whole map just fits (the
   * polar view's square, cap and fading ring, or the whole Moon), and no further (issue #65); in
   * to a few pixels a cell.
   */
  function setLimits(): void {
    const { width, height } = view;
    const grid = cap();
    if (grid) {
      const whole = 2 * ringHalf();
      minScale = fitScale(width, height, whole, whole);
      maxScale = 8 / grid.meta.pixel_m;
    } else {
      minScale = fitScale(width, height, 2 * HALF_WORLD_KM, HALF_WORLD_KM);
      maxScale = 4;   // 4 pixels per km: a click lands within a few hundred metres
    }
  }
  /**
   * What the map covers: the polar view's square (the cap and the fading ring around it,
   * centred on the pole), or the whole Moon from pole to pole, free east and west because it repeats.
   */
  function bounds(): MapBounds {
    if (cap()) {
      const half = ringHalf();
      return { xMin: -half, xMax: half, yMin: -half, yMax: half };
    }
    return { xMin: -Infinity, xMax: Infinity, yMin: -HALF_WORLD_KM / 2, yMax: HALF_WORLD_KM / 2 };
  }
  /** Every pan and zoom goes through here, so the map never slides out of the canvas (issue #65). */
  function setView(next: MapView): void {
    view = clampView(next, bounds());
  }
  /** Starting view of the selected site: about 150 km across at the pole, the whole Moon elsewhere. */
  function centre(): void {
    setLimits();
    const grid = cap();
    if (grid) {
      const spanKm = Math.max(8, Math.min(80, grid.meta.size * grid.meta.pixel_m / 8000));
      view = { ...view, scale: Math.min(maxScale, Math.max(minScale, view.height / (2 * spanKm * 1000))) };
    } else {
      view = { ...view, scale: minScale };
    }
    follow();
  }
  /** Brings the selected site to the middle of the view, keeping the zoom, as far as the map's edges allow. */
  function follow(): void {
    const p = project(selected().site);
    setView({ ...view, cx: p.x, cy: p.y });
    invalidate();
  }

  function resize(): void {
    const width = el.clientWidth, height = el.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const first = view.width <= 1;
    view = { ...view, width, height };
    if (first) { framed = false; update(getState()); } else {
      // A bigger canvas raises the zoom-out limit and shows more of the map: hold the view to both.
      setLimits();
      setView(zoomView(view, width / 2, height / 2, 1, minScale, maxScale));
    }
    invalidate();
  }

  function invalidate(): void {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => { frame = 0; if (!disposed) draw(); });
  }

  /** The finest of `steps` (largest first) that keeps grid lines at least `minPx` apart; the coarsest if none does. */
  function niceStep(steps: number[], pxPerDeg: number, minPx: number): number {
    let best = steps[0];
    for (const s of steps) if (s * pxPerDeg >= minPx) best = s;
    return best;
  }

  /**
   * Text on the map, with an outline in the page colour so it reads on lit and dark ground alike
   * (T19 "Done when" line 2: 4.5 to 1 against --bg). Uses the fill, font and alignment already set.
   */
  function label(text: string, x: number, y: number): void {
    ctx.save();
    ctx.strokeStyle = themeColor('--bg');
    ctx.lineWidth = theme.pinPx;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
    ctx.fillText(text, x, y);
  }

  function drawPolarGrid(): void {
    if (!cap()) return;
    const { width, height } = view;
    const p = pole(), toward = p === 'south' ? -1 : 1;
    /** The latitude `deg` degrees from the pole. */
    const latAt = (deg: number): number => toward * (90 - deg);
    const edgeLat = latAt(POLAR_REACH);
    const pole0 = viewToScreen(view, 0, 0);
    // About 30 km a degree near the pole: choose spacings that keep lines 60 px or more apart.
    const pxPerDegLat = Math.abs(polarForward(latAt(1), 0, p).y) * view.scale;
    const latStep = niceStep(POLAR_STEPS, pxPerDegLat, 60);
    ctx.lineWidth = 1;
    ctx.strokeStyle = themeColor('--border'); ctx.fillStyle = themeColor('--muted');
    ctx.font = theme.font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let n = 0; POLAR_REACH - n * latStep > 1e-9; n++) {
      const lat = latAt(Math.round((POLAR_REACH - n * latStep) * 1000) / 1000);
      const r = Math.abs(polarForward(lat, 0, p).y) * view.scale;
      ctx.beginPath(); ctx.arc(pole0.px, pole0.py, r, 0, Math.PI * 2); ctx.stroke();
      const at = viewToScreen(view, 0, polarForward(lat, 0, p).y);
      if (at.py > 0 && at.py < height) label(degLabel(lat, 'N', 'S'), pole0.px + 4, at.py - theme.fontPx / 2);
    }
    // Meridians: straight lines from the pole. Spacing from the circle 60 px out from the view's middle.
    const middleR = Math.max(60, Math.hypot(pole0.px - width / 2, pole0.py - height / 2));
    const lonStep = niceStep(MERIDIAN_STEPS, (middleR * Math.PI) / 180, 60);
    ctx.textAlign = 'center';
    for (let lon = -180; lon < 180; lon += lonStep) {
      const end = polarForward(edgeLat, lon, p);
      const s = viewToScreen(view, end.x, end.y);
      ctx.beginPath(); ctx.moveTo(pole0.px, pole0.py); ctx.lineTo(s.px, s.py); ctx.stroke();
      // Label where the meridian leaves the view, or at the map's edge.
      const t = Math.min(1, clipT(pole0.px, pole0.py, s.px, s.py, width, height));
      if (t > 0.05) {
        const lx = pole0.px + (s.px - pole0.px) * t * 0.97, ly = pole0.py + (s.py - pole0.py) * t * 0.97;
        label(degLabel(lon, 'E', 'W'), lx, ly);
      }
    }
  }
  /** How far along a segment from inside the view it stays inside, 0..1 (or more: it ends inside). */
  function clipT(x0: number, y0: number, x1: number, y1: number, w: number, h: number): number {
    let t = Infinity;
    const dx = x1 - x0, dy = y1 - y0;
    if (dx > 0) t = Math.min(t, (w - x0) / dx); else if (dx < 0) t = Math.min(t, -x0 / dx);
    if (dy > 0) t = Math.min(t, (h - y0) / dy); else if (dy < 0) t = Math.min(t, -y0 / dy);
    return x0 < 0 || x0 > w || y0 < 0 || y0 > h ? 0 : t;
  }

  function drawGlobalGrid(): void {
    const { width, height } = view;
    const pxPerDeg = (HALF_WORLD_KM / 180) * view.scale;
    const step = niceStep(GLOBAL_STEPS, pxPerDeg, 60);
    ctx.lineWidth = 1;
    ctx.strokeStyle = themeColor('--border'); ctx.fillStyle = themeColor('--muted');
    ctx.font = theme.font;
    const top = viewToScreen(view, 0, HALF_WORLD_KM / 2).py, bottom = viewToScreen(view, 0, -HALF_WORLD_KM / 2).py;
    const y0 = Math.max(0, top), y1 = Math.min(height, bottom);
    // Meridians: vertical lines, every `step` degrees, repeating east and west.
    const left = screenToView(view, 0, 0).x, right = screenToView(view, width, 0).x;
    const degPerKm = 180 / HALF_WORLD_KM;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let d = Math.ceil((left * degPerKm) / step) * step; d <= right * degPerKm; d += step) {
      const px = viewToScreen(view, d / degPerKm, 0).px;
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
      const lon = cylInverse(d / degPerKm, 0)!.lon;
      label(degLabel(Math.round(lon * 1000) / 1000, 'E', 'W'), px, y1 - 2);
    }
    // Parallels: horizontal lines.
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (let lat = -90; lat <= 90; lat += step) {
      const py = viewToScreen(view, 0, (lat / 180) * HALF_WORLD_KM).py;
      if (py < -1 || py > height + 1) continue;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
      label(degLabel(Math.round(lat * 1000) / 1000, 'N', 'S'), 4, py - 2);
    }
  }

  function drawMarker(site: LatLon, color: string, text: string): void {
    const p = project(site), s = viewToScreen(view, p.x, p.y);
    const r = theme.pinPx * 2;
    ctx.fillStyle = themeColor(color); ctx.strokeStyle = themeColor('--bg'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.px, s.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = themeColor('--text'); ctx.font = theme.font;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    label(text, s.px + r + 3, s.py);
  }

  function pinScreen(pin: Pin): { px: number; py: number; r: number } {
    const p = project(pin.site), s = viewToScreen(view, p.x, p.y);
    return { ...s, r: theme.pinPx * (pin.big ? 1.6 : 1) };
  }

  function draw(): void {
    const { width, height } = view;
    if (width <= 1 || el.hidden) return;
    if (baseDirty) {
      baseDirty = false;
      const s = getState(), lit = tabled(s.eph, selected().tMs);
      if (cap()) buildPolarBase(s, lit); else buildGlobalBase(s, lit);
    }
    const dpr = canvas.width / width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = themeColor('--bg'); ctx.fillRect(0, 0, width, height);
    if (base) {
      ctx.save();
      const grid = cap();
      if (grid && shade) {
        if (ring) {
          const half = ringHalf(), tl = viewToScreen(view, -half, half);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(ring, tl.px, tl.py, 2 * half * view.scale, 2 * half * view.scale);
        }
        const cell = grid.meta.pixel_m * shade.stride;
        // north.bin's grid is the mirror image of the north map (longitude 0 up): turn it upside
        // down, so its first row lies along the bottom edge.
        const flip = kind === 'north' ? -1 : 1;
        const corner = viewToScreen(view, grid.meta.x_min_m - cell / 2, flip * (grid.meta.y_max_m + cell / 2));
        const sizePx = shade.size * cell * view.scale;
        // Zoomed in to a few pixels a cell, show the cells as they are.
        ctx.imageSmoothingEnabled = cell * view.scale < 4;
        ctx.translate(corner.px, corner.py); ctx.scale(1, flip);
        ctx.drawImage(base, 0, 0, sizePx, sizePx);
      } else {
        const tl = viewToScreen(view, -HALF_WORLD_KM, HALF_WORLD_KM / 2);
        const w = 2 * HALF_WORLD_KM * view.scale, h = HALF_WORLD_KM * view.scale;
        ctx.imageSmoothingEnabled = true;
        for (let k = Math.floor(-tl.px / w) - 1; tl.px + k * w < width; k++) {
          if (tl.px + (k + 1) * w < 0) continue;
          ctx.drawImage(base, tl.px + k * w, tl.py, w, h);
        }
      }
      ctx.restore();
    }
    // T14 map layers, over the terrain and under the grid and pins; south-polar map only.
    if (kind === 'south' && dem) drawLayers(ctx, (x, y) => viewToScreen(view, x, y));
    if (kind !== 'global') drawPolarGrid(); else drawGlobalGrid();
    if (kind === 'global') {
      if (sunPoint) drawMarker(sunPoint, '--sun', 'Sun overhead');
      if (earthPoint) drawMarker(earthPoint, '--earth', 'Earth overhead');
    }
    for (const pin of pins) {
      const s = pinScreen(pin);
      if (s.px < -s.r || s.py < -s.r || s.px > width + s.r || s.py > height + s.r) continue;
      ctx.fillStyle = themeColor(pin.color); ctx.strokeStyle = themeColor('--bg'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.px, s.py, s.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function update(s: AppState): void {
    const sc = selected();
    // The north cap is stored with its latitudes negated (parseNorth).
    const nextKind: Kind = s.dem && s.dem.covers(sc.site.lat, sc.site.lon) ? 'south'
      : north && north.covers(-sc.site.lat, sc.site.lon) ? 'north' : 'global';
    const key = `${sc.site.lat},${sc.site.lon}`;
    const changedFrame = !framed || dem !== s.dem || kind !== nextKind;
    const changedSite = siteKey !== key;
    if (kind !== nextKind) baseKey = '';
    dem = s.dem; kind = nextKind; siteKey = key;
    el.hidden = s.mode !== '2d';
    readTheme();
    // The light layer is rebuilt in the next frame, not here: a timeline drag sends many changes
    // between two frames, and only the last needs drawing.
    baseDirty = true;
    const scenarios = [s.live, ...s.pinned, ...(s.ghost ? [s.ghost] : [])];
    pins = [
      ...s.sites.map((site): Pin => ({ site, color: '--muted', big: false })),
      ...scenarios.map((x): Pin => ({ site: x.site, color: x.color, scenarioId: x.id, big: x.id === s.selectedId })),
    ];
    if (view.width > 1) {
      if (changedFrame) { framed = true; centre(); } else if (changedSite) follow();
    }
    invalidate();
  }

  /** A click: a pin under the pointer first (the nearest), else the ground under it. */
  function pick(px: number, py: number): void {
    let best: Pin | null = null, bestD = Infinity;
    for (const pin of pins) {
      const s = pinScreen(pin), d = Math.hypot(s.px - px, s.py - py);
      if (d <= s.r + 2 && d < bestD) { best = pin; bestD = d; }
    }
    if (best) {
      if (best.scenarioId && getState().pinned.some((p) => p.id === best.scenarioId)) select(best.scenarioId);
      else setLiveSite({ lat: best.site.lat, lon: best.site.lon });
      return;
    }
    const site = unproject(px, py);
    if (site) setLiveSite(site);
  }

  // Pointers: one drags (pans), two pinch (zoom). A press that barely moves is a click.
  const pointers = new Map<number, { x: number; y: number }>();
  let press: { id: number; x: number; y: number; moved: number } | null = null;
  const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    press = pointers.size === 1 && e.isPrimary ? { id: e.pointerId, ...local(e), moved: 0 } : null;
  };
  const move = (e: PointerEvent): void => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const now = local(e);
    if (pointers.size === 1) {
      setView(panView(view, now.x - last.x, now.y - last.y));
      if (press) press.moved = Math.max(press.moved, Math.hypot(now.x - press.x, now.y - press.y));
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.entries()].map(([id, p]) => id === e.pointerId ? now : p);
      const [a0, b0] = [...pointers.values()];
      const before = Math.hypot(a0.x - b0.x, a0.y - b0.y), after = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const panned = panView(view, mid.x - mid0.x, mid.y - mid0.y);
      setView(before > 0 ? zoomView(panned, mid.x, mid.y, after / before, minScale, maxScale) : panned);
    }
    pointers.set(e.pointerId, now);
    invalidate();
  };
  const up = (e: PointerEvent): void => {
    const was = press;
    pointers.delete(e.pointerId);
    if (was && was.id === e.pointerId && was.moved <= CLICK_SLOP) { const p = local(e); pick(p.x, p.y); }
    if (!pointers.size || (was && was.id === e.pointerId)) press = null;
  };
  const cancel = (e: PointerEvent): void => { pointers.delete(e.pointerId); press = null; };
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = local(e);
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.height : 1;
    setView(zoomView(view, p.x, p.y, Math.exp((-e.deltaY * lines) / 600), minScale, maxScale));
    invalidate();
  };
  const key = (e: KeyboardEvent): void => {
    const stepPx = Math.min(view.width, view.height) / 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [stepPx, 0], ArrowRight: [-stepPx, 0], ArrowUp: [0, stepPx], ArrowDown: [0, -stepPx] };
    if (moves[e.key]) setView(panView(view, ...moves[e.key]));
    else if (e.key === '+' || e.key === '=') setView(zoomView(view, view.width / 2, view.height / 2, 1.5, minScale, maxScale));
    else if (e.key === '-' || e.key === '_') setView(zoomView(view, view.width / 2, view.height / 2, 1 / 1.5, minScale, maxScale));
    else if (e.key === 'Enter' || e.key === ' ') pick(view.width / 2, view.height / 2);
    else return;
    e.preventDefault(); invalidate();
  };
  /** The scene's "Centre selected site" button sends this. */
  const onCentre = (): void => { if (view.width > 1) centre(); };

  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', key);
  el.addEventListener('map:centre', onCentre);
  const observer = new ResizeObserver(resize); observer.observe(el);
  const themeObserver = new MutationObserver(() => { readTheme(); update(getState()); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  const unsubscribe = subscribe(update);
  // T14: redraw for layer data, opacity and every frame of a fade. Removes itself once disposed.
  const offLayers = onLayersChange(() => { if (disposed) offLayers(); else invalidate(); });
  update(getState()); resize();
  // The whole-Moon heights arrive after the first frame (the 3D globe shares the same download).
  // Without the files the map stays as it was: plain outside the polar grid.
  sharedGlobe().then((g) => {
    if (disposed) return;
    globe = g; baseDirty = true; invalidate();
  }).catch(() => undefined);
  // The north cap, for the north polar view (issue #112). Without its files a site near the north
  // pole stays on the whole-Moon map.
  sharedNorth().then((n) => {
    if (disposed) return;
    north = n; update(getState());
  }).catch(() => undefined);

  function dispose(): void {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); unsubscribe(); observer.disconnect(); themeObserver.disconnect();
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', key);
    el.removeEventListener('map:centre', onCentre);
    canvas.remove(); base = null; ring = null; ringCells = null; shade = null; globe = null; north = null;
    slopes = null; tones = null; mounts.delete(el);
  }
  mounts.set(el, dispose);
}
