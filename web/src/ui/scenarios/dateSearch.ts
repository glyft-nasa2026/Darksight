// T42: "Find a date" in the scenario panel. Searches from the live scenario's site and time
// (state.ts's dateSearchFor, core/datesearch.ts) and moves the live time to the first window
// found, through setLiveTime, as a typed time does. Pinned scenarios don't change. Kept in a file
// of its own so the panel's index.ts only places it.

import type { Need } from '../../core/datesearch';
import { monthsLater } from '../../core/datesearch';
import { dateSearchFor, getState, setLiveTime, subscribe, tableGap, type Scenario } from '../../state';
import { dateSearchText, HOUR_CHOICES, hoursText, MONTH_CHOICES, monthsText, NEED_CHOICES } from './dateSearchText';

type Ask = { site: Scenario['site']; tMs: number; need: Need; hours: number; months: number };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function menu(id: string, label: string, options: readonly { value: string; label: string }[]) {
  const select = make('select', 'field scn-find-menu');
  select.id = id;
  select.setAttribute('aria-label', label);
  for (const o of options) {
    const opt = make('option', '', o.label);
    opt.value = o.value;
    select.append(opt);
  }
  return select;
}

const sameSite = (a: Scenario['site'], b: Scenario['site']): boolean =>
  a.lat === b.lat && a.lon === b.lon && a.eye_m === b.eye_m;

/** The "Find a date" box. It subscribes to state itself. */
export function makeDateSearch(): HTMLElement {
  const box = make('fieldset', 'scn-find');
  const legend = make('legend', 'scn-label', 'Find a date, from the live time');
  const needBox = menu('scn-find-need', 'What must be up',
    NEED_CHOICES.map((c) => ({ value: c.value, label: c.label })));
  const hoursBox = menu('scn-find-hours', 'For at least',
    HOUR_CHOICES.map((h) => ({ value: String(h), label: `for ${hoursText(h)}` })));
  const monthsBox = menu('scn-find-months', 'Looking ahead',
    MONTH_CHOICES.map((m) => ({ value: String(m), label: `within ${monthsText(m)}` })));
  const button = make('button', 'btn', 'Find a date');
  button.type = 'button';
  button.title = 'Move the live time to the first window that meets these choices';
  const line = make('p', 'scn-note scn-find-note');
  line.setAttribute('role', 'status');
  const row = make('div', 'scn-find-row');
  row.append(needBox, hoursBox, monthsBox, button);
  box.append(legend, row, line);

  // The search waiting for its decades, and the window last moved to (its line stays while the
  // live scenario is still there).
  let pending: Ask | null = null;
  let shownAt: { site: Scenario['site']; tMs: number } | null = null;

  const choices = (): Omit<Ask, 'site' | 'tMs'> => ({
    need: needBox.value as Need, hours: Number(hoursBox.value), months: Number(monthsBox.value),
  });

  const run = (): void => {
    const ask = pending;
    if (!ask) return;
    const live = getState().live;
    const sc: Scenario = { ...live, site: ask.site, tMs: ask.tMs };
    const r = dateSearchFor(sc, ask.need, ask.hours, ask.months);
    line.textContent = dateSearchText(r, ask.need, ask.hours, ask.months, ask.tMs, tableGap, monthsLater(ask.tMs, ask.months));
    if (r.status === 'loading') return;
    pending = null;
    if (r.status === 'found') {
      shownAt = { site: ask.site, tMs: r.startMs };
      if (r.startMs !== live.tMs) setLiveTime(r.startMs);
    } else {
      shownAt = { site: ask.site, tMs: ask.tMs };
    }
  };

  button.addEventListener('click', () => {
    const live = getState().live;
    pending = { site: live.site, tMs: live.tMs, ...choices() };
    shownAt = null;
    run();
    render();
  });

  const render = (): void => {
    // An edit to the live scenario while a search waits, or after one answered, makes it stale.
    const before = getState().live;
    if (pending && !(sameSite(pending.site, before.site) && pending.tMs === before.tMs)) {
      pending = null;
      line.textContent = '';
    }
    if (pending) run();           // may move the live time: read state again below
    const s = getState();
    const live = s.live;
    if (!pending && shownAt && !(sameSite(shownAt.site, live.site) && shownAt.tMs === live.tMs)) {
      shownAt = null;
      line.textContent = '';
    }
    const loading = s.eph === null;
    button.disabled = loading || pending !== null;
    const label = loading ? 'Loading' : pending ? 'Searching…' : 'Find a date';
    if (button.textContent !== label) button.textContent = label;
  };

  // The line on screen answers the choices it was searched with: a changed menu clears it (and
  // a search still waiting for its decades), so it never sits beside menus that say otherwise.
  for (const m of [needBox, hoursBox, monthsBox]) {
    m.addEventListener('change', () => {
      pending = null;
      shownAt = null;
      line.textContent = '';
      render();
    });
  }

  subscribe(render);
  render();
  return box;
}
