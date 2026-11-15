// The launch simulation page (T34): the mission from the mission card, launch to touchdown, as a
// full-window 3D animation. "Proceed" on the mission card opens it with the same page address,
// which state.ts reads, so this page plans the same mission (missionFor). "Back to mission
// planner" returns to the card. Every number shown comes from core/ through state.ts and
// missionAt; scene.ts only draws positions.
import '../ui/theme.css';
import './simulation.css';
import { loadEphemeris } from '../core/ephemeris';
import { missionAt, SEQUENCE, type OkPlan, type StepId } from '../core/mission';
import { padById } from '../core/pads';
import { moonOrbitIcrf } from '../core/sky';
import type { CuratedSite } from '../core/types';
import { getState, landingScenario, missionFor, setData, stateToAddress, subscribe } from '../state';
import { prefersReducedMotion } from '../ui/launch/earth';
import {
  coordText, dayText, dvText, elapsedText, kgText, kmText, speedText, utcText,
} from '../ui/mission/format';
import { createScene, scaleFor, type MissionScene, type Scale } from './scene';

const NAMES: Record<StepId, string> = {
  launch: 'Launch', parking: 'Parking orbit', tli: 'Translunar injection', coast: 'Translunar coast',
  loi: 'Lunar orbit insertion', 'lunar-orbit': 'Lunar orbit', doi: 'Descent orbit insertion',
  'descent-orbit': 'Descent orbit', 'powered-descent': 'Powered descent', touchdown: 'Touchdown',
};
const LABELS: Record<Scale, string> = {
  near: 'EARTH · ASCENT AND PARKING ORBIT',
  earth: 'EARTH AND MOON · PLANE OF THE TRANSFER',
  moon: 'MOON · LUNAR ORBIT, THE SITE MARKED',
  descent: 'POWERED DESCENT TO THE SITE',
};
const ERRORS = {
  'bad-input': 'The lander’s numbers are not valid. Go back to the mission planner to fix them.',
  'coast-out-of-range': 'No transfer reaches the Moon in that coast time.',
  'thrust-too-low': 'This lander’s engine is too weak to stop before the ground. Go back and give it more thrust.',
} as const;

// Simulated seconds per real second. "Auto" (the default) picks one per stage (issue #105):
// Earth orbit 1 h/s, the trip to the Moon 6 h/s, lunar orbit 1 h/s, the landing 30 min/s.
// The two burns that last minutes, the ascent and the powered descent, play at most at
// SLOW_SPEED in every mode, so they take about half a minute instead of flashing past.
const SPEEDS: [label: string, s: number][] = [['1 min/s', 60], ['1 h/s', 3600], ['6 h/s', 6 * 3600]];
const AUTO_SPEED: Record<StepId, number> = {
  launch: 3600, parking: 3600,
  tli: 6 * 3600, coast: 6 * 3600,
  loi: 3600, 'lunar-orbit': 3600,
  doi: 1800, 'descent-orbit': 1800, 'powered-descent': 1800, touchdown: 1800,
};
const SLOW_SPEED = 30;
const SLOW_STEPS: StepId[] = ['launch', 'powered-descent'];

/** "30 s/s", "30 min/s", "6 h/s". */
const rateText = (s: number): string => (s < 60 ? `${s} s/s` : s < 3600 ? `${s / 60} min/s` : `${s / 3600} h/s`);

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

const root = document.getElementById('sim') as HTMLElement;

// --- The page --------------------------------------------------------------------------------
const back = make('a', 'btn sim-back', '‹ Back to mission planner');
const title = make('h1', 'sim-title', 'Launch simulation');
const badge = make('span', 'badge', 'Planning model · not a flight-dynamics solution');
const bar = make('header', 'sim-bar');
bar.append(back, title, badge);

const stage = make('div', 'sim-stage');
const canvasBox = make('div', 'sim-canvas');
const scaleLabel = make('span', 'sim-scale');
const message = make('p', 'sim-message muted', 'Loading');
message.setAttribute('role', 'status');
const trips = make('div', 'sim-trip');
stage.append(canvasBox, scaleLabel, trips, message);

const live = make('div', 'sim-live');
live.setAttribute('aria-live', 'off');
const play = make('button', 'btn btn-primary', '▶ Play');
play.type = 'button';
const speeds = make('div', 'sim-seg');
speeds.setAttribute('role', 'group');
speeds.setAttribute('aria-label', 'Speed');
const scrub = make('input', 'sim-scrub');
scrub.type = 'range';
scrub.min = '0';
scrub.max = '1000';
scrub.step = '1';
scrub.setAttribute('aria-label', 'Mission time');
const controls = make('div', 'sim-controls');
controls.append(play, speeds, scrub);
const chapters = make('div', 'sim-steps');
const note = make('p', 'sim-note muted',
  'A picture of the model: Earth, the Moon and the orbits to scale in the plane of the transfer; the craft, pad and site are markers. ' +
  'Earth is turned so the pad is under the craft at launch. Drag to look around; the view follows each phase.');
