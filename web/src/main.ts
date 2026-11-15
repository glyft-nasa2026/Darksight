// Entry point.
// Shows the main page at once, loads the data files, and mounts every module into its slot
// (docs/data-contract.md section 5) after "Start exploring", behind the loading screen. The
// modules are listed in site.ts, run only then: this first script holds just the main page, the
// state and the data loaders, so the main page appears and animates before the module code
// (about 1.8 MB with three.js and Plotly's basic build, 0.55 MB sent) runs. That code is fetched
// without running once the readout's data is in (fetchSiteCode).

import './ui/theme.css';
import './ui/layout.css';

import { loadDem } from './core/dem';
import { loadEphemeris } from './core/ephemeris';
import type { CuratedSite } from './core/types';
import { holdUntilHeightMap } from './loadOrder';
import { sharedGlobe, sharedNorth } from './scene/globeHeights';
import { whenPlotly } from './ui/plotly';
import { failedDecades, setData, subscribe } from './state';
import { failedDecadesText } from './ui/tableGap';
import { startIntro } from './ui/intro/index';
import { mayReload, parseReloadMark, resumeAfterReload, type ReloadMark } from './ui/intro/model';

type Slot = [id: string, mount: (el: HTMLElement) => void];

/** Mounts each module into its slot. Each draws the data state.ts already holds, then follows it. */
function mountSlots(slots: readonly Slot[]): void {
  for (const [id, mount] of slots) {
    const el = document.getElementById(id);
    if (!el) continue;
    try {
      mount(el);
    } catch (err) {
      // One broken module must not blank the others.
      console.error(`#${id} failed to mount`, err);
      el.textContent = `#${id} failed to start`;
    }
  }
}

// --- The site's code -------------------------------------------------------------------------
// Its files, as the build lists them (vite.config.ts); none on the dev server, which serves the
// source as it is asked for.
const siteCode = (document.querySelector<HTMLMetaElement>('meta[name="site-code"]')?.content ?? '')
  .split(' ').filter(Boolean);
const siteCss: HTMLLinkElement[] = [];
let siteRequested = false;

/**
 * Fetches the site's code without running it, once the readout's data is in, so "Start
 * exploring" needn't wait for the download, and a deploy after this page opened (which renames
 * the files) can't break the click. The CSS is held off (media "not all") until loadSite switches
 * it on; Vite's loader then finds every file already in the page.
 */
function fetchSiteCode(): void {
  if (siteRequested) return;   // the click came first and fetched them itself
  for (const file of siteCode) {
    const link = document.createElement('link');
    link.href = new URL(file, document.baseURI).href;
    if (file.endsWith('.css')) {
      link.rel = 'stylesheet';
      link.media = 'not all';
      siteCss.push(link);
    } else {
      link.rel = 'modulepreload';
      link.crossOrigin = '';
    }
    document.head.append(link);
  }
}

// A page opened before a deploy may still fail to load the site's code: it then reloads itself
// once and opens straight on the loading screen (ui/intro/model.ts).
const RELOAD_KEY = 'darksight-reload';
function readReloadMark(): ReloadMark | null {
  try {
    return parseReloadMark(sessionStorage.getItem(RELOAD_KEY));
  } catch {
    return null;
  }
}
function writeReloadMark(mark: ReloadMark): boolean {
  try {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify(mark));
    return true;
  } catch {
    return false;
  }
}
const reloadMark = readReloadMark();
const resumed = resumeAfterReload(reloadMark, Date.now());
if (resumed && reloadMark) writeReloadMark({ ...reloadMark, resumed: true });

/** Reloads the page to fetch the current site. False when it may not (ui/intro/model.ts mayReload). */
function reloadForCurrentCode(): boolean {
  const now = Date.now();
  // Without sessionStorage the page can't tell its own reload from a new visit, so it might loop.
  if (!mayReload(readReloadMark(), now) || !writeReloadMark({ at: now, resumed: false })) return false;
  location.reload();
  return true;
}

