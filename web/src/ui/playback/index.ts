// Timeline playback (T40, F8): Play moves the live time forward at a chosen speed, through
// setLiveTime as a drag does, so the map and 3D shadows, the strips, the timeline chart and the
// sky panorama all follow it. While it plays this card says whether the Sun and Earth are in view,
// whether the direct radio link to Earth is blocked, and how the battery charged by an upright
// panel holds up against the power use set on the solar panel card.
//
// Every number comes from core/ through state.ts (the hourly samples, which start at the live
// time) and core/battery.ts; model.ts moves the time and words the results.
import './playback.css';
import { chargeAfter, netWatts, panelWatts } from '../../core/battery';
import {
  getState, LIVE_ID, samplesFor, setLiveTime, subscribe, tableGap, type AppState,
} from '../../state';
import {
  advance, batteryLine, changedElsewhere, commsLine, earthLine, powerLine, SPEEDS, START_SPEED,
  stepAction, stepEveryMs, sunLine, type Line, type Watched,
} from './model';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const utc = (tMs: number): string => `${new Date(tMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const watched = (s: AppState): Watched => ({
  tMs: s.live.tMs, lat: s.live.site.lat, lon: s.live.site.lon, selectedLive: s.selectedId === LIVE_ID,
});

export function mount(el: HTMLElement): void {
  const title = make('h2', '', 'Timeline playback');
  const intro = make('p', 'pb-intro muted',
    'Plays the live scenario forward in time. The map, the strips, the timeline and the sky panorama follow it.');

  const play = make('button', 'btn btn-primary pb-play', '▶ Play');
  play.type = 'button';
  const speeds = make('div', 'pb-speeds');
  speeds.setAttribute('role', 'group');
  speeds.setAttribute('aria-label', 'Playback speed');
  const speedButtons = SPEEDS.map((sp) => {
    const b = make('button', 'btn pb-speed', sp.text);
    b.type = 'button';
    b.dataset.speed = sp.id;
    b.setAttribute('aria-label', sp.label);
    speeds.append(b);
    return b;
  });
  const controls = make('div', 'pb-controls');
  controls.append(play, speeds);

  const clock = make('p', 'pb-clock');
  const message = make('p', 'pb-message muted');
  message.setAttribute('role', 'status');

  const list = make('dl', 'pb-list');
  const rows: Record<'sun' | 'earth' | 'comms' | 'power' | 'battery', { dd: HTMLElement; text: HTMLElement; detail: HTMLElement }> =
    {} as never;
  const rowNames: [keyof typeof rows, string][] = [
    ['sun', 'Sun'], ['earth', 'Earth'], ['comms', 'Communication'], ['power', 'Solar panel'], ['battery', 'Battery'],
  ];
  for (const [key, name] of rowNames) {
    const dt = make('dt', '', name);
    const dd = make('dd');
    const text = make('span', 'pb-value');
    const detail = make('span', 'pb-detail muted');
    dd.append(text, detail);
    list.append(dt, dd);
    rows[key] = { dd, text, detail };
  }
  const meter = make('div', 'pb-meter');
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', 'Battery charge');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  const meterFill = make('span');
  meter.append(meterFill);
  rows.battery.dd.append(meter);

  const full = make('button', 'btn pb-full', 'Charge to full');
  full.type = 'button';
  const setup = make('p', 'pb-setup muted');
  const foot = make('div', 'pb-foot');
  foot.append(full, setup);

  el.replaceChildren(title, intro, controls, clock, message, list, foot);

  // --- Playing --------------------------------------------------------------------------------
  let playing = false;
  let speedId = START_SPEED;
  let raf = 0;
  let lastStep = 0;            // wall clock of the last move, or of the last wait
  let expected: Watched | null = null;   // what the live scenario was after our own last move
  // The battery's charge, Wh. Starts full; carried through pauses; "Charge to full" resets it.
  let chargeWh: number | null = null;
  let chargeAtMs: number | null = null;  // the live time that charge belongs to

  const hoursPerS = (): number => SPEEDS.find((s) => s.id === speedId)!.hoursPerS;

  const drawControls = (): void => {
    play.textContent = playing ? '❚❚ Pause' : '▶ Play';
    play.setAttribute('aria-pressed', String(playing));
    for (const b of speedButtons) {
      const on = b.dataset.speed === speedId;
      b.classList.toggle('btn-primary', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  const stop = (why = ''): void => {
    playing = false;
    cancelAnimationFrame(raf);
    expected = null;
    message.textContent = why;
    drawControls();
  };

  const frame = (now: number): void => {
    if (!playing) return;
    raf = requestAnimationFrame(frame);
    if (now - lastStep < stepEveryMs(prefersReducedMotion())) return;
    const elapsed = now - lastStep;
    lastStep = now;
    const s = getState();
    const from = s.live.tMs;
    const samples = s.eph ? samplesFor(s.live, '30d') : [];
    // Whole minutes, so the page address and the time box stay tidy.
    const to = Math.round(advance(from, hoursPerS(), elapsed) / 60_000) * 60_000;
    const action = stepAction(samples.length > 0, tableGap(from), tableGap(to));
    if (action === 'stop') { stop('Stopped: the end of the Sun and Earth table (2100).'); return; }
    if (action === 'wait') { message.textContent = 'Waiting for the Sun and Earth table for these years…'; return; }
    message.textContent = '';
    // The battery runs over the hours just played, on the samples that start at the old time.
    const b = s.battery;
    chargeWh = chargeAfter(chargeWh ?? b.capacityWh, samples, from, to, b);
    chargeAtMs = to;
    expected = { ...watched(s), tMs: to, selectedLive: true };
    setLiveTime(to);
  };

  const start = (): void => {
    if (playing) return;
    const s = getState();
    if (!s.eph) { message.textContent = 'Loading'; return; }
    playing = true;
    expected = { ...watched(s), selectedLive: true };
    lastStep = performance.now();
    message.textContent = '';
    drawControls();
    raf = requestAnimationFrame(frame);
  };

  play.addEventListener('click', () => (playing ? stop() : start()));
  for (const b of speedButtons) {
    b.addEventListener('click', () => { speedId = b.dataset.speed!; drawControls(); });
  }
  full.addEventListener('click', () => {
    chargeWh = getState().battery.capacityWh;
    chargeAtMs = getState().live.tMs;
    render();
  });

  // --- Drawing -----------------------------------------------------------------------------------
  const put = (key: keyof typeof rows, line: Line): void => {
    const r = rows[key];
    if (r.text.textContent !== line.text) r.text.textContent = line.text;
    if (r.detail.textContent !== line.detail) r.detail.textContent = line.detail;
    if (r.dd.dataset.tone !== line.tone) r.dd.dataset.tone = line.tone;
  };

  const render = (): void => {
    const s = getState();
    // Something else moved the live scenario (a drag, a typed time, a nudge, a new site): pause.
    if (playing && expected && changedElsewhere(expected, watched(s))) stop('Paused: the live scenario was changed.');
    const b = s.battery;
    setup.textContent = `Battery ${b.capacityWh.toLocaleString('en-GB')} Wh · upright panel ${b.panelW.toLocaleString('en-GB')} W · use ${b.useW.toLocaleString('en-GB')} W. Change them on the solar panel card.`;
    clock.textContent = utc(s.live.tMs);
    const samples = s.eph ? samplesFor(s.live, '30d') : [];
    const now = samples[0];
    list.hidden = !now || now.tMs !== s.live.tMs;
    if (!now || now.tMs !== s.live.tMs) {
      if (!playing) message.textContent = s.eph ? (tableGap(s.live.tMs) === 'outside' ? 'This time is outside the Sun and Earth table' : 'Loading') : 'Loading';
      return;
    }
    if (!playing && (message.textContent === 'Loading' || message.textContent === 'This time is outside the Sun and Earth table')) message.textContent = '';
    // A charge kept for another time (the scenario moved while paused) starts again from there.
    if (chargeWh === null || chargeAtMs !== s.live.tMs) {
      chargeWh = Math.min(chargeWh ?? b.capacityWh, b.capacityWh);
      chargeAtMs = s.live.tMs;
    }
    chargeWh = Math.min(chargeWh, b.capacityWh);
    const net = netWatts(now, b);
    put('sun', sunLine(now));
    put('earth', earthLine(now));
    put('comms', commsLine(now));
    put('power', powerLine(panelWatts(now, b), net));
    const frac = chargeWh / b.capacityWh;
    put('battery', batteryLine(frac, net));
    const pct = Math.min(100, Math.max(0, frac * 100));
    meterFill.style.inlineSize = `${pct}%`;
    meter.setAttribute('aria-valuenow', pct.toFixed(1));
    meter.dataset.tone = rows.battery.dd.dataset.tone;
  };

  drawControls();
  subscribe(render);
  render();
}
