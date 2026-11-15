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
import { noRowText } from '../ui/tableGap';
import { prefersReducedMotion } from '../ui/launch/earth';
import {
  coordText, dayText, durationText, dvText, elapsedText, kgText, kmText, speedText, utcText,
} from '../ui/mission/format';
import { MANOEUVRE_WINDOW_S, nextPace, paceLimit, rateText, regions, type Mode } from '../ui/mission/pace';
import { createScene, scaleFor, type MissionScene, type Scale } from './scene';

const NAMES: Record<StepId, string> = {
  launch: 'Launch', parking: 'Parking orbit', tli: 'Translunar injection', coast: 'Translunar coast',
  loi: 'Lunar orbit insertion', 'lunar-orbit': 'Lunar orbit', doi: 'Descent orbit insertion',
  'descent-orbit': 'Descent orbit', 'powered-descent': 'Powered descent', touchdown: 'Touchdown',
};
const LABELS: Record<Scale, string> = {
  near: 'EARTH · ASCENT AND PARKING ORBIT',
  earth: 'EARTH AND MOON · PLANE OF THE TRANSFER',
  moon: 'MOON · ARRIVAL AND LUNAR ORBIT, THE SITE MARKED',
  descent: 'POWERED DESCENT TO THE SITE',
};
const ERRORS = {
  'bad-input': 'The lander’s numbers are not valid. Go back to the mission planner to fix them.',
  'coast-out-of-range': 'No transfer reaches the Moon in that coast time.',
  'thrust-too-low': 'This lander’s engine is too weak to stop before the ground. Go back and give it more thrust.',
} as const;

// Simulated seconds per real second (pace.ts, issue #105). "Auto" (the default) picks one per
// stage; every change of speed is gradual, and slows down in time for each burn.
const SPEEDS: [label: string, s: number][] = [['1 min/s', 60], ['1 h/s', 3600], ['6 h/s', 6 * 3600]];
/** An instant burn (TLI, LOI, DOI) shows as firing for this long either side of its moment. */
const FIRING_S = 120;

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
// What the craft is doing now, in words: how it reaches the right orbit before landing.
const caption = make('p', 'sim-caption');
caption.setAttribute('aria-live', 'polite');
stage.append(canvasBox, scaleLabel, trips, caption, message);

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
const plannerUrl = (): string => `mission.html#${stateToAddress()}`;
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
let speed: Mode = 'auto';
let pace = 3600;                                   // the speed playing now, easing toward the limit
let limits: ReturnType<typeof regions> = [];
const setSpeed = (m: Mode): void => { speed = m; if (plan) limits = regions(plan, m); drawControls(); };
const settlePace = (): void => { if (plan) pace = paceLimit(limits, cursor); };
let frame = 0;
let lastMs = 0;
const stepButtons = new Map<StepId, HTMLButtonElement>();
const stepOf = (p: OkPlan, id: StepId) => p.steps.find((s) => s.id === id)!;
const endMs = (): number => (plan ? plan.runsOutMs ?? plan.touchdownMs : 0);

const autoButton = make('button', 'btn sim-small', 'Auto');
autoButton.type = 'button';
autoButton.dataset.speed = 'auto';
autoButton.addEventListener('click', () => setSpeed('auto'));
speeds.append(autoButton);
const rateNow = make('span', 'sim-rate');
for (const [label, s] of SPEEDS) {
  const b = make('button', 'btn sim-small', label);
  b.type = 'button';
  b.dataset.speed = String(s);
  b.addEventListener('click', () => setSpeed(s));   // a manual speed turns Auto off; the change glides
  speeds.append(b);
}

controls.insertBefore(rateNow, scrub);

function drawControls(): void {
  play.textContent = playing ? '❚❚ Pause' : cursor >= endMs() && plan ? '↺ Replay' : '▶ Play';
  for (const b of speeds.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.speed === String(speed)));
  autoButton.textContent = speed === 'auto' && plan ? `Auto · ${rateText(pace)}` : 'Auto';
  // A manual speed: say what is playing while it glides, or while a burn holds it slower.
  rateNow.textContent = speed !== 'auto' && plan && Math.abs(Math.log(pace / speed)) > 0.01 ? `now ${rateText(pace)}` : '';
}

