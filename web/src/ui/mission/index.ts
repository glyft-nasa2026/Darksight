// Mission simulation (T34): the whole mission to the landing point chosen with "Land here" on a
// scenario card, from a launch pad on Earth to touchdown. Design: docs/design/mission.png (T22);
// theme: ui/theme.css (T19).
//
// Every number comes from core/mission.ts (through state.ts's missionFor) or from the same
// state.ts accessors the readout uses. The animation draws only positions that missionAt
// returns; this file maps them onto the picture and formats them, nothing more.
import './mission.css';
import {
  EXAMPLE_LANDER, missionAt, R_EARTH, R_MOON, SEQUENCE, type Lander, type MissionState, type OkPlan,
  type StepId,
} from '../../core/mission';
import { PADS, padById } from '../../core/pads';
import { PHASE_NAMES as NAMES } from '../../core/report';
import {
  getState, landingScenario, missionFor, setLander, setPad, stateToAddress, subscribe,
} from '../../state';
import { openPadPicker } from '../launch/picker';
import {
  coordText, dayText, dvText, elapsedText, kgText, kmText, shortUtcText, speedText, utcText,
} from './format';
import { stepCells, totalsCells } from './cells';
import { conditionStats, landingConditions, missionWarnings } from './conditions';
import { BURN_SPEED, nextPace, paceLimit, rateText, regions, type Mode } from './pace';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 1000;   // the picture's viewBox
const H = 400;

const ERRORS = {
  'bad-input': 'The lander needs positive numbers, and a dry mass below its mass after TLI.',
  'coast-out-of-range': 'No transfer reaches the Moon in that coast time.',
  'thrust-too-low': 'This lander’s engine is too weak to stop before the ground, even starting the descent from just under 100 km. Give it more thrust.',
} as const;

// Simulated seconds per real second, the same as the simulation page's (pace.ts, issue #105):
// "Auto" (the default) picks one per stage, every change is gradual, and the playback slows
// in time for each burn, so the ascent and the powered descent don't flash past.
const SPEEDS: [label: string, s: number][] = [['1 min/s', 60], ['1 h/s', 3600], ['6 h/s', 6 * 3600]];

type View = 'auto' | 'earth' | 'moon' | 'descent';
type Scale = 'near' | 'earth' | 'moon' | 'descent';
const VIEWS: [View, string][] = [['auto', 'Auto'], ['earth', 'Earth–Moon'], ['moon', 'Lunar orbit'], ['descent', 'Descent']];
const LABELS: Record<Scale, string> = {
  near: 'EARTH · ASCENT AND PARKING ORBIT · A PICTURE OF THE MODEL',
  earth: 'EARTH AND MOON · PLANE OF THE TRANSFER · MOON DRAWN LARGER THAN SCALE',
  moon: 'MOON · PLANE OF THE LUNAR ORBIT · THE SITE AT THE TOP',
  descent: 'POWERED DESCENT · ALTITUDE AGAINST DISTANCE TO THE SITE · HEIGHT EXAGGERATED',
};

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, cls = '', attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (cls) el.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const stepOf = (plan: OkPlan, id: StepId) => plan.steps.find((s) => s.id === id)!;

/** The scale that suits a step, in "Auto". */
function autoScale(id: StepId): Scale {
  if (id === 'launch' || id === 'parking' || id === 'tli') return 'near';
  if (id === 'coast') return 'earth';
  if (id === 'powered-descent' || id === 'touchdown') return 'descent';
  return 'moon';
}

// ---------------------------------------------------------------------------------------------
// The picture: one scale at a time, positions from missionAt
// ---------------------------------------------------------------------------------------------

type Pt = [number, number];
type Sampled = { t: number; p: Pt }[];

/** missionAt at n + 1 even times from fromMs to toMs, keeping the point pick() takes. */
function track(plan: OkPlan, fromMs: number, toMs: number, n: number, pick: (s: MissionState) => Pt | null): Sampled {
  const out: Sampled = [];
  for (let i = 0; i <= n; i++) {
    const t = fromMs + ((toMs - fromMs) * i) / n;
    const p = pick(missionAt(plan, t));
    if (p) out.push({ t, p });
  }
  return out;
}

