// Solar panel choice (T15, spec F15): the power a flat panel and an upright panel turned to face
// the Sun would make at the selected scenario, now and over the next 30 days. The numbers come
// from core/panel.ts on state.ts's cached samples; this file only rounds and labels them.
import './panel.css';
import {
  BATTERY_LIMITS, batteryRun, EXAMPLE_BATTERY, hoursOnBattery, type Battery,
} from '../../core/battery';
import { panelAverage, panelPower, type PanelPower } from '../../core/panel';
import { getState, samplesFor, selected, setBattery, subscribe, tableGap } from '../../state';
import { noRowText } from '../tableGap';
import { chargeText, hoursText, powerText } from './format';

const WHY =
  'Near the poles the Sun stays close to the horizon, so its light skims a flat panel almost ' +
  'edge-on. An upright panel that turns to follow the Sun catches it face-on.';

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function powerTable(now: PanelPower, month: PanelPower): HTMLTableElement {
  const table = make('table', 'table pn-table');
  const head = make('thead');
  const headRow = make('tr');
  headRow.append(make('th', '', 'Panel'), make('th', '', 'Now'), make('th', '', '30 days'));
  for (const th of headRow.children) th.setAttribute('scope', 'col');
  head.append(headRow);
  const body = make('tbody');
  const rows: [string, keyof PanelPower][] = [['Flat on the ground', 'flat'], ['Upright, facing the Sun', 'upright']];
  for (const [label, key] of rows) {
    const tr = make('tr');
    const th = make('th', '', label);
    th.setAttribute('scope', 'row');
    tr.append(th, make('td', '', powerText(now[key])), make('td', '', powerText(month[key])));
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

export function mount(el: HTMLElement): void {
  const title = make('h2', '', 'Solar panel');
  const intro = make('p', 'pn-intro muted', 'Power as a share of full sunlight on the panel’s face');
  const content = make('div', 'pn-content');
  content.setAttribute('aria-live', 'polite');
  const why = make('p', 'pn-why muted', WHY);

  // --- Battery (T40): an upright panel charging a battery against a steady use ---------------
  const batTitle = make('h3', 'pn-bat-title', 'Battery');
  const batIntro = make('p', 'pn-intro muted',
    'An upright panel turned to the Sun charges the battery; the load draws its power all the time. '
    + 'The timeline playback runs the same battery.');
  const inputs: { key: keyof Battery; label: string; unit: string; step: string }[] = [
    { key: 'capacityWh', label: 'Battery', unit: 'Wh', step: '100' },
    { key: 'panelW', label: 'Panel', unit: 'W', step: '10' },
    { key: 'useW', label: 'Power use', unit: 'W', step: '10' },
  ];
  const grid = make('div', 'pn-bat-inputs');
  const boxes = {} as Record<keyof Battery, HTMLInputElement>;
  for (const f of inputs) {
    const label = make('label', 'pn-bat-field');
    const name = make('span', 'pn-bat-name', `${f.label} (${f.unit})`);
    const box = make('input', 'field');
    box.type = 'number';
    box.inputMode = 'decimal';
    box.min = String(BATTERY_LIMITS[f.key].min);
    box.max = String(BATTERY_LIMITS[f.key].max);
    box.step = f.step;
    boxes[f.key] = box;
    label.append(name, box);
    grid.append(label);
  }
  const batError = make('p', 'pn-error');
  batError.setAttribute('role', 'alert');
  const example = make('button', 'btn pn-bat-example', 'Example values');
  example.type = 'button';
  const batOut = make('div', 'pn-bat-out');
  batOut.setAttribute('aria-live', 'polite');

  el.replaceChildren(title, intro, content, why, batTitle, batIntro, grid, batError, example, batOut);

  const applyBattery = (): void => {
    const b: Battery = {
      capacityWh: Number(boxes.capacityWh.value), panelW: Number(boxes.panelW.value), useW: Number(boxes.useW.value),
    };
    const bad = inputs.find((f) => {
      const v = b[f.key];
      return boxes[f.key].value.trim() === '' || !Number.isFinite(v)
        || v < BATTERY_LIMITS[f.key].min || v > BATTERY_LIMITS[f.key].max;
    });
    if (bad) {
      batError.textContent = `${bad.label}: a number from ${BATTERY_LIMITS[bad.key].min} to `
        + `${BATTERY_LIMITS[bad.key].max.toLocaleString('en-GB')} ${bad.unit}.`;
      return;
    }
    batError.textContent = '';
    setBattery(b);
  };
  for (const f of inputs) boxes[f.key].addEventListener('change', applyBattery);
  example.addEventListener('click', () => {
    batError.textContent = '';
    for (const f of inputs) boxes[f.key].value = String(EXAMPLE_BATTERY[f.key]);
    setBattery({ ...EXAMPLE_BATTERY });
  });

  const stat = (k: string, v: string, bad = false): HTMLDivElement => {
    const d = make('div', bad ? 'pn-stat pn-stat-bad' : 'pn-stat');
    d.append(make('span', 'pn-stat-k muted', k), make('span', 'pn-stat-v', v));
    return d;
  };

  const renderBattery = (): void => {
    const s = getState();
    const b = s.battery;
    // A box being typed in keeps its text; the others show the stored values.
    for (const f of inputs) {
      const box = boxes[f.key];
      if (document.activeElement !== box && (box.value === '' || Number(box.value) !== b[f.key])) {
        box.value = String(b[f.key]);
      }
    }
    if (!s.eph) {
      batOut.replaceChildren(make('p', 'muted', 'Loading'));
      return;
    }
    const sc = selected();
    const samples = samplesFor(sc, '30d');
    if (samples.length === 0 || samples[0].tMs !== sc.tMs) {
      batOut.replaceChildren();
      return;
    }
    const run = batteryRun(samples, b);
    const flat = run.flatSpells === 0
      ? 'never'
      : `${run.flatSpells} ${run.flatSpells === 1 ? 'time' : 'times'}, ${hoursText(run.flatHours)} in all `
        + `(longest ${hoursText(run.longestFlatHours)})`;
    batOut.replaceChildren(
      stat('A full battery with no sunlight', `lasts ${hoursText(hoursOnBattery(b))}`),
      stat('Runs flat in the next 30 days', flat, run.flatSpells > 0),
      stat('Lowest charge, starting full', chargeText(run.lowestFrac), run.lowestFrac <= 0),
      stat('Charge after 30 days', chargeText(run.endFrac)),
    );
  };

  const render = (): void => {
    if (!getState().eph) {
      content.replaceChildren(make('p', 'muted', 'Loading'));
      return;
    }
    const sc = selected();
    const samples = samplesFor(sc, '30d');
    const now = samples[0];
    if (!now || now.tMs !== sc.tMs) {
      content.replaceChildren(make('p', 'pn-error', noRowText(tableGap(sc.tMs), sc.tMs)));
      return;
    }
    content.replaceChildren(powerTable(panelPower(now), panelAverage(samples)));
  };

  subscribe(render);
  subscribe(renderBattery);
  render();
  renderBattery();
}