// Main page first; after "Start exploring", the loading screen until the site is mounted and the
// Sun and Earth table and the site list are in (at most 10 s for the data; T22 hero.png,
// loading.png). The height map keeps loading behind the site.
const intro = startIntro({
  loadSite: () => {
    siteRequested = true;
    // Plotly (the charts) is a separate file (issue #95). Start it from the click, but only once
    // the Sun and Earth table is in, so on a slow line it doesn't hold up the readout's numbers.
    // fetchSiteCode has usually fetched it by then.
    void ephJob.then(whenPlotly, whenPlotly).catch(() => undefined);
    for (const link of siteCss) link.media = 'all';
    return import('./site').then(({ slots }) => () => mountSlots(slots));
  },
  startNow: resumed,
  onSiteFailed: reloadForCurrentCode,
});

// --- Data loading ---------------------------------------------------------------------------
// State stays null for a file that is missing or malformed, and the page says so. Nothing
// crashes: the modules show "Loading" and the skyline stays flat.

type Progress = 'loading' | 'ok' | 'missing';
const files: Record<'Sun and Earth table' | 'height map' | 'site list', Progress> = {
  'Sun and Earth table': 'loading',
  'height map': 'loading',
  'site list': 'loading',
};
let demFraction = 0;

function showStatus(): void {
  intro.update({
    eph: files['Sun and Earth table'],
    sites: files['site list'],
    dem: files['height map'],
    demFraction,
  });
  writeStatus();
}

/** The status line: the files that did not load, then those still loading. */
function writeStatus(): void {
  const el = document.getElementById('status');
  if (!el) return;
  const names = Object.keys(files) as (keyof typeof files)[];
  const missing: string[] = names.filter((n) => files[n] === 'missing');
  // A decade of the table that failed to download, which state.ts tries again (T33).
  const decades = failedDecadesText(failedDecades());
  if (decades) missing.push(decades);
  const loading = names
    .filter((n) => files[n] === 'loading')
    .map((n) => (n === 'height map' && demFraction > 0 ? `${n} ${Math.round(demFraction * 100)} %` : n));
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Data not loaded: ${missing.join(', ')}.`);
  if (loading.length > 0) parts.push(`Loading ${loading.join(', ')}.`);
  const text = parts.join(' ');
  if (el.textContent !== text) el.textContent = text;
}

async function loadSites(): Promise<CuratedSite[]> {
  const res = await fetch(import.meta.env.BASE_URL + 'data/sites.json');
  if (!res.ok) throw new Error(`sites.json: HTTP ${res.status}`);
  const list: unknown = await res.json().catch(() => {
    throw new Error('sites.json: missing, or not JSON');
  });
  if (!Array.isArray(list)) throw new Error('sites.json: not a list');
  return list as CuratedSite[];
}

function track<T>(name: keyof typeof files, job: Promise<T>, done: (value: T) => void): void {
  job.then(
    (value) => {
      files[name] = 'ok';
      done(value);
      showStatus();
    },
    (err: unknown) => {
      files[name] = 'missing';
      // A warning, not an error: the page keeps working without the file.
      console.warn(`Data not loaded (${name}):`, err instanceof Error ? err.message : err);
      showStatus();
    },
  );
}

showStatus();
// A decade failing or arriving changes the line too; the check above keeps a drag from rewriting it.
subscribe(writeStatus);
const ephJob = loadEphemeris();
track('Sun and Earth table', ephJob, (eph) => setData({ eph }));
const sitesJob = loadSites();
track('site list', sitesJob, (sites) => setData({ sites }));
// The site's code, once the readout's data is in or failed: it never holds that up.
void Promise.allSettled([ephJob, sitesJob]).then(fetchSiteCode);
// The height map (12.85 MB) waits for the Sun and Earth table (its first decade, 0.70 MB), loaded
// or failed, rather than share the connection: the readout's numbers need only the table, and
// arrive about a second sooner on a slow line (issue #95).
const demJob = ephJob.then(() => undefined, () => undefined).then(() => loadDem((fraction) => {
  demFraction = fraction;
  showStatus();
}));
// The whole-Moon picture files wait for it rather than share the connection (issue #96).
holdUntilHeightMap(demJob);
track('height map', demJob, (dem) => setData({ dem }));
// T37: globe.bin, the skyline for sites north of 85 S, and north.bin, the finer one north of 80 N.
// The same downloads as the map's and the 3D globe's (sharedGlobe, sharedNorth), after the height
// map (issue #96). Both go into the state in one change, so each card redraws once. globe is null
// when it fails or is missing; without north.bin the northern sites use globe.bin.
Promise.all([sharedGlobe(), sharedNorth().catch(() => null)])
  .then(([globe, north]) => setData({ globe, north }), () => setData({ globe: null }));
