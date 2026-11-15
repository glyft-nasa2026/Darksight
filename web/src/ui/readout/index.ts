// Readout (T08): F3 Sun and Earth for the selected scenario, F4 the two countdowns.
// Every number comes from state.ts accessors, which call core/; this file only formats them.
// T41 adds the ground slope at the site, from core/slope.ts.
import './readout.css';
import { slopeAt, slopeBaselineM } from '../../core/slope';
import { countdownText } from '../../core/windows';
import {
  flipFor, getState, LIVE_ID, neverLitFor, neverLitPendingFor, samplesFor, selected, skylineFor,
  subscribe, tableGap, type AppState,
} from '../../state';
import { noRowText } from '../tableGap';
import { azText, degText, pctText, slopeText, type SlopeInfo } from './format';

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function utcText(tMs: number): string {
  return new Date(tMs).toISOString().slice(0, 16).replace('T', ' ');
}

/** A small table of name and value rows, under a heading, with the countdown below. */
function bodyBlock(name: string, rows: [string, string][], countdown: string, kind: 'sun' | 'earth'): HTMLElement {
  const block = make('div', `ro-body ro-${kind}`);
  const head = make('h3', 'ro-head', name);
  const table = make('table', 'table ro-table');
  const tbody = make('tbody');
  for (const [k, v] of rows) {
    const tr = make('tr');
    tr.append(make('th', '', k), make('td', '', v));
    tbody.append(tr);
  }
  table.append(tbody);
  const cd = make('p', 'ro-countdown', countdown);
  block.append(head, table, cd);
  return block;
}

/** The slope at a site from core/slope.ts, or the reason there is none. */
function slopeInfo(dem: AppState['dem'], lat: number, lon: number): SlopeInfo {
  if (!dem) return { kind: 'loading' };
  if (!dem.covers(lat, lon)) return { kind: 'outside', minLat: dem.meta.min_lat };
  const deg = slopeAt(dem, lat, lon);
  return deg === null ? { kind: 'nodata' } : { kind: 'ok', deg, baselineM: slopeBaselineM(dem) };
}

export function mount(el: HTMLElement): void {
  const title = make('h2', '', 'Readout');
  const whose = make('p', 'ro-whose');
  const where = make('p', 'ro-where muted');
  const slope = make('p', 'ro-slope');
  const note = make('p', 'ro-note badge');
  const content = make('div', 'ro-content');
  content.setAttribute('aria-live', 'polite');
  el.replaceChildren(title, whose, where, slope, note, content);

  const render = (): void => {
    const s = getState();
    const sc = selected();

    whose.replaceChildren();
    whose.style.setProperty('--scn-color', `var(${sc.color})`);
    const dot = make('span', 'ro-dot');
    dot.setAttribute('aria-hidden', 'true');
    whose.append(dot, sc.id === LIVE_ID ? 'Live scenario' : `Scenario ${sc.label} (pinned)`);

    const site = s.sites.find((c) => Math.abs(c.lat - sc.site.lat) < 1e-6 && Math.abs(c.lon - sc.site.lon) < 1e-6);
    const coords = `${sc.site.lat.toFixed(4)}°, ${sc.site.lon.toFixed(4)}°`;
    where.textContent = `${site ? `${site.name} · ` : ''}${coords} · ${utcText(sc.tMs)} UTC`;

    slope.textContent = slopeText(slopeInfo(s.dem, sc.site.lat, sc.site.lon));

    note.textContent = skylineFor(sc).terrain ? '' : 'Smooth Moon, no terrain';

    if (!s.eph) {
      content.replaceChildren(make('p', 'muted', 'Loading'));
      return;
    }
    const now = samplesFor(sc, '30d')[0];
    if (!now || now.tMs !== sc.tMs) {
      content.replaceChildren(make('p', 'ro-error', noRowText(tableGap(sc.tMs), sc.tMs)));
      return;
    }

    const sunUp = now.sunFrac > 0;
    const sun = bodyBlock('Sun', [
      ['Altitude', degText(now.sun.alt)],
      ['Azimuth', azText(now.sun.az)],
      ['Above skyline', degText(now.sunAbove)],
      ['Disc visible', pctText(now.sunFrac)],
    ], countdownText('sun', sunUp, flipFor(sc, 'sun'), sc.tMs, neverLitFor(sc), neverLitPendingFor(sc)), 'sun');

    const earth = bodyBlock('Earth', [
      ['Altitude', degText(now.earth.alt)],
      ['Azimuth', azText(now.earth.az)],
      ['Above skyline', degText(now.earthAbove)],
      ['Visible', now.earthUp ? 'Yes' : 'Hidden'],
    ], countdownText('earth', now.earthUp, flipFor(sc, 'earth'), sc.tMs), 'earth');

    content.replaceChildren(sun, earth);
  };

  subscribe(render);
  render();
}
