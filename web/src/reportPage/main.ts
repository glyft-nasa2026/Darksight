// The mission report page (T35): the report on a page of its own, so it prints alone. Opened by
// "Generate full launch schedule" on the mission card with the same page address, which state.ts
// reads, so missionFor() plans the same mission. It loads the same data files as the mission page
// (the landing site's numbers need the height map). The downloads are made here from a Blob.
import '../ui/theme.css';
import './reportPage.css';
import { loadDem } from '../core/dem';
import { loadEphemeris } from '../core/ephemeris';
import { holdUntilHeightMap } from '../loadOrder';
import { sharedGlobe, sharedNorth } from '../scene/globeHeights';
import type { Report } from '../core/report';
import type { CuratedSite } from '../core/types';
import { setData, stateToAddress } from '../state';
import { downloads, mount } from '../ui/report/index';

const status = document.getElementById('rpp-status') as HTMLElement;
const back = document.querySelector<HTMLAnchorElement>('.rpp-back')!;
const printButton = document.getElementById('rpp-print') as HTMLButtonElement;
const jsonButton = document.getElementById('rpp-json') as HTMLButtonElement;
const csvButton = document.getElementById('rpp-csv') as HTMLButtonElement;

// --- Back to the mission ---------------------------------------------------------------------
const missionUrl = (): string => `mission.html#${stateToAddress()}`;
back.href = missionUrl();
back.addEventListener('click', (e) => {
  // Opened in a new tab by the mission card: that tab is still open. Close this one.
  let opener: Window | null = null;
  try { opener = window.opener && !window.opener.closed ? window.opener : null; } catch { opener = null; }
  if (opener) {
    e.preventDefault();
    try { opener.focus(); } catch { /* not allowed everywhere */ }
    window.close();
    setTimeout(() => { if (!window.closed) location.assign(missionUrl()); }, 300);
    return;
  }
  back.href = missionUrl();
});

// --- Print and the downloads -----------------------------------------------------------------
let current: Report | null = null;
printButton.addEventListener('click', () => window.print());
jsonButton.addEventListener('click', () => { if (current) downloads(current).json(); });
csvButton.addEventListener('click', () => { if (current) downloads(current).csv(); });

const slot = document.getElementById('report');
if (slot) {
  slot.addEventListener('report-ready', (e) => {
    current = (e as CustomEvent<Report | null>).detail;
    for (const b of [printButton, jsonButton, csvButton]) b.disabled = !current;
  });
  try {
    mount(slot);
  } catch (err) {
    console.error('#report failed to mount', err);
    slot.textContent = '#report failed to start';
  }
}

// --- Data ------------------------------------------------------------------------------------
// The same files as the mission page. State stays null for one that doesn't load; the report
// says "Loading" or why it can't be made, and nothing crashes.
const files = { 'Sun and Earth table': 'loading', 'height map': 'loading', 'site list': 'loading' } as
  Record<string, 'loading' | 'ok' | 'missing'>;
let demFraction = 0;
function showStatus(): void {
  const missing = Object.keys(files).filter((n) => files[n] === 'missing');
  const loading = Object.keys(files).filter((n) => files[n] === 'loading')
    .map((n) => (n === 'height map' && demFraction > 0 ? `${n} ${Math.round(demFraction * 100)} %` : n));
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Data not loaded: ${missing.join(', ')}.`);
  if (loading.length > 0) parts.push(`Loading ${loading.join(', ')}.`);
  status.textContent = parts.join(' ');
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
// T37: globe.bin (the skyline north of 85 S) and north.bin (the finer one north of 80 N), as on the
// site: after the height map (issue #96), in one change of state. globe is null when it fails or
// is missing; without north.bin the northern sites use globe.bin.
holdUntilHeightMap(demJob);
Promise.all([sharedGlobe(), sharedNorth().catch(() => null)])
  .then(([globe, north]) => setData({ globe, north }), () => setData({ globe: null }));
