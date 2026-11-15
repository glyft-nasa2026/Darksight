// Nudge (F11, T13; issues #58, #126): move the live scenario a chosen distance, 1 day, or straight
// to a pole, at once, and read what changed in plain words. The place it was stays on the map as a
// grey "Before" scenario; Undo goes back to it. Every number comes from core/ through state.ts.
//
// The panel is plain HTML floating over the map (the scene makes the #nudge slot inside its
// viewport), never drawn in the canvas. It starts folded (most visits don't need it), in the top
// left corner (issue #177); one button moves it round the corners, top left, top right, bottom left, bottom
// right, skipping a corner the map's own controls claim (an element there with data-map-corner).
import './nudge.css';
import { destination } from '../../core/geometry';
import { countdownText } from '../../core/windows';
import {
  flipFor, getState, neverLitFor, neverLitPendingFor, samplesFor, setGhost, setLiveSite, setLiveTime,
  skylineFor, subscribe, summaryFor, tableGap, type Scenario,
} from '../../state';
import { noRowText } from '../tableGap';
import {
  asCorner, clampKm, compare, CORNER_NAMES, DAY_MS, freeCorner, kmText, nextCorner, NUDGE_KM, NUDGES,
  POLES, START_CORNER, stepLabel, stepText, type Corner, type Facts, type Nudge,
} from './model';

const GHOST_ID = 'ghost';
/** The corner button shows an arrow to the corner it moves the panel to next. */
const CORNER_ARROWS: Record<Corner, string> = { tl: '↖', tr: '↗', bl: '↙', br: '↘' };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** Where one step from the live scenario goes: a site and a time. */
function stepTo(live: Scenario, n: Nudge, km: number): { site: Scenario['site']; tMs: number } {
  const site = n.lat !== undefined
    ? { ...live.site, lat: n.lat }
    : n.bearing === undefined
      ? { ...live.site }
      : { ...live.site, ...destination(live.site.lat, live.site.lon, n.bearing, km * 1000) };
  return { site, tMs: live.tMs + (n.days ?? 0) * DAY_MS };
}

/** The live scenario as it was before a step, drawn grey on the map. */
const beforeOf = (live: Scenario): Scenario => ({ ...live, site: { ...live.site }, id: GHOST_ID, label: 'Before', color: '--scn-ghost' });

/** Facts for the comparison, or null while that scenario's data is still loading. */
function factsOf(sc: Scenario): Facts | null {
  const first = samplesFor(sc, '30d')[0];
  if (!first) return null;
  const s = summaryFor(sc);
  return {
    tMs: sc.tMs, litPct: s.litPct, earthPct: s.earthPct,
    sunUp: first.sunFrac > 0, earthUp: first.earthUp,
    sunFlip: flipFor(sc, 'sun'), earthFlip: flipFor(sc, 'earth'),
    terrain: skylineFor(sc).terrain,
  };
}

const sunCount = (sc: Scenario, f: Facts): string =>
  countdownText('sun', f.sunUp, f.sunFlip, sc.tMs, !f.sunUp && neverLitFor(sc), !f.sunUp && neverLitPendingFor(sc));
const earthCount = (sc: Scenario, f: Facts): string =>
  countdownText('earth', f.earthUp, f.earthFlip, sc.tMs);

const sameAs = (a: Scenario, b: Scenario): boolean =>
  a.tMs === b.tMs && a.site.lat === b.site.lat && a.site.lon === b.site.lon && a.site.eye_m === b.site.eye_m;

