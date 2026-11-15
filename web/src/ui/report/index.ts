// The mission report (T35): the plan the mission card shows, as a report to read, print, save as
// PDF, or download as JSON and CSV. Opened by "Generate full launch schedule" on the card, with
// the same page address, so missionFor() gives the same plan. Design: docs/design/report.png.
//
// Every number comes from core/report.ts (built from the plan and missionAt) or from
// ui/mission/conditions.ts, the card's own landing-site numbers. This file lays them out.
import './report.css';
import { BRIEF_PAD_COUNT, PADS, padById } from '../../core/pads';
import {
  buildReport, descentTrack, EVENT_NAMES, reportCsv, reportFileName, reportJson,
  type LandingConditions, type Report, type ReportWarning,
} from '../../core/report';
import type { Data, Layout } from 'plotly.js-dist-min';
import type { OkPlan } from '../../core/mission';
import { getState, landingScenario, missionFor, samplesFor, stateToAddress, subscribe } from '../../state';
import { stepCells, totalsCells } from '../mission/cells';
import { conditionStats, landingConditions, missionWarnings, planMessage } from '../mission/conditions';
import {
  coordText, durationText, dvText, elapsedText, kgText, kmText, pctText, speedText, utcText,
} from '../mission/format';
import { axisTitle, chartLine, plotLayout, themeColor } from '../plotTheme';
import { whenPlotly } from '../plotly';
import {
  clockText, dataText, landerText, pageTitle, phaseTimesText, statusOf, toTouchdownText, whereText,
} from './text';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A table in its own sideways-scrolling box (phones), with a header row that repeats on paper. */
function table(head: string[], rows: (string | Node)[][], opts: { cls?: string; caption?: string; rowHead?: boolean } = {}): HTMLElement {
  const t = make('table', `table rp-table ${opts.cls ?? ''}`.trim());
  if (opts.caption) t.append(make('caption', 'muted', opts.caption));
  const thead = make('thead');
  const hr = make('tr');
  for (const h of head) {
    const th = make('th', '', h);
    th.scope = 'col';
    hr.append(th);
  }
  thead.append(hr);
  const tbody = make('tbody');
  for (const row of rows) {
    const tr = make('tr');
    row.forEach((cell, i) => {
      let td: HTMLTableCellElement;
      if (opts.rowHead && i === 0) {
        const th = make('th');
        th.scope = 'row';
        td = th;
      } else td = make('td');
      td.append(cell);
      tr.append(td);
    });
    tbody.append(tr);
  }
  t.append(thead, tbody);
  const wrap = make('div', 'rp-table-wrap');
  wrap.append(t);
  return wrap;
}

/** Two lines in one cell: the value, and a smaller line under it. */
function two(top: string, under: string): Node {
  const f = document.createDocumentFragment();
  f.append(make('span', 'rp-top', top));
  if (under) f.append(make('span', 'rp-under muted', under));
  return f;
}

function facts(pairs: [string, string | Node][]): HTMLElement {
  const dl = make('dl', 'rp-facts');
  for (const [k, v] of pairs) {
    const d = make('div', 'rp-fact');
    const dt = make('dt', '', k);
    const dd = make('dd');
    dd.append(v);
    d.append(dt, dd);
    dl.append(d);
  }
  return dl;
}

function section(n: number, title: string, ...content: Node[]): HTMLElement {
  const s = make('section', 'rp-section');
  const h = make('h2', '', `${n} · ${title}`);
  s.append(h, ...content);
  return s;
}

const flag = (w: ReportWarning): HTMLElement => make('p', w.level === 'bad' ? 'rp-flag rp-flag-bad' : 'rp-flag', w.text);