const hud = make('section', 'card sim-hud');
hud.setAttribute('aria-label', 'Mission playback');
hud.append(live, controls, chapters, note);

root.append(bar, stage, hud);

// --- Back to the planner -----------------------------------------------------------------------
const plannerUrl = (): string => `index.html#${stateToAddress()}`;
back.href = plannerUrl();
back.addEventListener('click', (e) => {
  // Opened in a new tab by the planner (issue #105): the planner is still open in its own tab,
  // as it was left. Close this one, which returns there; if the browser won't, follow the link.
  let planner: Window | null = null;
  try { planner = window.opener && !window.opener.closed ? window.opener : null; } catch { planner = null; }
  if (planner) {
    e.preventDefault();
    try { planner.focus(); } catch { /* not allowed everywhere; closing still shows it */ }
    window.close();
    setTimeout(() => { if (!window.closed) location.assign(plannerUrl()); }, 300);
    return;
  }
  // Came here in the same tab from the planner: go back to it as it was left.
  const from = document.referrer ? new URL(document.referrer) : null;
  if (from && from.origin === location.origin && !from.pathname.endsWith('simulation.html') && history.length > 1) {
    e.preventDefault();
    history.back();
  }
});

// --- Playback ------------------------------------------------------------------------------------
let plan: OkPlan | null = null;
let picture: MissionScene | null = null;
let cursor = 0;
let playing = false;
let speed: 'auto' | number = 'auto';
let frame = 0;
let lastMs = 0;
const stepButtons = new Map<StepId, HTMLButtonElement>();
const stepOf = (p: OkPlan, id: StepId) => p.steps.find((s) => s.id === id)!;
const endMs = (): number => (plan ? plan.runsOutMs ?? plan.touchdownMs : 0);

const autoButton = make('button', 'btn sim-small', 'Auto');
autoButton.type = 'button';
autoButton.dataset.speed = 'auto';
autoButton.addEventListener('click', () => { speed = 'auto'; drawControls(); });
speeds.append(autoButton);
for (const [label, s] of SPEEDS) {
  const b = make('button', 'btn sim-small', label);
  b.type = 'button';
  b.dataset.speed = String(s);
  b.addEventListener('click', () => { speed = s; drawControls(); });   // a manual speed turns Auto off
  speeds.append(b);
}

/** The speed playing now: Auto's for this step, or the chosen one; the burns capped. */
function paceAt(id: StepId): number {
  const base = speed === 'auto' ? AUTO_SPEED[id] : speed;
  return SLOW_STEPS.includes(id) ? Math.min(base, SLOW_SPEED) : base;
}

function drawControls(): void {
  play.textContent = playing ? '❚❚ Pause' : cursor >= endMs() && plan ? '↺ Replay' : '▶ Play';
  for (const b of speeds.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.speed === String(speed)));
  autoButton.textContent = speed === 'auto' && plan ? `Auto · ${rateText(paceAt(plan.steps[missionAt(plan, cursor).stepIndex].id))}` : 'Auto';
}

function drawFrame(): void {
  if (!plan || !picture) return;
  const st = missionAt(plan, cursor);
  const step = plan.steps[st.stepIndex];
  const scale = scaleFor(step.id);
  picture.update(st, scale);
  scaleLabel.textContent = LABELS[scale];

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
  let current: StepId = SEQUENCE[0];
  for (const id of SEQUENCE) if (stepOf(plan, id).startMs <= cursor) current = id;
  for (const [id, b] of stepButtons) {
    if (id === current) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
    b.classList.toggle('sim-done', stepOf(plan, id).startMs < stepOf(plan, current).startMs);
  }
}

function tick(now: number): void {
  frame = 0;
  if (!playing || !plan) return;
  const dt = Math.min(0.25, (now - lastMs) / 1000);
  lastMs = now;
  const step = plan.steps[missionAt(plan, cursor).stepIndex];
  cursor = Math.min(endMs(), cursor + dt * paceAt(step.id) * 1000);
  if (cursor >= endMs()) playing = false;
  drawFrame();
  drawControls();
  if (playing) frame = requestAnimationFrame(tick);
}

function start(): void {
  if (!plan) return;
  if (cursor >= endMs()) cursor = plan.launchMs;
  playing = true;
  lastMs = performance.now();
  frame = requestAnimationFrame(tick);
  drawControls();
}

function stop(): void {
  playing = false;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  drawControls();
}

play.addEventListener('click', () => (playing ? stop() : start()));
scrub.addEventListener('input', () => {
  if (!plan) return;
  cursor = Math.min(endMs(), plan.launchMs + (Number(scrub.value) / 1000) * (plan.touchdownMs - plan.launchMs));
  drawFrame();
  drawControls();
});