/** A uniform map from world coordinates (y up) into the viewBox (y down), fitting the box. */
function fit(minX: number, maxX: number, minY: number, maxY: number): (p: Pt) => Pt {
  const s = Math.min(W / (maxX - minX), H / (maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return ([x, y]) => [W / 2 + (x - cx) * s, H / 2 - (y - cy) * s];
}

const pathD = (pts: Pt[]): string =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

/**
 * A picture is one layer of the card's SVG. Its anchors say where Earth, the Moon and the site
 * are in it and how many viewBox units a kilometre is there, so a change of scale can zoom from
 * one picture into the next about the place they share (zoomBetween).
 */
type Anchors = {
  earth?: { p: Pt; s: number };            // Earth's centre; units per km
  moon?: { p: Pt; r: number };             // the Moon's disc as drawn; its radius
  site?: { p: Pt; s: number };             // the landing site; units per km along the ground
};
type Picture = { el: SVGGElement; update: (s: MissionState) => void; anchors: () => Anchors };

function picture(plan: OkPlan, scale: Scale, siteColor: string): Picture {
  const root = svg('g', 'ms-layer');
  let anchors: () => Anchors = () => ({});
  const ahead = svg('path', 'ms-ahead');
  const flown = svg('path', 'ms-flown');
  const craft = svg('circle', 'ms-craft ms-marker', { r: 6 });
  const tli = stepOf(plan, 'tli').startMs;
  const loi = stepOf(plan, 'loi').startMs;
  const doi = stepOf(plan, 'doi').startMs;
  const pdi = stepOf(plan, 'powered-descent').startMs;
  const td = plan.touchdownMs;
  let pts: Sampled = [];
  let map: (p: Pt) => Pt;
  let place: (s: MissionState) => Pt | null;
  let moonMark: SVGCircleElement | null = null;
  let moonR = 0;

  if (scale === 'near' || scale === 'earth') {
    const rEarthOrbit = plan.orbit.earthMoonKm;
    if (scale === 'near') {
      const half = 2.4 * (R_EARTH + plan.orbit.parkingAltKm);
      map = fit(-half * 2.5, half * 2.5, -half, half);
      pts = [...track(plan, plan.launchMs, tli, 240, (s) => s.earthPlane.craft),
        ...track(plan, tli, tli + 4 * 3600e3, 120, (s) => s.earthPlane.craft)];
    } else {
      pts = track(plan, tli, loi, 400, (s) => s.earthPlane.craft);
      const moonPath = track(plan, plan.launchMs, loi, 60, (s) => s.earthPlane.moon);
      const all = [[0, 0] as Pt, ...pts.map((x) => x.p), ...moonPath.map((x) => x.p)];
      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      const pad = 0.16 * rEarthOrbit;   // room for the label above Earth
      map = fit(Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad);
    }
    const [ox, oy] = map([0, 0]);
    const s = map([1, 0])[0] - ox;   // viewBox units per km
    root.append(svg('circle', 'ms-moon-orbit', { cx: ox, cy: oy, r: rEarthOrbit * s }));
    root.append(svg('circle', 'ms-orbit', { cx: ox, cy: oy, r: (R_EARTH + plan.orbit.parkingAltKm) * s }));
    root.append(svg('circle', 'ms-earth', { cx: ox, cy: oy, r: Math.max(R_EARTH * s, 5) }));
    moonR = Math.max(R_MOON * s, 6);
    const [ax, ay] = map(missionAt(plan, loi).earthPlane.moon);
    root.append(svg('circle', 'ms-moon ms-faint', { cx: ax, cy: ay, r: moonR }));
    moonMark = svg('circle', 'ms-moon', { r: moonR });
    root.append(moonMark);
    const mark = moonMark;
    anchors = () => ({
      earth: { p: [ox, oy], s },
      moon: { p: [Number(mark.getAttribute('cx')), Number(mark.getAttribute('cy'))], r: moonR },
    });
    place = (st) => map(st.earthPlane.craft);
  } else if (scale === 'moon') {
    const rOrbit = R_MOON + plan.orbit.lunarOrbitAltKm;
    // Seen from the side of the plane where the craft reaches the site from the left, as in the
    // descent picture, so the zoom from one into the other keeps it on the same side.
    const fitted = fit(-1.25 * rOrbit, 1.25 * rOrbit, -1.25 * rOrbit, 1.25 * rOrbit);
    map = ([x, y]) => fitted([-x, y]);
    const period = plan.orbit.lunarOrbitPeriodS * 1000;
    pts = [...track(plan, Math.max(loi, doi - period), doi, 180, (s) => s.moonPlane),
      ...track(plan, doi, pdi, 120, (s) => s.moonPlane),
      ...track(plan, pdi, td, 120, (s) => s.moonPlane)];
    const [ox, oy] = map([0, 0]);
    const s = Math.abs(map([1, 0])[0] - ox);
    root.append(svg('circle', 'ms-moon', { cx: ox, cy: oy, r: R_MOON * s }));
    const [sx, sy] = map([0, R_MOON]);
    const site = svg('circle', 'ms-site ms-marker', { cx: sx, cy: sy, r: 7 });
    site.style.setProperty('--ms-site', `var(${siteColor})`);
    root.append(site);
    anchors = () => ({ moon: { p: [ox, oy], r: R_MOON * s }, site: { p: [sx, sy], s } });
    place = (st) => (st.moonPlane ? map(st.moonPlane) : null);
  } else {
    // Altitude against distance to the site: separate scales, the height exaggerated.
    const raw = track(plan, pdi, td, 300, (s) => (s.rangeToGoKm === null ? null : [-s.rangeToGoKm, s.altKm]));
    const range = plan.orbit.descentRangeKm;
    const top = plan.orbit.descentStartAltKm;
    const x0 = -range * 1.04;
    const x1 = range * 0.06;
    const y0 = -top * 0.12;
    const y1 = top * 1.15;
    map = ([x, y]) => [((x - x0) / (x1 - x0)) * W, H - ((y - y0) / (y1 - y0)) * H];
    pts = raw;
    const [gx0, gy] = map([x0, 0]);
    const [gx1] = map([x1, 0]);
    root.append(svg('line', 'ms-ground', { x1: gx0, y1: gy, x2: gx1, y2: gy }));
    // Distance ticks every 100 km and the start altitude, as the timeline's axes do.
    for (let d = 0; d <= range; d += 100) {
      const [tx] = map([-d, 0]);
      root.append(svg('line', 'ms-gridl', { x1: tx, y1: gy, x2: tx, y2: gy + 6 }));
      const label = svg('text', 'ms-tick', { x: tx, y: gy + 22, 'text-anchor': 'middle' });
      label.textContent = d === 0 ? 'site' : `${d} km`;
      root.append(label);
    }
    const [, ty] = map([0, top]);
    root.append(svg('line', 'ms-gridl', { x1: gx0, y1: ty, x2: gx1, y2: ty }));
    const topLabel = svg('text', 'ms-tick', { x: gx0 + 8, y: ty - 6 });
    topLabel.textContent = `${kmText(top)} up`;
    root.append(topLabel);
    const [sx, sy] = map([0, 0]);
    const site = svg('circle', 'ms-site ms-marker', { cx: sx, cy: sy, r: 7 });
    site.style.setProperty('--ms-site', `var(${siteColor})`);
    root.append(site);
    const along = W / (x1 - x0);   // units per km of distance to the site
    anchors = () => ({ site: { p: [sx, sy], s: along } });
    place = (st) => (st.rangeToGoKm === null ? null : map([-st.rangeToGoKm, st.altKm]));
  }

  const screen = pts.map((x) => ({ t: x.t, p: map(x.p) }));
  ahead.setAttribute('d', pathD(screen.map((x) => x.p)));
  root.append(ahead, flown, craft);

  return {
    el: root,
    anchors: () => anchors(),
    update: (st) => {
      const here = place(st);
      craft.style.display = here ? '' : 'none';
      if (here) {
        craft.setAttribute('cx', here[0].toFixed(1));
        craft.setAttribute('cy', here[1].toFixed(1));
      }
      const done = screen.filter((x) => x.t <= st.tMs).map((x) => x.p);
      if (here && done.length) done.push(here);
      flown.setAttribute('d', done.length > 1 ? pathD(done) : '');
      if (moonMark) {
        const [mx, my] = map(st.earthPlane.moon);
        moonMark.setAttribute('cx', mx.toFixed(1));
        moonMark.setAttribute('cy', my.toFixed(1));
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// A change of scale: zoom from one picture into the next
// ---------------------------------------------------------------------------------------------

/** 0..1 eased with zero speed and zero acceleration at both ends (smootherstep). */
const ease = (f: number): number => f * f * f * (f * (6 * f - 15) + 10);
const ZOOM_BASE_MS = 1000;
const ZOOM_PER_E_FOLD_MS = 450;
const ZOOM_MAX_MS = 3000;

/**
 * Where the two pictures meet, and the scale between them: Earth from the Earth close-up to the
 * Earth-Moon view, the Moon from that view to the lunar orbit, the site from the lunar orbit to
 * the descent. Other pairs (a jump chosen with the view buttons) just cross-fade.
 */
function meeting(from: Picture, to: Picture): { a: Pt; b: Pt; r: number } {
  const fa = from.anchors();
  const fb = to.anchors();
  if (fa.site && fb.site) return { a: fa.site.p, b: fb.site.p, r: fa.site.s / fb.site.s };
  if (fa.earth && fb.earth) return { a: fa.earth.p, b: fb.earth.p, r: fa.earth.s / fb.earth.s };
  if (fa.moon && fb.moon) return { a: fa.moon.p, b: fb.moon.p, r: fa.moon.r / fb.moon.r };
  return { a: [W / 2, H / 2], b: [W / 2, H / 2], r: 1 };
}

/** Sets each marker's radius to its own size divided by the layer's zoom c. */
function keepSize(layer: SVGGElement, c: number): void {
  for (const m of layer.querySelectorAll<SVGCircleElement>('.ms-marker')) {
    if (!m.dataset.r) m.dataset.r = m.getAttribute('r') ?? '0';
    m.setAttribute('r', String(Number(m.dataset.r) / c));
  }
}

/**
 * Zooms from the picture shown to the next about the place they share: the old one grows (or
 * shrinks) away and fades out, the new one comes in from the matching size and fades in, so
 * the shared place stays put on screen while the scale changes. Returns a function that ends
 * it at once (for a new change before this one has finished).
 */
function zoomBetween(frame: SVGSVGElement, from: Picture, to: Picture, done: () => void): () => void {
  const { a, b, r } = meeting(from, to);
  const ms = Math.min(ZOOM_MAX_MS, ZOOM_BASE_MS + ZOOM_PER_E_FOLD_MS * Math.abs(Math.log(r)));
  frame.replaceChildren(from.el, to.el);
  frame.classList.add('ms-zooming');
  const start = performance.now();
  let raf = 0;
  const set = (e: number): void => {
    // Both layers keep the shared place at T, moving from where it was to where it will be.
    const tx = a[0] + (b[0] - a[0]) * e;
    const ty = a[1] + (b[1] - a[1]) * e;
    const cNew = r ** (1 - e);    // the new picture starts at the old one's scale
    const cOld = r ** -e;         // and the old one ends at the new one's
    to.el.setAttribute('transform', `translate(${tx} ${ty}) scale(${cNew}) translate(${-b[0]} ${-b[1]})`);
    from.el.setAttribute('transform', `translate(${tx} ${ty}) scale(${cOld}) translate(${-a[0]} ${-a[1]})`);
    to.el.style.opacity = String(e);
    from.el.style.opacity = String(1 - e);
    // Markers (the craft, the site) keep their size on screen while their layer zooms.
    keepSize(to.el, cNew);
    keepSize(from.el, cOld);
  };
  const finish = (): void => {
    cancelAnimationFrame(raf);
    to.el.removeAttribute('transform');
    to.el.style.opacity = '';
    keepSize(to.el, 1);
    frame.replaceChildren(to.el);
    frame.classList.remove('ms-zooming');
    done();
  };
  const step = (now: number): void => {
    const f = Math.min(1, (now - start) / ms);
    set(ease(f));
    if (f < 1) raf = requestAnimationFrame(step);
    else finish();
  };
  set(0);
  raf = requestAnimationFrame(step);
  return finish;
}

// ---------------------------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------------------------

export function mount(el: HTMLElement): void {
  const head = make('div', 'ms-head');
  const title = make('h2', '', 'Mission simulation');
  const note = make('span', 'badge', 'Planning model · not a flight-dynamics solution');
  head.append(title, note);
  const body = make('div', 'ms-body');
  el.replaceChildren(head, body);

  // --- Inputs (built once, so typing isn't lost on a redraw) ---------------------------------
  const padBox = make('select', 'field');
  padBox.id = 'ms-pad';
  for (const p of PADS) {
    const o = make('option', '', `${p.name} · ${p.pad}`);
    o.value = p.id;
    padBox.append(o);
  }
  padBox.addEventListener('change', () => setPad(padBox.value));
  const padLabel = make('label', 'ms-label', 'Launch pad');
  padLabel.htmlFor = padBox.id;

  const fields: [keyof Lander, string, string][] = [
    ['massKg', 'Mass after TLI', 'kg'], ['dryKg', 'Dry mass', 'kg'], ['ispS', 'Engine Isp', 's'], ['thrustN', 'Thrust', 'N'],
  ];
  const landerError = make('p', 'ms-error');
  landerError.setAttribute('role', 'alert');
  const boxes = new Map<keyof Lander, HTMLInputElement>();
  const landerGrid = make('div', 'ms-lander');
  for (const [key, label, unit] of fields) {
    const box = make('input', 'field ms-num');
    box.id = `ms-${key}`;
    box.inputMode = 'decimal';
    box.autocomplete = 'off';
    box.setAttribute('aria-describedby', 'ms-lander-error');
    const lab = make('label', 'ms-label', label);
    lab.htmlFor = box.id;
    const unitEl = make('span', 'ms-unit', unit);
    const wrap = make('div', 'ms-field');
    const row = make('div', 'ms-unit-row');
    row.append(box, unitEl);
    wrap.append(lab, row);
    landerGrid.append(wrap);
    boxes.set(key, box);
    box.addEventListener('change', () => {
      const next = { ...getState().lander, [key]: Number(box.value.replace(',', '.')) } as Lander;
      setLander(next);
      const ok = (Object.keys(next) as (keyof Lander)[]).every((k) => getState().lander[k] === next[k]);
      landerError.textContent = ok ? '' : ERRORS['bad-input'];
      box.setAttribute('aria-invalid', String(!ok));
    });
  }
  landerError.id = 'ms-lander-error';
  const exampleButton = make('button', 'btn ms-small', 'Example lander');
  exampleButton.type = 'button';
  exampleButton.addEventListener('click', () => {
    setLander({ ...EXAMPLE_LANDER });
    landerError.textContent = '';
    for (const b of boxes.values()) b.setAttribute('aria-invalid', 'false');
  });
  const landerNote = make('p', 'ms-note muted',
    'Example lander, about the size of Intuitive Machines’ Nova-C (its Isp is an example value). Edit to match yours.');

  // --- Proceed: choose the launch site on a globe, then the launch simulation page ------------
  const proceedButton = make('button', 'btn btn-primary ms-proceed', 'Proceed ›');
  proceedButton.type = 'button';
  proceedButton.setAttribute('aria-haspopup', 'dialog');
  const proceedNote = make('p', 'ms-note muted', 'Choose the launch site on the globe, then watch the whole flight on its own page.');
  proceedButton.addEventListener('click', () => {
    // The stars behind the globe are turned to the planned launch time (issue #80).
    const m = missionFor();
    openPadPicker({
      padId: getState().padId,
      tMs: m.status === 'ready' && m.plan.ok ? m.plan.launchMs : landingScenario()?.tMs,
      confirmLabel: 'Confirm launch pad · begin simulation',
      onConfirm: (id) => {
        setPad(id);
        // A new tab, so the planner and its landing scenario stay open here (issue #105). Not
        // 'noopener': with it window.open always returns null, so a blocked tab couldn't be told
        // apart, and the simulation's "Back" uses the opener to return to this tab. Same site.
        const url = `simulation.html#${stateToAddress()}`;
        const tab = window.open(url, '_blank');
        if (!tab) window.location.assign(url);   // a pop-up blocker stopped it: this tab instead
      },
    });
  });

  // --- The report (T35): the whole plan on a page of its own, to print or download -------------
  const reportButton = make('button', 'btn ms-report', 'Generate full launch schedule');
  reportButton.type = 'button';
  reportButton.disabled = true;
  const reportNote = make('p', 'ms-note muted', 'The plan as a report, to print, save as PDF, or download as JSON and CSV.');
  reportButton.addEventListener('click', () => {
    // A new tab, as the simulation: the planner stays open here. Same site, same address.
    const url = `report.html#${stateToAddress()}`;
    const tab = window.open(url, '_blank');
    if (!tab) window.location.assign(url);   // a pop-up blocker stopped it: this tab instead
  });

  // --- Side cards ----------------------------------------------------------------------------
  const launchInfo = make('div', 'ms-info');
  const landInfo = make('div', 'ms-info');
  const side = make('div', 'ms-side');
  side.append(launchInfo, landInfo, padLabel, padBox, landerGrid, landerError, exampleButton, landerNote, proceedButton, proceedNote, reportButton, reportNote);

  // --- Animation -----------------------------------------------------------------------------
  const view = make('div', 'ms-view');
  const viewLabel = make('span', 'ms-view-label');
  const stage = make('div', 'ms-stage');
  // One SVG for the animation; each scale's picture is a layer in it, so they can zoom into each other.
  const frameSvg = svg('svg', 'ms-svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  stage.append(frameSvg);
  const live = make('div', 'ms-live');
  view.append(viewLabel, stage, live);

  const playButton = make('button', 'btn btn-primary', '▶ Play');
  playButton.type = 'button';
  const speedSeg = make('div', 'ms-seg');
  speedSeg.setAttribute('role', 'group');
  speedSeg.setAttribute('aria-label', 'Speed');
  const scrub = make('input', 'ms-scrub');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = '1000';
  scrub.step = '1';
  scrub.setAttribute('aria-label', 'Mission time');
  const viewSeg = make('div', 'ms-seg');
  viewSeg.setAttribute('role', 'group');
  viewSeg.setAttribute('aria-label', 'Picture');
  const controls = make('div', 'ms-controls');
  controls.append(playButton, speedSeg, scrub, viewSeg);
  const slowNote = make('p', 'ms-note muted',
    `Auto picks a speed for each stage. Speeds change gradually, and the ascent and the powered descent play at most at ${BURN_SPEED} s/s.`);

  const main = make('div', 'ms-main');
  main.append(view, controls, slowNote);
  const top = make('div', 'ms-top');
  top.append(side, main);

  // --- Flight sequence, table, landing site ---------------------------------------------------
  const seqTitle = make('h3', '', 'Flight sequence');
  const steps = make('div', 'ms-steps');
  const tableWrap = make('div', 'ms-table-wrap');
  const condsTitle = make('h3', '', 'At the landing site, at touchdown');
  const conds = make('div', 'ms-conds');
  conds.setAttribute('aria-live', 'polite');
  const warnings = make('div', 'ms-warnings');
  const condsBox = make('div', 'ms-conds-box');
  condsBox.append(condsTitle, conds, warnings);
  const bottom = make('div', 'ms-bottom');
  bottom.append(tableWrap, condsBox);
  const model = make('p', 'ms-note muted',
    '* Ideal, without gravity and drag losses: the launch vehicle is not modelled. Model: patched conics from Earth to the Moon, ' +
    'instant burns but the descent, a 100 km circular polar lunar orbit, a gravity-turn powered descent, ' +
    'phase times from Apollo 11 (NASA SP-4029). The launch time is touchdown less the phases: no launch window is solved.');
  const message = make('p', 'muted');

  // --- Playback state --------------------------------------------------------------------------
  let plan: OkPlan | null = null;
  let cursor = 0;
  let playing = false;
  let speed: Mode = 'auto';
  let pace = 3600;                                   // the speed playing now, easing toward the limit
  let limits: ReturnType<typeof regions> = [];
  const settlePace = (): void => { if (plan) pace = paceLimit(limits, cursor); };
  let chosenView: View = 'auto';
  let shownScale: Scale | null = null;
  let pic: Picture | null = null;
  let leaving: Picture | null = null;         // the picture zooming away, still drawn
  let endZoom: (() => void) | null = null;
  let siteColor = '--accent';
  let frame = 0;
  let lastFrameMs = 0;
  const stepButtons = new Map<StepId, HTMLButtonElement>();

  const endMs = (): number => (plan ? plan.runsOutMs ?? plan.touchdownMs : 0);

  const setSpeed = (m: Mode): void => {
    speed = m;
    if (plan) limits = regions(plan, m);
    drawControls();
  };
  const autoButton = make('button', 'btn ms-small', 'Auto');
  autoButton.type = 'button';
  autoButton.dataset.speed = 'auto';
  autoButton.addEventListener('click', () => setSpeed('auto'));
  speedSeg.append(autoButton);
  for (const [label, s] of SPEEDS) {
    const b = make('button', 'btn ms-small', label);
    b.type = 'button';
    b.addEventListener('click', () => setSpeed(s));   // a manual speed turns Auto off; the change glides
    b.dataset.speed = String(s);
    speedSeg.append(b);
  }
  const rateNow = make('span', 'ms-rate');
  controls.insertBefore(rateNow, scrub);
  for (const [v, label] of VIEWS) {
    const b = make('button', 'btn ms-small', label);
    b.type = 'button';
    b.dataset.view = v;
    b.addEventListener('click', () => { chosenView = v; drawFrame(); drawControls(); });
    viewSeg.append(b);
  }

  const drawControls = (): void => {
    playButton.textContent = playing ? '❚❚ Pause' : '▶ Play';
    for (const b of speedSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.speed === String(speed)));
    autoButton.textContent = speed === 'auto' && plan ? `Auto · ${rateText(pace)}` : 'Auto';
    // A manual speed: say what is playing while it glides, or while a burn holds it slower.
    rateNow.textContent = speed !== 'auto' && plan && Math.abs(Math.log(pace / speed)) > 0.01 ? `now ${rateText(pace)}` : '';
    for (const b of viewSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === chosenView));
  };

  const drawFrame = (): void => {
    if (!plan) return;
    const st = missionAt(plan, cursor);
    const step = plan.steps[st.stepIndex];
    const scale: Scale = chosenView === 'auto' ? autoScale(step.id) : chosenView === 'earth'
      ? (autoScale(step.id) === 'near' ? 'near' : 'earth') : chosenView;
    if (scale !== shownScale || !pic) {
      endZoom?.();
      const next = picture(plan, scale, siteColor);
      next.update(st);
      if (pic && shownScale && !prefersReducedMotion()) {
        // Zoom from the old picture into the new one; under reduced motion, a cut.
        leaving = pic;
        pic.update(st);
        endZoom = zoomBetween(frameSvg, pic, next, () => { leaving = null; endZoom = null; });
      } else {
        frameSvg.replaceChildren(next.el);
      }
      shownScale = scale;
      pic = next;
      viewLabel.textContent = LABELS[scale];
    }
    pic.update(st);
    leaving?.update(st);

    // The live line.
    const parts: [string, string][] = [
      ['', NAMES[step.id]],
      ['UTC', utcText(st.tMs)],
      ['', elapsedText(st.elapsedS)],
      ['Altitude', kmText(st.altKm)],
      ['Speed', speedText(st.speedKmS)],
      ['Propellant', kgText(Math.max(0, st.propellantLeftKg))],
    ];
    if (st.ground) parts.push(['Over', coordText(st.ground.lat, st.ground.lon)]);
    if (st.rangeToGoKm !== null) parts.push(['To the site', kmText(st.rangeToGoKm)]);
    live.replaceChildren(...parts.map(([k, v]) => {
      const span = make('span');
      if (k) span.append(`${k} `);
      span.append(make('b', '', v));
      return span;
    }));

    scrub.value = String(Math.round(((cursor - plan.launchMs) / (plan.touchdownMs - plan.launchMs)) * 1000));
    // The current flight-sequence card: the last one started.
    let current: StepId = SEQUENCE[0];
    for (const id of SEQUENCE) if (stepOf(plan, id).startMs <= cursor) current = id;
    for (const [id, b] of stepButtons) {
      const isCurrent = id === current;
      if (isCurrent) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('ms-done', stepOf(plan, id).startMs < stepOf(plan, current).startMs);
    }
  };

  const tick = (now: number): void => {
    frame = 0;
    if (!playing || !plan) return;
    const dt = Math.min(0.25, (now - lastFrameMs) / 1000);
    lastFrameMs = now;
    pace = nextPace(pace, paceLimit(limits, cursor), dt);
    cursor = Math.min(endMs(), cursor + dt * pace * 1000);
    if (cursor >= endMs()) playing = false;
    drawFrame();
    drawControls();
    if (playing) frame = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    playing = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  playButton.addEventListener('click', () => {
    if (!plan) return;
    if (playing) {
      stop();
    } else {
      if (cursor >= endMs()) { cursor = plan.launchMs; settlePace(); }
      playing = true;
      lastFrameMs = performance.now();
      frame = requestAnimationFrame(tick);
    }
    drawControls();
  });
  scrub.addEventListener('input', () => {
    if (!plan) return;
    cursor = Math.min(endMs(), plan.launchMs + (Number(scrub.value) / 1000) * (plan.touchdownMs - plan.launchMs));
    settlePace();   // a jump in time starts at that moment's speed
    drawFrame();
    drawControls();
  });

  // --- Drawing a new plan ------------------------------------------------------------------------
  const drawSteps = (p: OkPlan): void => {
    stepButtons.clear();
    steps.replaceChildren(...SEQUENCE.map((id, i) => {
      const s = stepOf(p, id);
      const b = make('button', 'ms-step');
      b.type = 'button';
      let detail = '';
      if (id === 'launch') { const pad = padById(getState().padId); detail = `${pad.name} · ${pad.pad}`; }
      if (id === 'tli') detail = `Δv ${dvText(s.dvKmS ?? 0)}`;
      if (id === 'loi') detail = `${Math.round(p.orbit.lunarOrbitAltKm)} km orbit · Δv ${dvText(s.dvKmS ?? 0)}`;
      if (id === 'powered-descent') detail = `${kmText(p.orbit.descentStartAltKm)} → surface`;
      if (id === 'touchdown') {
        detail = p.runsOutMs !== null ? 'Not reached: out of propellant' : `${kgText(p.totals.propellantLeftKg)} propellant left`;
      }
      b.append(make('span', 'ms-k', String(i + 1).padStart(2, '0')), make('b', '', NAMES[id]),
        make('span', 'ms-when', dayText(s.startMs)), make('span', 'ms-when', detail));
      b.addEventListener('click', () => {
        cursor = Math.min(endMs(), s.startMs);
        settlePace();
        drawFrame();
        drawControls();
      });
      stepButtons.set(id, b);
      return b;
    }));
  };

  const drawTable = (p: OkPlan): void => {
    const table = make('table', 'table ms-table');
    const head = make('thead');
    const hr = make('tr');
    for (const h of ['Step', 'Start (UTC)', 'Takes', 'Δv', 'Burn', 'Propellant', 'Mass after']) {
      const th = make('th', '', h);
      th.scope = 'col';
      hr.append(th);
    }
    head.append(hr);
    const tbody = make('tbody');
    for (const s of p.steps) {
      if (s.id === 'touchdown') continue;
      const tr = make('tr');
      const c = stepCells(s, p.orbit);
      const th = make('th', '', c.name);
      th.scope = 'row';
      tr.append(th, make('td', '', shortUtcText(s.startMs)), make('td', '', c.takes), make('td', '', c.dv), make('td', '', c.burn),
        make('td', '', c.propellant), make('td', '', c.massAfter));
      tbody.append(tr);
    }
    const foot = make('tfoot');
    const fr = make('tr');
    const fth = make('th', '', 'Lander');
    fth.scope = 'row';
    const t = totalsCells(p.totals);
    fr.append(fth, make('td'), make('td'), make('td', '', t.dv), make('td'),
      make('td', '', t.used), make('td', t.short ? 'ms-bad' : '', t.left));
    foot.append(fr);
    table.append(head, tbody, foot);
    tableWrap.replaceChildren(table);
  };

  const info = (
    box: HTMLElement, k: string, name: string, sub: string, color: string | null, lat: number, lon: number, tMs: number,
  ): void => {
    const b = make('b');
    if (color) {
      const dot = make('span', 'ms-dot');
      dot.style.setProperty('--ms-site', `var(${color})`);
      dot.setAttribute('aria-hidden', 'true');
      b.append(dot);
    }
    b.append(name);
    box.replaceChildren(make('span', 'ms-k', k), b, ...(sub ? [make('span', 'ms-coord', sub)] : []),
      make('span', 'ms-coord muted', coordText(lat, lon)),
      // No time yet (the plan is still loading): the caller writes what replaces it.
      make('span', 'ms-coord', Number.isFinite(tMs) ? `${utcText(tMs)} UTC` : ''));
  };

  // --- Landing-site conditions (the readout's accessors, for the landing point) ------------------
  const drawConditions = (p: OkPlan | null): void => {
    const sc = landingScenario();
    const out: HTMLElement[] = [];
    const warn: HTMLElement[] = [];
    const stat = (k: string, v: string): HTMLElement => {
      const d = make('div', 'ms-stat');
      d.append(make('span', 'ms-k', k), make('span', 'ms-v', v));
      return d;
    };
    const flag = (text: string, bad = false): HTMLElement => make('p', bad ? 'ms-flag ms-flag-bad' : 'ms-flag', text);
    const c = sc && getState().eph ? landingConditions(sc) : null;
    if (c === 'loading') out.push(make('p', 'muted', 'Loading'));
    else if (c) for (const [k, v] of conditionStats(c)) out.push(stat(k, v));
    for (const w of missionWarnings(p, c)) warn.push(flag(w.text, w.level === 'bad'));
    conds.replaceChildren(...out);
    warnings.replaceChildren(...warn);
  };

  // --- Render from state ---------------------------------------------------------------------------
  const syncInputs = (): void => {
    const s = getState();
    if (document.activeElement !== padBox) padBox.value = s.padId;
    for (const [key, box] of boxes) {
      if (document.activeElement !== box && box.getAttribute('aria-invalid') !== 'true') box.value = String(s.lander[key]);
    }
  };

  let shownKey: unknown = null;
  const render = (): void => {
    const s = getState();
    const m = missionFor();
    const sc = landingScenario();
    syncInputs();
    const mock = /mock/i.test(s.eph?.meta.source ?? '');
    note.textContent = `Planning model · not a flight-dynamics solution${mock ? ' · mock data' : ''}`;

    if (m.status === 'none' || !sc) {
      reportButton.disabled = true;
      stop();
      plan = null;
      shownKey = null;
      message.textContent = 'No landing site chosen. Go back to the landing sites and press “Land here” on a scenario card, then “Open mission”.';
      body.replaceChildren(message);
      return;
    }
    siteColor = sc.color;
    const siteName = s.sites.find((c) => Math.abs(c.lat - sc.site.lat) < 1e-6 && Math.abs(c.lon - sc.site.lon) < 1e-6)?.name
      ?? `Scenario ${sc.label}`;
    const pad = padById(s.padId);
    const p = m.status === 'ready' && m.plan.ok ? m.plan : null;
    reportButton.disabled = !p;
    reportNote.textContent = p
      ? 'The plan as a report, to print, save as PDF, or download as JSON and CSV.'
      : 'The report is ready once the mission is planned.';
    info(launchInfo, '01 / Launch', pad.name, `${pad.pad} · ${pad.country}`, null, pad.lat, pad.lon, p ? p.launchMs : Number.NaN);
    if (!p) launchInfo.lastChild!.textContent = 'Launch time: once the plan is ready';
    info(landInfo, 'Final landing site', siteName, sc.label === 'Landing site' ? '' : sc.label === 'Live' ? 'Live scenario' : `Scenario ${sc.label}`, sc.color, sc.site.lat, sc.site.lon, sc.tMs);
    title.textContent = `Mission simulation · ${siteName}`;

    if (!p) {
      stop();
      plan = null;
      shownKey = null;
      if (m.status === 'loading') message.textContent = 'Loading';
      else if (m.status === 'outside') message.textContent = 'This landing time is too near the edge of the Sun and Earth table (1900 to 2100) for the mission.';
      else if (m.status === 'ready' && !m.plan.ok) message.textContent = ERRORS[m.plan.error];
      message.className = m.status === 'loading' ? 'muted' : 'ms-error-text';
      body.replaceChildren(top);
      main.replaceChildren(message);
      return;
    }

    if (shownKey !== p) {
      // A new plan: start at launch, paused (nothing plays by itself), and redraw everything.
      shownKey = p;
      stop();
      plan = p;
      cursor = p.launchMs;
      limits = regions(p, speed);
      settlePace();
      endZoom?.();
      shownScale = null;
      pic = null;
      main.replaceChildren(view, controls, slowNote);
      body.replaceChildren(top, seqTitle, steps, bottom, model);
      drawSteps(p);
      drawTable(p);
      drawFrame();
      drawControls();
    }
    drawConditions(p);
  };

  // Reduced motion: nothing ever plays by itself here, and scale changes are always cuts.
  if (prefersReducedMotion()) el.dataset.reducedMotion = 'true';
  subscribe(render);
  render();
}