/** Saves text as a file. Made here from a Blob: nothing is sent anywhere. */
function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = make('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- The descent chart: Plotly on screen, a picture in the print colours on paper ----------------

function descentFigure(plan: OkPlan): { data: Data[]; layout: Partial<Layout> } {
  const track = descentTrack(plan, 1);
  const base = plotLayout();
  return {
    data: [{
      type: 'scatter', mode: 'lines', name: 'Powered descent',
      x: track.map((d) => d.rangeToGoKm), y: track.map((d) => d.altKm),
      line: { color: themeColor('--accent'), width: chartLine('thick') },
      hovertemplate: '%{y:.2f} km up, %{x:.1f} km to go<extra></extra>',
    }],
    layout: {
      ...base,
      showlegend: false,
      xaxis: { ...base.xaxis, title: axisTitle('Distance to the site (km)'), autorange: 'reversed', rangemode: 'tozero' },
      yaxis: { ...base.yaxis, title: axisTitle('Altitude (km)'), rangemode: 'tozero' },
    },
  };
}

async function drawChart(box: HTMLElement, img: HTMLImageElement, plan: OkPlan): Promise<void> {
  const Plotly = await whenPlotly();
  box.replaceChildren();
  const screen = descentFigure(plan);
  await Plotly.react(box, screen.data, screen.layout, { displayModeBar: false, responsive: true });
  // The same figure in the print colours, read while the class is on (no paint happens between).
  const root = document.documentElement;
  root.classList.add('print-colours');
  const paper = descentFigure(plan);
  root.classList.remove('print-colours');
  const width = Math.max(box.clientWidth, box.offsetWidth);
  const height = Math.max(box.clientHeight, box.offsetHeight);
  img.src = await Plotly.toImage({ data: paper.data, layout: paper.layout }, { format: 'svg', width, height });
}

// --- The page --------------------------------------------------------------------------------

export function mount(el: HTMLElement): void {
  const head = make('div', 'rp-head');
  const title = make('h1', '', 'Mission report');
  head.append(title);
  const message = make('p', 'muted', 'Loading');
  el.replaceChildren(head, message);

  // The @page header: the mission's name on every printed page (a margin box can't read the DOM).
  const pageStyle = make('style');
  document.head.append(pageStyle);

  let shownKey = '';

  const render = (): void => {
    const s = getState();
    const m = missionFor();
    const sc = landingScenario();
    const plan = m.status === 'ready' && m.plan.ok ? m.plan : null;
    if (!plan || !sc) {
      shownKey = '';
      title.textContent = 'Mission report';
      head.replaceChildren(title);
      pageStyle.textContent = '';
      message.textContent = planMessage(m) ?? 'Loading';
      message.className = m.status === 'loading' ? 'muted' : 'rp-error';
      el.replaceChildren(head, message);
      el.dispatchEvent(new CustomEvent('report-ready', { detail: null, bubbles: true }));
      return;
    }
    const cond = landingConditions(sc);
    const surface = samplesFor(sc, '30d');
    // Wait for the landing site's hours too, so the report is whole when it appears.
    if (cond === 'loading') {
      message.textContent = 'Loading';
      message.className = 'muted';
      el.replaceChildren(head, message);
      return;
    }
    const key = `${stateToAddress()}|${s.eph?.meta.source}|${surface.length}|${cond.sunText}|${cond.earthText}`;
    if (key === shownKey) return;
    shownKey = key;

    const curated = s.sites.find((c) => Math.abs(c.lat - sc.site.lat) < 1e-6 && Math.abs(c.lon - sc.site.lon) < 1e-6);
    const pad = padById(s.padId);
    const padChecked = PADS.findIndex((x) => x.id === pad.id) < BRIEF_PAD_COUNT;
    const warnings = missionWarnings(plan, cond);
    const data = { ephemeris: s.eph?.meta.source ?? null, terrain: s.dem?.meta.source ?? null };
    if ([data.ephemeris, data.terrain].some((x) => x !== null && /mock/i.test(x))) {
      warnings.push({ code: 'mock', level: 'warn', text: 'Mock data: the numbers are examples.' });
    }
    if (!padChecked) {
      warnings.push({ code: 'pad-unchecked', level: 'warn', text: `${pad.name} · ${pad.pad}: its coordinates have not been checked against a map yet.` });
    }
    const report = buildReport(plan, {
      generatedMs: Date.now(),
      site: { id: curated?.id ?? null, name: curated?.name ?? `Scenario ${sc.label}`, lat: sc.site.lat, lon: sc.site.lon },
      pad, padChecked, lander: { ...s.lander }, data,
      shareLink: new URL(`mission.html#${stateToAddress()}`, location.href).href,
      conditions: cond, surface, warnings,
    });
    draw(plan, report);
    el.dispatchEvent(new CustomEvent('report-ready', { detail: report, bubbles: true }));
  };

  const draw = (plan: OkPlan, r: Report): void => {
    const status = statusOf(r);
    title.textContent = `Mission report · ${r.site.name}`;
    document.title = `Mission report · ${r.site.name} · Darksight`;
    const header = pageTitle(r, utcText(r.touchdownMs)).replace(/["\\]/g, '');
    pageStyle.textContent = `@media print { @page { @top-left { content: "${header}"; } } }`;
    const badge = make('span', `badge rp-status rp-${status.level}`, status.text);
    const model = make('span', 'badge', 'Planning model · not a flight-dynamics solution');
    head.replaceChildren(title, badge, model);

    // 1. Title block
    const share = make('a', 'rp-link', r.shareLink);
    share.href = r.shareLink;
    const titleBlock = make('section', 'rp-section rp-titleblock');
    titleBlock.append(facts([
      ['Landing site', two(`${r.site.name} · ${coordText(r.site.lat, r.site.lon)}`, `Touchdown ${utcText(r.touchdownMs)} UTC`)],
      ['Launch', two(`${r.pad.name} · ${r.pad.pad}, ${r.pad.country} · ${coordText(r.pad.lat, r.pad.lon)}`, `Launch ${utcText(r.launchMs)} UTC`)],
      ['Mission length', durationText(r.durationS)],
      ['Lander', landerText(r)],
      ['Phase lengths', phaseTimesText(r)],
      ['Report made', `${utcText(r.generatedMs)} UTC · data: ${dataText(r)}`],
      ['Share link', share],
    ]));

    // 2. Flight schedule
    const schedule = table(
      ['#', 'Phase · where', 'Start (UTC) · T+', 'Takes', 'Δv', 'Burn', 'Propellant', 'Mass after'],
      r.phases.map((p) => {
        const c = stepCells(p, r.orbit);
        return [
          String(p.n).padStart(2, '0'),
          two(c.name, whereText(p, r)),
          two(utcText(p.startMs), elapsedText(p.metStartS)),
          two(c.takes, p.endMs > p.startMs ? `to ${utcText(p.endMs)}` : ''),
          c.dv, c.burn, c.propellant, c.massAfter,
        ];
      }),
      { cls: 'rp-schedule' },
    );
    const star = make('p', 'muted rp-note', '* Ideal, without gravity and drag losses: the launch vehicle is not modelled. — means the model gives no number there.');

    // 3. Key events
    const events = table(
      ['Event', 'UTC', 'T+', 'To touchdown', 'Altitude', 'Speed', 'Propellant left'],
      r.events.map((e) => [
        EVENT_NAMES[e.id], utcText(e.tMs), elapsedText(e.metS), toTouchdownText(e.toTouchdownS),
        `${kmText(e.altKm)} above ${e.near === 'earth' ? 'Earth' : 'the Moon'}`, speedText(e.speedKmS), kgText(e.propellantLeftKg),
      ]),
      { rowHead: true },
    );

    // 4. Coast
    const coast = table(
      ['T+', 'UTC', 'Altitude', 'Speed'],
      r.coast.map((c) => [elapsedText(c.metS), utcText(c.tMs), `${kmText(c.altKm)} above ${c.near === 'earth' ? 'Earth' : 'the Moon'}`, speedText(c.speedKmS)]),
    );

    // 5. Totals and orbits
    const t = totalsCells(r.totals);
    const o = r.orbit;
    const totals = facts([
      ['Launch vehicle Δv', `${dvText(r.totals.launchVehicleDvKmS)}*`],
      ['Lander Δv', t.dv],
      ['Propellant loaded', kgText(r.totals.propellantLoadedKg)],
      ['Propellant used', t.used],
      ['Propellant left', t.left],
      ['Mass at touchdown', kgText(r.totals.massAtTouchdownKg)],
    ]);
    if (t.short) totals.querySelectorAll('dd')[4].classList.add('rp-bad');
    const orbits = facts([
      ['Earth parking orbit', `${Math.round(o.parkingAltKm)} km, inclined ${o.parkingIncDeg.toFixed(1)}°`],
      ['Transfer apogee', kmText(o.transferApogeeKm)],
      ['Earth–Moon at arrival', kmText(o.earthMoonKm)],
      ['Arrival speed (v∞)', speedText(o.vInfKmS)],
      ['Translunar coast', durationText(o.coastS)],
      ['Lunar orbit', `${Math.round(o.lunarOrbitAltKm)} km, inclined ${o.lunarOrbitIncDeg.toFixed(0)}° · period ${durationText(o.lunarOrbitPeriodS)}`],
      ['Descent start', o.descentStartRaised
        ? `${kmText(o.descentStartAltKm)}: raised from 15 km, the engine is too weak to stop from there`
        : kmText(o.descentStartAltKm)],
      ['Throttle, held', pctText(o.throttle)],
      ['Descent range', kmText(o.descentRangeKm)],
      ['Touchdown speed', speedText(o.touchdownSpeedKmS)],
    ]);
    const totalsGrid = make('div', 'rp-two');
    const tBox = make('div');
    tBox.append(make('h3', '', 'Totals'), totals);
    const oBox = make('div');
    oBox.append(make('h3', '', 'Orbits'), orbits);
    totalsGrid.append(tBox, oBox);

    // 6. Powered descent
    const d = r.descent;
    const descentFacts = facts([
      ['Ignition', `${utcText(d.startMs)} UTC at ${kmText(o.descentStartAltKm)}`],
      ['Duration', durationText(d.durationS)],
      ['Δv', dvText(d.dvKmS)],
      ['Propellant', kgText(d.propellantKg)],
      ['Ground range', kmText(o.descentRangeKm)],
      ['Throttle', pctText(o.throttle)],
    ]);
    const chart = make('div', 'rp-chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', 'Altitude against distance to the site during the powered descent');
    chart.append(make('p', 'muted chart-wait', 'Loading chart'));
    const chartImg = make('img', 'rp-chart-print');
    chartImg.alt = 'Altitude against distance to the site during the powered descent';
    const descentTable = table(
      ['Since ignition', 'UTC', 'Altitude', 'Speed', 'To the site', 'Propellant left'],
      d.rows.map((x) => [clockText(x.sinceIgnitionS), utcText(x.tMs), kmText(x.altKm), speedText(x.speedKmS), kmText(x.rangeToGoKm), kgText(x.propellantLeftKg)]),
      { caption: 'Every 30 s from ignition, and at touchdown' },
    );

    // 7. Landing site at touchdown
    const c = r.conditions as LandingConditions;
    const above = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;
    const site = facts([
      ...conditionStats(c),
      ['Sun azimuth · above the skyline', `${c.sun.azDeg.toFixed(1)}° · ${above(c.sun.aboveSkylineDeg)}`],
      ['Earth azimuth · above the skyline', `${c.earth.azDeg.toFixed(1)}° · ${above(c.earth.aboveSkylineDeg)}`],
      ['Longest light, 30 days', durationText(c.summary.longestLit_h * 3600)],
      ['Longest dark, 30 days', durationText(c.summary.longestDark_h * 3600)],
      ['Longest without Earth, 30 days', durationText(c.summary.longestEarthGap_h * 3600)],
      ['Skyline', c.terrainText],
    ]);

    // 8. First 30 days on the surface
    const periodTable = (body: 'sun' | 'earth'): HTMLElement => table(
      [body === 'sun' ? 'Sun' : 'Earth', 'From (UTC)', 'To (UTC)', 'Length'],
      r.surface.filter((p) => p.body === body).map((p) => [
        body === 'sun' ? (p.up ? 'Up' : 'Down') : (p.up ? 'Visible' : 'Hidden'),
        utcText(p.startMs), utcText(p.endMs), durationText((p.endMs - p.startMs) / 1000),
      ]),
      { rowHead: true },
    );
    const surfaceGrid = make('div', 'rp-two');
    surfaceGrid.append(periodTable('sun'), periodTable('earth'));
    const surfaceNote = make('p', 'muted rp-note', 'To the hour: the Sun and Earth are checked every hour from touchdown. The Sun counts as up while any of its disc clears the skyline.');

    // 9. Warnings
    const warn = r.warnings.length > 0 ? r.warnings.map(flag) : [make('p', 'muted', 'None.')];

    // 10. Model and sources
    const limits = make('ul', 'rp-list');
    for (const line of r.model) limits.append(make('li', '', line));
    const sources = make('ul', 'rp-list');
    for (const src of r.sources) {
      const li = make('li', '', `${src.name}: `);
      const a = make('a', 'rp-link', src.url);
      a.href = src.url;
      li.append(a);
      sources.append(li);
    }

    el.replaceChildren(
      head, titleBlock,
      section(1, 'Flight schedule', schedule, star),
      section(2, 'Key events', events),
      section(3, 'Translunar coast, every 12 hours', coast),
      section(4, 'Totals and orbits', totalsGrid),
      section(5, 'Powered descent', descentFacts, chart, chartImg, descentTable),
      section(6, 'Landing site at touchdown', site),
      section(7, 'First 30 days on the surface', surfaceGrid, surfaceNote),
      section(8, 'Warnings', ...warn),
      section(9, 'Model and limits', limits, make('h3', '', 'Sources'), sources),
    );
    void drawChart(chart, chartImg, plan).catch((err: unknown) => {
      chart.replaceChildren(make('p', 'muted', 'The chart could not load. The table below has the same numbers.'));
      console.warn('descent chart:', err);
    });
  };

  subscribe(render);
  render();
}

/** The report shown now, for the page's buttons; null while there is none. */
export function downloads(r: Report): { json: () => void; csv: () => void } {
  return {
    json: () => download(reportFileName(r, 'json'), 'application/json', reportJson(r)),
    csv: () => download(reportFileName(r, 'csv'), 'text/csv;charset=utf-8', reportCsv(r)),
  };
}