function drawChapters(p: OkPlan): void {
  stepButtons.clear();
  chapters.replaceChildren(...SEQUENCE.map((id, i) => {
    const s = stepOf(p, id);
    const b = make('button', 'sim-step');
    b.type = 'button';
    let detail = '';
    if (id === 'launch') { const pad = padById(getState().padId); detail = `${pad.name} · ${pad.pad}`; }
    if (id === 'tli') detail = `Δv ${dvText(s.dvKmS ?? 0)}`;
    if (id === 'loi') detail = `${Math.round(p.orbit.lunarOrbitAltKm)} km orbit · Δv ${dvText(s.dvKmS ?? 0)}`;
    if (id === 'powered-descent') detail = `${kmText(p.orbit.descentStartAltKm)} → surface`;
    if (id === 'touchdown') detail = p.runsOutMs !== null ? 'Not reached: out of propellant' : `${kgText(p.totals.propellantLeftKg)} propellant left`;
    b.append(make('span', 'sim-k', String(i + 1).padStart(2, '0')), make('b', '', NAMES[id]),
      make('span', 'sim-when', dayText(s.startMs)), make('span', 'sim-when', detail));
    b.addEventListener('click', () => {
      cursor = Math.min(endMs(), s.startMs);
      drawFrame();
      drawControls();
    });
    stepButtons.set(id, b);
    return b;
  }));
}

function drawTrip(p: OkPlan): void {
  const s = getState();
  const sc = landingScenario()!;
  const pad = padById(s.padId);
  const siteName = s.sites.find((c) => Math.abs(c.lat - sc.site.lat) < 1e-6 && Math.abs(c.lon - sc.site.lon) < 1e-6)?.name
    ?? `Scenario ${sc.label}`;
  title.textContent = `Launch simulation · ${siteName}`;
  document.title = `Launch simulation · ${siteName} · Darksight`;
  const box = (k: string, name: string, sub: string, when: number, color: string | null): HTMLElement => {
    const d = make('div', 'sim-info');
    const b = make('b', '', name);
    if (color) {
      const dot = make('span', 'sim-dot');
      dot.style.setProperty('--sim-site', `var(${color})`);
      b.prepend(dot);
    }
    d.append(make('span', 'sim-k', k), b, make('span', 'sim-when', sub), make('span', 'sim-when', `${utcText(when)} UTC`));
    return d;
  };
  trips.replaceChildren(
    box('Launch', `${pad.name} · ${pad.pad}`, `${pad.country} · ${coordText(pad.lat, pad.lon)}`, p.launchMs, null),
    box('Touchdown', siteName, coordText(sc.site.lat, sc.site.lon), p.touchdownMs, sc.color),
  );
}

// --- From state ----------------------------------------------------------------------------------
let shownPlan: OkPlan | null = null;
function render(): void {
  back.href = plannerUrl();
  const s = getState();
  const mock = /mock/i.test(s.eph?.meta.source ?? '');
  badge.textContent = `Planning model · not a flight-dynamics solution${mock ? ' · mock data' : ''}`;
  const m = missionFor();
  const p = m.status === 'ready' && m.plan.ok ? m.plan : null;
  if (!p) {
    stop();
    picture?.dispose();
    picture = null;
    plan = null;
    shownPlan = null;
    hud.hidden = true;
    trips.replaceChildren();
    message.hidden = false;
    message.textContent = m.status === 'none'
      ? 'No landing site chosen. Go back to the mission planner and press “Land here” on a scenario card.'
      : m.status === 'loading' ? 'Loading'
      : m.status === 'outside' ? 'This landing time is too near the edge of the Sun and Earth table (1900 to 2100) for the mission.'
      : m.status === 'ready' && !m.plan.ok ? ERRORS[m.plan.error] : 'Loading';
    return;
  }
  if (p === shownPlan) return;
  shownPlan = p;
  stop();
  picture?.dispose();
  plan = p;
  message.hidden = true;
  hud.hidden = false;
  const sc = landingScenario()!;
  picture = createScene(canvasBox, p, padById(s.padId), sc.site, sc.color,
    s.eph ? moonOrbitIcrf(s.eph, p.touchdownMs) : null);
  cursor = p.launchMs;
  drawTrip(p);
  drawChapters(p);
  drawFrame();
  drawControls();
  // "Begin simulation": it starts playing, except under reduced motion, where nothing moves by itself.
  if (!prefersReducedMotion()) start();
}

hud.hidden = true;
subscribe(render);
render();

// --- Data: the Sun and Earth table (the Earth-Moon distance) and the site names ----------------
loadEphemeris().then(
  (eph) => setData({ eph }),
  (err: unknown) => {
    message.textContent = 'The Sun and Earth table did not load, so the mission can’t be planned. Go back and try again.';
    console.warn('Data not loaded (Sun and Earth table):', err instanceof Error ? err.message : err);
  },
);
fetch(import.meta.env.BASE_URL + 'data/sites.json')
  .then((r) => (r.ok ? r.json() : []))
  .then((list: unknown) => { if (Array.isArray(list)) setData({ sites: list as CuratedSite[] }); })
  .catch(() => { /* names fall back to the scenario's label */ });
