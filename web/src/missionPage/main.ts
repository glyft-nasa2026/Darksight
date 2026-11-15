// The mission planner page (T34): the mission card on a page of its own. "Open mission" in the
// Scenarios panel (beside "Copy share link", once a landing point is chosen) opens it with the same page address, which state.ts reads, so it plans
// the mission to the same landing point, pad and lander. It loads the same data files as the
// site (the skyline needs the height map for the landing window's numbers) and mounts
// ui/mission into #mission. "Back to landing sites" returns to the site.
import '../ui/theme.css';
import './missionPage.css';
import { loadDem } from '../core/dem';
import { loadEphemeris } from '../core/ephemeris';
import { holdUntilHeightMap } from '../loadOrder';
import { sharedGlobe } from '../scene/globeHeights';
import type { CuratedSite } from '../core/types';
import { failedDecades, setData, stateToAddress, subscribe } from '../state';
import { mount } from '../ui/mission/index';
import { failedDecadesText } from '../ui/tableGap';

const status = document.getElementById('mp-status') as HTMLElement;
const back = document.querySelector<HTMLAnchorElement>('.mp-back')!;

// --- Back to the site ------------------------------------------------------------------------
const siteUrl = (): string => `index.html#${stateToAddress()}`;
back.href = siteUrl();
back.addEventListener('focus', () => { back.href = siteUrl(); });
back.addEventListener('mouseenter', () => { back.href = siteUrl(); });
back.addEventListener('click', (e) => {
  // Opened in a new tab by the site: the site is still open in its own tab, as it was left.
  // Close this one, which returns there; if the browser won't, follow the link.
  let site: Window | null = null;
  try { site = window.opener && !window.opener.closed ? window.opener : null; } catch { site = null; }
  if (site) {
    e.preventDefault();
    try { site.focus(); } catch { /* not allowed everywhere; closing still shows it */ }
    window.close();
    setTimeout(() => { if (!window.closed) location.assign(siteUrl()); }, 300);
    return;
  }
  back.href = siteUrl();
});

// --- The card --------------------------------------------------------------------------------
const slot = document.getElementById('mission');
if (slot) {
  try {
    mount(slot);
  } catch (err) {
    console.error('#mission failed to mount', err);
    slot.textContent = '#mission failed to start';
  }
}

// --- Data ------------------------------------------------------------------------------------
// The same files as the site. State stays null for one that doesn't load, and the card says
// "Loading" or what it can't work out; nothing crashes.
const files = { 'Sun and Earth table': 'loading', 'height map': 'loading', 'site list': 'loading' } as
  Record<string, 'loading' | 'ok' | 'missing'>;
let demFraction = 0;
function showStatus(): void {
  const missing = Object.keys(files).filter((n) => files[n] === 'missing');
  // A decade of the table that failed to download, which state.ts tries again (T33).
  const decades = failedDecadesText(failedDecades());
  if (decades) missing.push(decades);
  const loading = Object.keys(files).filter((n) => files[n] === 'loading')
    .map((n) => (n === 'height map' && demFraction > 0 ? `${n} ${Math.round(demFraction * 100)} %` : n));
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Data not loaded: ${missing.join(', ')}.`);
  if (loading.length > 0) parts.push(`Loading ${loading.join(', ')}.`);
  const text = parts.join(' ');
  if (status.textContent !== text) status.textContent = text;
}
function track<T>(name: string, job: Promise<T>, done: (value: T) => void): void {
  job.then(
    (value) => { files[name] = 'ok'; done(value); showStatus(); },
    (err: unknown) => {
      files[name] = 'missing';
      console.warn(`Data not loaded (${name}):`, err instanceof Error ? err.message : err);
      showStatus();
    },
  );
}
showStatus();
subscribe(showStatus);   // a decade failing or arriving changes the line too
track('Sun and Earth table', loadEphemeris(), (eph) => setData({ eph }));
track('site list',
  fetch(import.meta.env.BASE_URL + 'data/sites.json').then((r) => {
    if (!r.ok) throw new Error(`sites.json: HTTP ${r.status}`);
    return r.json() as Promise<unknown>;
  }).then((list) => {
    if (!Array.isArray(list)) throw new Error('sites.json: not a list');
    return list as CuratedSite[];
  }),
  (sites) => setData({ sites }));
const demJob = loadDem((f) => { demFraction = f; showStatus(); });
track('height map', demJob, (dem) => setData({ dem }));
// T37: globe.bin, the coarse skyline for sites north of 85 S, as on the site: after the height map
// (issue #96), and null when it fails or is missing.
holdUntilHeightMap(demJob);
sharedGlobe().then((globe) => setData({ globe }), () => setData({ globe: null }));