export function mount(el: HTMLElement): void {
  el.classList.add('card', 'nudge-panel');

  // Head: title, corner button, fold button. Always shown.
  const head = make('div', 'nudge-head');
  const title = make('h2', '', 'Nudge');
  title.id = 'nudge-title';
  const corner = make('button', 'btn nudge-corner');
  corner.type = 'button';
  const fold = make('button', 'btn nudge-fold');
  fold.type = 'button';
  const body = make('div', 'nudge-body');
  body.id = 'nudge-body';
  fold.setAttribute('aria-controls', body.id);
  head.append(title, corner, fold);

  // Distance slider.
  let km: number = NUDGE_KM.start;
  const dist = make('label', 'nudge-dist');
  const distText = make('span', '', 'Distance');
  const slider = make('input');
  slider.type = 'range';
  slider.min = String(NUDGE_KM.min);
  slider.max = String(NUDGE_KM.max);
  slider.step = String(NUDGE_KM.step);
  slider.value = String(km);
  const distOut = make('output', 'nudge-dist-value', kmText(km));
  dist.append(distText, slider, distOut);

  const grid = make('div', 'nudge-grid');
  const days = make('div', 'nudge-days');
  const out = make('div', 'nudge-out');
  out.setAttribute('aria-live', 'polite');
  const actions = make('div', 'nudge-actions');
  const undo = make('button', 'btn', 'Undo');
  undo.type = 'button';
  actions.append(undo);
  actions.hidden = true;
  // Built once and left in place. Putting the slider back into the page on every redraw ended
  // a drag at its first step and took the keyboard focus off it.
  body.append(dist, grid, days, out, actions);

  el.setAttribute('aria-labelledby', title.id);
  el.replaceChildren(head, body);

  // Fold. Folded to start, on every screen (issue #126): most visits never nudge.
  // The arrow points the way the body opens or closes: in a top corner the body opens downward
  // (▼ opens, ▲ folds); in a bottom corner it opens upward, so the arrows swap.
  let folded = true;
  const drawFold = (): void => {
    const bottom = el.dataset.corner === 'bl' || el.dataset.corner === 'br';
    const arrow = folded === bottom ? '▲' : '▼';
    if (fold.textContent !== arrow) fold.textContent = arrow;   // only what changed: see place()
  };
  const setFolded = (f: boolean): void => {
    folded = f;
    body.hidden = f;
    drawFold();
    fold.setAttribute('aria-expanded', String(!f));
    fold.setAttribute('aria-label', f ? 'Show the nudge controls' : 'Hide the nudge controls');
    fold.title = f ? 'Show' : 'Hide';
  };
  fold.addEventListener('click', () => setFolded(!folded));

  // Corner: the one asked for, or the next free one if the map's own controls hold it.
  let wanted: Corner = START_CORNER;
  const taken = (): Set<Corner> => {
    const set = new Set<Corner>();
    const host = el.parentElement;
    if (!host) return set;
    for (const other of host.querySelectorAll<HTMLElement>('[data-map-corner]')) {
      if (other === el || el.contains(other)) continue;
      const c = asCorner(other.dataset.mapCorner);
      if (c) set.add(c);
    }
    return set;
  };
  const place = (): void => {
    const busy = taken();
    const at = freeCorner(wanted, busy) ?? wanted;
    if (el.dataset.corner !== at) el.dataset.corner = at;
    // One button: it shows where the panel goes next, round the corners in a fixed order. Only
    // what changed is written: the map watcher below sees the panel's own text changes too, and
    // rewriting the arrow every time would call this again without end.
    const next = nextCorner(at, busy);
    if (corner.textContent !== CORNER_ARROWS[next]) {
      corner.textContent = CORNER_ARROWS[next];
      corner.setAttribute('aria-label', `Move this panel to the ${CORNER_NAMES[next]} corner of the map`);
      corner.title = `Move to the ${CORNER_NAMES[next]} corner`;
    }
    if (corner.disabled !== (next === at)) corner.disabled = next === at;
    drawFold();
  };
  corner.addEventListener('click', () => { wanted = nextCorner(el.dataset.corner as Corner, taken()); place(); });
  // The map may add or move its own controls later; look again when it does.
  if (el.parentElement && typeof MutationObserver !== 'undefined') {
    new MutationObserver(place).observe(el.parentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-map-corner'],
    });
  }
  place();
  setFolded(folded);

  // The last step: the scenario before it (drawn grey as "Before") and the live scenario it made.
  // If live moves some other way (map click, time box, timeline), the comparison no longer means
  // anything and goes.
  let active: { nudge: Nudge; km: number; before: Scenario; after: Scenario } | null = null;
  let applying = false;   // while the step's own changes to state go through

  const STEPS: readonly Nudge[] = [...NUDGES, ...POLES];
  const buttons = new Map<string, HTMLButtonElement>();
  for (const n of STEPS) {
    const b = make('button', n.lat === undefined ? 'btn' : 'btn nudge-pole');
    b.type = 'button';
    b.addEventListener('click', () => {
      // At once, with no Keep or Discard (issue #126): the live scenario moves, and the panel says what changed.
      const live = getState().live;
      const to = stepTo(live, n, km);
      const before = beforeOf(live);
      applying = true;
      if (to.site.lat !== live.site.lat || to.site.lon !== live.site.lon) setLiveSite(to.site);
      if (to.tMs !== live.tMs) setLiveTime(to.tMs);
      applying = false;
      active = { nudge: n, km, before, after: getState().live };
      setGhost(before);
    });
    buttons.set(n.id, b);
  }
  const btn = (id: string): HTMLButtonElement => buttons.get(id) as HTMLButtonElement;
  // The poles sit either side of N.
  grid.append(btn('n-pole'), btn('n'), btn('s-pole'), btn('w'), btn('s'), btn('e'));
  days.append(btn('minus-day'), btn('plus-day'));

  const label = (): void => {
    distOut.textContent = kmText(km);
    slider.setAttribute('aria-valuetext', kmText(km));
    for (const n of STEPS) {
      const b = btn(n.id);
      b.textContent = stepText(n, km);
      b.setAttribute('aria-label', stepLabel(n, km));
    }
  };
  // The words follow the slider as it moves; the next step uses the distance it is let go at.
  slider.addEventListener('input', () => {
    km = clampKm(Number(slider.value));
    label();
    render();
  });
  slider.addEventListener('change', () => {
    km = clampKm(Number(slider.value));
    label();
    render();
  });
  label();

  undo.addEventListener('click', () => {
    if (!active) return;
    const { before, after } = active;
    active = null;
    setGhost(null);
    if (before.site.lat !== after.site.lat || before.site.lon !== after.site.lon) setLiveSite(before.site);
    if (before.tMs !== after.tMs) setLiveTime(before.tMs);
  });

  const render = (): void => {
    if (applying) return;
    const st = getState();
    const live = st.live;
    if (active && !sameAs(active.after, live)) {
      active = null;
      if (st.ghost?.id === GHOST_ID) {
        setGhost(null); // notifies, and this runs again with the "Before" scenario gone
        return;
      }
    }
    const before = st.ghost?.id === GHOST_ID ? st.ghost : null;
    const eph = st.eph;
    for (const n of STEPS) {
      const b = btn(n.id);
      const t = live.tMs + (n.days ?? 0) * DAY_MS;
      const there = n.lat !== undefined && live.site.lat === n.lat;
      b.disabled = !eph || t < eph.startMs || t > eph.endMs || there;
    }

    out.replaceChildren();
    if (!eph) {
      out.append(make('p', 'muted', 'Loading'));
      actions.hidden = true;
      return;
    }
    if (!before || !active) {
      // Outside the table every step is switched off; say why, in the readout's words. The same
      // words when the live time's decade did not download (T33).
      const gap = tableGap(live.tMs);
      out.append(make('p', 'muted nudge-hint', gap !== 'none'
        ? noRowText(gap, live.tMs)
        : `Move the live site ${kmText(km)}, 1 day, or to a pole: it moves at once, and this says what changed.`));
      actions.hidden = true;
      return;
    }

    // The step just taken, and what it changed: the live scenario now against before it.
    out.append(make('p', 'nudge-step', `Moved: ${stepText(active.nudge, active.km)}`));
    const fb = factsOf(before);
    const fn = factsOf(live);
    if (!fb || !fn) {
      // No hours for one side: its decade did not download (T33), or it is still on its way.
      const gone = [before, live].find((sc) => tableGap(sc.tMs) === 'failed');
      out.append(make('p', 'muted', gone ? noRowText('failed', gone.tMs) : 'Loading'));
    } else {
      for (const line of compare(fb, fn, !!st.dem)) out.append(make('p', `nudge-line nudge-${line.tone}`, line.text));
      const table = make('table', 'table nudge-table');
      const headRow = make('tr');
      headRow.append(make('th'), make('th', '', 'Before'), make('th', '', 'Now'));
      const row = (a: string, b: string): HTMLTableRowElement => {
        const tr = make('tr');
        tr.append(make('td'), make('td', '', a), make('td', '', b));
        return tr;
      };
      const sunRow = row(sunCount(before, fb), sunCount(live, fn));
      sunRow.firstElementChild!.textContent = 'Sun';
      const earthRow = row(earthCount(before, fb), earthCount(live, fn));
      earthRow.firstElementChild!.textContent = 'Earth';
      const thead = make('thead');
      thead.append(headRow);
      const tbody = make('tbody');
      tbody.append(sunRow, earthRow);
      table.append(thead, tbody);
      out.append(table);
    }
    out.append(make('p', 'muted nudge-hint', 'Where it was is shown in grey on the map'));
    actions.hidden = false;
  };

  subscribe(() => render());
  render();
}