/** The engine is firing: the ascent, the powered descent, or close to an instant burn. */
function firing(p: OkPlan, id: StepId, t: number): boolean {
  if (id === 'launch' || id === 'powered-descent') return t < p.touchdownMs;
  return (['tli', 'loi', 'doi'] as StepId[]).some((b) => Math.abs(t - stepOf(p, b).startMs) <= FIRING_S * 1000);
}

/** What the craft is doing, and how it gets into the orbit it needs, with the plan's numbers. */
function captionFor(p: OkPlan, id: StepId, st: ReturnType<typeof missionAt>): string {
  const near = (b: StepId): boolean => Math.abs(cursor - stepOf(p, b).startMs) <= MANOEUVRE_WINDOW_S * 1000;
  const o = p.orbit;
  const lunar = `${Math.round(o.lunarOrbitAltKm)} km`;
  if (near('tli')) {
    return `Translunar injection: a ${dvText(stepOf(p, 'tli').dvKmS ?? 0)} burn stretches the parking orbit into a long ellipse that reaches the Moon’s distance.`;
  }
  if (near('loi')) {
    return `Lunar orbit insertion: at the closest point of the fly-by, a ${dvText(stepOf(p, 'loi').dvKmS ?? 0)} braking burn slows the craft enough for the Moon to capture it, in a ${lunar} circular orbit inclined ${o.lunarOrbitIncDeg.toFixed(0)}°, the plane the arrival leads into.`;
  }
  if (near('doi')) {
    return `Descent orbit insertion: a ${dvText(stepOf(p, 'doi').dvKmS ?? 0)} burn lowers the far side of the orbit to ${kmText(o.descentStartAltKm)} above the ground, just before the landing site.`;
  }
  switch (id) {
    case 'launch': return `Liftoff: the launch vehicle climbs to a ${Math.round(o.parkingAltKm)} km parking orbit.`;
    case 'parking': return `Parking orbit at ${Math.round(o.parkingAltKm)} km, coasting round Earth to the point where translunar injection starts.`;
    case 'coast':
      return st.approach
        ? `Arriving at the Moon: inside its sphere of influence the craft falls in on a hyperbola, ${speedText(o.vInfKmS)} faster than the Moon, aimed to pass ${lunar} above it. Without a burn it would fly past.`
        : `Coasting to the Moon for ${durationText(o.coastS)}, slowing as it climbs away from Earth.`;
    case 'loi':
    case 'lunar-orbit':
      return `In a ${lunar} orbit inclined ${o.lunarOrbitIncDeg.toFixed(0)}°, ${durationText(o.lunarOrbitPeriodS)} a lap. The Moon turns underneath until the landing site comes under the track.`;
    case 'doi':
    case 'descent-orbit':
      return `On the descent orbit: coasting down from ${lunar} to ${kmText(o.descentStartAltKm)}, where the powered descent begins.`;
    case 'powered-descent':
      return `Powered descent: the engine brakes the craft from orbital speed to a stop on the site. Now ${speedText(st.speedKmS)}, ${kmText(st.rangeToGoKm ?? 0)} to go.`;
    case 'touchdown':
      return p.runsOutMs !== null ? 'Out of propellant before the ground: touchdown not reached.' : `Touchdown, with ${kgText(p.totals.propellantLeftKg)} of propellant left.`;
    default: return '';
  }
}

function drawFrame(): void {
  if (!plan || !picture) return;
  const st = missionAt(plan, cursor);
  const step = plan.steps[st.stepIndex];
  const scale = scaleFor(step.id, st);
  picture.update(st, scale, firing(plan, step.id, cursor));
  scaleLabel.textContent = LABELS[scale];
  const words = captionFor(plan, step.id, st);
  if (caption.textContent !== words) caption.textContent = words;

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
  pace = nextPace(pace, paceLimit(limits, cursor), dt);
  cursor = Math.min(endMs(), cursor + dt * pace * 1000);
  if (cursor >= endMs()) playing = false;
  drawFrame();
  drawControls();
  if (playing) frame = requestAnimationFrame(tick);
}

function start(): void {
  if (!plan) return;
  if (cursor >= endMs()) { cursor = plan.launchMs; settlePace(); }
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
  settlePace();   // a jump in time starts at that moment's speed
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
      settlePace();
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
      : m.status === 'failed' ? noRowText('failed', m.decadeMs)
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
  limits = regions(p, speed);
  settlePace();
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
