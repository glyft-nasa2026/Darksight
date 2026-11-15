// App state, as docs/data-contract.md section 4.
// UI modules read state and call actions. They never call each other.

import type { Dem } from './core/dem';
import { loadEphemerisChunk, type Ephemeris } from './core/ephemeris';
import { sunAltAzAtSite } from './core/geometry';
import { skylineAt, skylineElev } from './core/horizon';
import {
  APOLLO_11_TIMES, earthMoonKmAt, EXAMPLE_LANDER, planMission, type Lander, type MissionPlan,
} from './core/mission';
import { DEFAULT_PAD_ID, padById } from './core/pads';
import type { Body, CuratedSite, Flip, Sample, Site, Skyline, Summary } from './core/types';
import { nextFlip, series, summary, SUN_RADIUS } from './core/windows';

export type Scenario = { id: string; label: string; color: string; site: Site; tMs: number };
// color is the name of a theme variable, for example '--scn-a'. Never a colour code.
export type Range = '30d' | '90d' | '365d';
export type AppState = {
  live: Scenario; pinned: Scenario[]; ghost: Scenario | null;
  selectedId: string; range: Range; mode: '2d' | '3d';
  windowStartMs: number;                 // left edge of the timeline for the live scenario
  // eph is null until the table has loaded, and again while a decade that the live or a pinned
  // scenario needs is still downloading, so every module shows "Loading" by itself.
  eph: Ephemeris | null; dem: Dem | null; sites: CuratedSite[];
  // The mission (T34): where it lands (a copy of a scenario's site and time, so it stays put
  // while the scenarios change), from which launch pad, with which lander.
  landing: { site: Site; tMs: number } | null;
  padId: string;
  lander: Lander;
};

export const LIVE_ID = 'live';
/** The three pin slots (F5). A scenario keeps its slot's colour until it is unpinned. */
export const PIN_SLOTS: readonly { id: string; label: string; color: string }[] = [
  { id: 'a', label: 'A', color: '--scn-a' },
  { id: 'b', label: 'B', color: '--scn-b' },
  { id: 'c', label: 'C', color: '--scn-c' },
];
export const MAX_PINNED = PIN_SLOTS.length;
/** The id landingScenario() gives the mission's landing point. */
export const LANDING_ID = 'land';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Range, number> = { '30d': 30, '90d': 90, '365d': 365 };
const rangeMs = (r: Range): number => RANGE_DAYS[r] * DAY_MS;

// Where the live scenario sits when the address names none, until the first-open example
// replaces it: near the south pole, where the terrain skyline applies. The time is the current hour.
const DEFAULT_SITE: Site = { lat: -89.5, lon: 0 };

// The first-open example (F19): live at the rim, the floor pinned as A. Real ids first, then mock.
const EXAMPLE_PAIRS: readonly { rim: string; floor: string }[] = [
  { rim: 'shackleton-rim', floor: 'shackleton-floor' },
  { rim: 'mock-rim', floor: 'mock-floor' },
];

// ---------------------------------------------------------------------------------------------
// The page address (F17). Everything a shared link must reopen is kept after the '#':
//   #live=-89.5,0,2026-11-14T10:00:00Z&a=-88,45,2027-01-01T00:00:00Z&sel=a&range=90d&mode=3d
// A scenario is lat,lon,time and, only if it was set, eye height in metres. The mission (T34)
// adds land= (the same form), pad=<id> and lander=mass,dry,isp,thrust, each only when set.
// ---------------------------------------------------------------------------------------------

const round6 = (v: number): number => Number(v.toFixed(6));
const wrapLon = (lon: number): number => {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
};
const validSite = (s: Site): boolean =>
  Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat >= -90 && s.lat <= 90;

// Coordinates are kept to 6 decimal places (3 cm on the Moon), so the address stays short and
// a scenario restored from it is identical to the one that was saved.
function cleanSite(s: Site): Site {
  const out: Site = { lat: round6(s.lat), lon: round6(wrapLon(s.lon)) };
  if (s.eye_m !== undefined && Number.isFinite(s.eye_m)) out.eye_m = s.eye_m;
  return out;
}

function scenarioToText(sc: { site: Site; tMs: number }): string {
  const iso = new Date(sc.tMs).toISOString().replace('.000Z', 'Z');
  const parts = [String(sc.site.lat), String(sc.site.lon), iso];
  if (sc.site.eye_m !== undefined) parts.push(String(sc.site.eye_m));
  return parts.join(',');
}

function textToSiteTime(text: string | null): { site: Site; tMs: number } | null {
  if (!text) return null;
  const parts = text.split(',');
  if (parts.length < 3 || parts.length > 4) return null;
  const site: Site = { lat: Number(parts[0]), lon: Number(parts[1]) };
  const tMs = Date.parse(parts[2]);
  if (parts[0].trim() === '' || parts[1].trim() === '') return null;
  if (!validSite(site) || !Number.isFinite(tMs)) return null;
  if (parts.length === 4) {
    const eye = Number(parts[3]);
    if (parts[3].trim() === '' || !Number.isFinite(eye)) return null;
    site.eye_m = eye;
  }
  return { site: cleanSite(site), tMs };
}

/** A lander the model can fly: positive numbers, more mass than dry mass. */
function validLander(l: Lander): boolean {
  return [l.massKg, l.dryKg, l.ispS, l.thrustN].every((v) => Number.isFinite(v) && v > 0) && l.massKg > l.dryKg;
}

function textToLander(text: string | null): Lander | null {
  if (!text) return null;
  const parts = text.split(',');
  if (parts.length !== 4 || parts.some((x) => x.trim() === '')) return null;
  const [massKg, dryKg, ispS, thrustN] = parts.map(Number);
  const l: Lander = { massKg, dryKg, ispS, thrustN };
  return validLander(l) ? l : null;
}

const sameLander = (a: Lander, b: Lander): boolean =>
  a.massKg === b.massKg && a.dryKg === b.dryKg && a.ispS === b.ispS && a.thrustN === b.thrustN;

/** The state an address describes, and whether it names any scenario (live or pinned). */
function stateFromAddress(hash: string, nowMs: number): { next: AppState; named: boolean } {
  const q = new URLSearchParams(hash.replace(/^#/, ''));

  const liveAt = textToSiteTime(q.get('live'));
  const live: Scenario = {
    id: LIVE_ID, label: 'Live', color: '--accent',
    site: liveAt?.site ?? { ...DEFAULT_SITE },
    tMs: liveAt?.tMs ?? Math.floor(nowMs / HOUR_MS) * HOUR_MS,
  };

  const pinned: Scenario[] = [];
  for (const slot of PIN_SLOTS) {
    const at = textToSiteTime(q.get(slot.id));
    if (at) pinned.push({ ...slot, site: at.site, tMs: at.tMs });
  }

  const sel = q.get('sel');
  const range = q.get('range');
  const next: AppState = {
    live, pinned, ghost: null,
    selectedId: pinned.some((p) => p.id === sel) ? (sel as string) : LIVE_ID,
    range: range === '90d' || range === '365d' ? range : '30d',
    mode: q.get('mode') === '3d' ? '3d' : '2d',
    windowStartMs: live.tMs,
    eph: null, dem: null, sites: [],
    landing: textToSiteTime(q.get('land')),
    padId: padById(q.get('pad')).id,
    lander: textToLander(q.get('lander')) ?? { ...EXAMPLE_LANDER },
  };
  return { next, named: liveAt !== null || pinned.length > 0 };
}

/**
 * The part of the page address after '#' that reopens the current scenarios. The page keeps
 * the address up to date by itself; T08's share button only needs to copy location.href.
 */
export function stateToAddress(): string {
  const parts = [`live=${scenarioToText(state.live)}`];
  for (const p of state.pinned) parts.push(`${p.id}=${scenarioToText(p)}`);
  if (state.selectedId !== LIVE_ID) parts.push(`sel=${state.selectedId}`);
  if (state.range !== '30d') parts.push(`range=${state.range}`);
  if (state.mode !== '2d') parts.push(`mode=${state.mode}`);
  if (state.landing) parts.push(`land=${scenarioToText(state.landing)}`);
  if (state.padId !== DEFAULT_PAD_ID) parts.push(`pad=${state.padId}`);
  if (!sameLander(state.lander, EXAMPLE_LANDER)) {
    const l = state.lander;
    parts.push(`lander=${l.massKg},${l.dryKg},${l.ispS},${l.thrustN}`);
  }
  return parts.join('&');
}

/**
 * Rebuilds the scenarios from a page address (with or without the leading '#'). Loaded data
 * is kept. Parts of the address that don't parse are ignored. Called once on load; also by
 * tests, and when someone pastes a link into a tab that is already open.
 */
export function restoreFromAddress(hash: string, nowMs: number = Date.now()): void {
  const { next, named } = stateFromAddress(hash, nowMs);
  exampleWanted = !named;
  if (state) {
    next.eph = state.eph;
    next.dem = state.dem;
    next.sites = state.sites;
  }
  state = next;
  notify(false);
}

// ---------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------

const hasPage = typeof window !== 'undefined' && typeof history !== 'undefined';

const opened = stateFromAddress(hasPage ? window.location.hash : '', Date.now());
let state: AppState = opened.next;
// First open (F19): true while the address named no scenario and nothing has been edited or
// pinned since. The example is built when the site list arrives, at most once.
let exampleWanted = !opened.named;
const listeners = new Set<(s: AppState) => void>();

let addressTimer: ReturnType<typeof setTimeout> | undefined;

function writeAddress(): void {
  addressTimer = undefined;
  try {
    history.replaceState(null, '', '#' + stateToAddress());
  } catch {
    // Some browsers limit how often the address may change. The next change writes it again.
  }
}

function notify(saveAddress = true): void {
  refreshEph();
  if (saveAddress && hasPage) {
    // One write a short moment after the last change, not one per step of a drag.
    if (addressTimer !== undefined) clearTimeout(addressTimer);
    addressTimer = setTimeout(writeAddress, 150);
  }
  for (const fn of [...listeners]) fn(state);
}

if (hasPage) {
  // Fires when the address is edited or a link is pasted, not for our own replaceState calls.
  window.addEventListener('hashchange', () => restoreFromAddress(window.location.hash));
  // Don't lose the last change if the page is closed within the short delay above.
  window.addEventListener('pagehide', () => {
    if (addressTimer !== undefined) {
      clearTimeout(addressTimer);
      writeAddress();
    }
  });
}

export function getState(): AppState {
  return state;
}

/** Calls fn after every change. Returns the function that stops it. */
export function subscribe(fn: (s: AppState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called by main.ts as each data file arrives. Not for UI modules. */
export function setData(patch: { eph?: Ephemeris | null; dem?: Dem | null; sites?: CuratedSite[] }): void {
  if ('eph' in patch) {
    table = patch.eph ?? null;
    pending.clear();
    failed.clear();
  }
  const { eph: _ignored, ...rest } = patch;
  state = { ...state, ...rest };
  const example = 'sites' in patch && exampleWanted && addExample();
  clearCaches();
  notify(example);   // the example goes into the address, like any other change
}

/**
 * Live at the crater rim, the crater floor pinned as A, both at the live scenario's time (the
 * current hour), live selected. False, and nothing changed, when the list has neither pair of ids.
 */
function addExample(): boolean {
  const find = (id: string): Site | null => {
    const s = state.sites.find((c) => c?.id === id);
    if (!s) return null;
    const site: Site = { lat: s.lat, lon: s.lon };
    return validSite(site) ? cleanSite(site) : null;
  };
  for (const pair of EXAMPLE_PAIRS) {
    const rim = find(pair.rim);
    const floor = find(pair.floor);
    if (!rim || !floor) continue;
    exampleWanted = false;
    state = {
      ...state,
      live: { ...state.live, site: rim },
      pinned: [{ ...PIN_SLOTS[0], site: floor, tMs: state.live.tMs }],
      selectedId: LIVE_ID,
    };
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Decades of the Sun and Earth table (core/ephemeris.ts). main.ts hands over the table with its
// home decade (the 2020s) loaded; any other decade is fetched here the first time a scenario
// needs it. A decade that fails to download is not asked for again; its times then read as
// outside the table.
// ---------------------------------------------------------------------------------------------

let table: Ephemeris | null = null;   // every decade loaded so far
const pending = new Set<number>();
const failed = new Set<number>();
const FLIP_DAYS = 60;                 // nextFlip's default look-ahead

/**
 * True when every decade from fromMs to toMs is in memory; asks for the ones that aren't.
 * settled: also true when the only ones missing failed to download, since waiting won't help.
 */
function covered(fromMs: number, toMs: number, settled = false): boolean {
  if (!table) return false;
  const need = table.missing(fromMs, toMs);
  for (const i of need) if (!failed.has(i)) fetchChunk(i);
  return settled ? need.every((i) => failed.has(i)) : need.length === 0;
}

/**
 * How far the table can be read from fromMs towards toMs. toMs when every decade on the way is
 * in memory. The start of the first decade that failed to download when one is in the way: its
 * times read as outside the table, so the days before it are still good. Null while a decade
 * on the way is downloading, or when fromMs itself is in a failed one. Asks for the decades
 * not asked for yet.
 */
function readableTo(fromMs: number, toMs: number): number | null {
  if (!table) return null;
  const need = table.missing(fromMs, toMs);
  let end = toMs;
  for (const i of need) {
    if (failed.has(i)) end = Math.min(end, Date.parse(table.meta.chunks?.[i]?.start ?? table.meta.start));
    else fetchChunk(i);
  }
  if (!(end > fromMs)) return null;
  // Anything still missing before `end` is on its way; a decade past it no longer matters.
  return table.missing(fromMs, end).some((i) => !failed.has(i)) ? null : end;
}

function fetchChunk(i: number): void {
  if (!table || pending.has(i)) return;
  pending.add(i);
  const asked = table;
  loadEphemerisChunk(asked, i).then(
    (buffer) => {
      if (table?.meta !== asked.meta || !pending.delete(i)) return; // a new table came meanwhile
      table = table.withChunk(i, buffer);   // the loader has checked the length: this can't throw
      notify(false);
    },
    (err: unknown) => {
      if (table?.meta !== asked.meta || !pending.delete(i)) return;
      failed.add(i);
      console.warn(`Data not loaded (Sun and Earth table, decade ${i}):`, err instanceof Error ? err.message : err);
      notify(false);
    },
  );
}

/** What each scenario on screen reads: its own hours, its countdowns and the timeline. */
function scenariosCovered(): boolean {
  const s = state;
  const range = rangeMs(s.range);
  let ok = covered(s.live.tMs, s.live.tMs + FLIP_DAYS * DAY_MS, true);
  ok = covered(s.windowStartMs, s.windowStartMs + range, true) && ok;
  for (const p of s.pinned) ok = covered(p.tMs, p.tMs + Math.max(FLIP_DAYS * DAY_MS, range), true) && ok;
  return ok;
}

function refreshEph(): void {
  const eph = table && scenariosCovered() ? table : null;
  if (eph !== state.eph) state = { ...state, eph };
}

/** Moves the live scenario and selects it. Ignores a latitude outside -90..90 or a non-number. */
export function setLiveSite(site: Site): void {
  if (!validSite(site)) return;
  exampleWanted = false;
  state = { ...state, live: { ...state.live, site: cleanSite(site) }, selectedId: LIVE_ID };
  notify();
}

/**
 * Sets the live scenario's time and selects it. The timeline window stays put while the new
 * time is inside it, and restarts at the new time otherwise.
 */
export function setLiveTime(tMs: number): void {
  if (!Number.isFinite(tMs)) return;
  exampleWanted = false;
  const inside = tMs >= state.windowStartMs && tMs <= state.windowStartMs + rangeMs(state.range);
  state = {
    ...state,
    live: { ...state.live, tMs },
    selectedId: LIVE_ID,
    windowStartMs: inside ? state.windowStartMs : tMs,
  };
  notify();
}

/** Copies the live scenario into the first free slot (A, B, C). Does nothing when all are used. */
export function pin(): void {
  const slot = PIN_SLOTS.find((s) => !state.pinned.some((p) => p.id === s.id));
  if (!slot) return;
  exampleWanted = false;
  const copy: Scenario = { ...slot, site: { ...state.live.site }, tMs: state.live.tMs };
  const order = (sc: Scenario): number => PIN_SLOTS.findIndex((s) => s.id === sc.id);
  const pinned = [...state.pinned, copy].sort((x, y) => order(x) - order(y));
  state = { ...state, pinned };
  notify();
}

export function unpin(id: string): void {
  if (!state.pinned.some((p) => p.id === id)) return;
  state = {
    ...state,
    pinned: state.pinned.filter((p) => p.id !== id),
    selectedId: state.selectedId === id ? LIVE_ID : state.selectedId,
  };
  notify();
}

export function select(id: string): void {
  if (id !== LIVE_ID && !state.pinned.some((p) => p.id === id)) return;
  if (id === state.selectedId) return;
  state = { ...state, selectedId: id };
  notify();
}

/** Changes the timeline length. The window restarts at the live time if that would fall outside. */
export function setRange(r: Range): void {
  if (r === state.range) return;
  const t = state.live.tMs;
  const inside = t >= state.windowStartMs && t <= state.windowStartMs + rangeMs(r);
  state = { ...state, range: r, windowStartMs: inside ? state.windowStartMs : t };
  notify();
}

/** Moves the live timeline window earlier (-1) or later (1) by half the range. */
export function shiftWindow(dir: -1 | 1): void {
  state = { ...state, windowStartMs: state.windowStartMs + (dir * rangeMs(state.range)) / 2 };
  notify(false);
}

export function setGhost(s: Scenario | null): void {
  state = { ...state, ghost: s };
  notify(false);
}

export function setMode(m: '2d' | '3d'): void {
  if (m === state.mode) return;
  state = { ...state, mode: m };
  notify();
}

/**
 * Copies a scenario's site and time as the mission's landing point (T34). A copy: editing the
 * live scenario afterwards leaves it where it was. Null clears it.
 */
export function setLanding(sc: Scenario | null): void {
  if (sc && (!validSite(sc.site) || !Number.isFinite(sc.tMs))) return;
  state = { ...state, landing: sc ? { site: cleanSite(sc.site), tMs: sc.tMs } : null };
  notify();
}

/** The mission's launch pad, by id (core/pads.ts). Ignores an unknown id. */
export function setPad(id: string): void {
  if (padById(id).id !== id || id === state.padId) return;
  state = { ...state, padId: id };
  notify();
}

/** The mission's lander. Ignores one the model can't fly (a number not above 0, or dry >= mass). */
export function setLander(l: Lander): void {
  if (!validLander(l) || sameLander(l, state.lander)) return;
  state = { ...state, lander: { ...l } };
  notify();
}

/** The live or pinned scenario named by selectedId. */
export function selected(): Scenario {
  return state.pinned.find((p) => p.id === state.selectedId) ?? state.live;
}

// ---------------------------------------------------------------------------------------------
// Computed once and cached here, so modules don't repeat the work.
// While eph is null: empty arrays, null flips, a flat skyline and zeros.
// ---------------------------------------------------------------------------------------------

const CACHE_LIMIT = 64;
const skylineCache = new Map<string, Skyline>();
const seriesCache = new Map<string, Sample[]>();
const summaryCache = new Map<string, Summary>();
const flipCache = new Map<string, Flip>();
// Per site: the latest sunlit hour found scanning back from 2100, how far back it got, and how
// far back it has been asked to go. A scan longer than one slice carries on in the background.
type LitScan = { litMs: number; fromMs: number; toMs: number; running: boolean };
const litScans = new Map<string, LitScan>();

function clearCaches(): void {
  missionCache = null;
  skylineCache.clear();
  seriesCache.clear();
  summaryCache.clear();
  flipCache.clear();
  litScans.clear();
}

function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  // A drag makes a new key at every step; dropping everything now and then keeps this small.
  if (cache.size >= CACHE_LIMIT) cache.clear();
  const value = make();
  cache.set(key, value);
  return value;
}

const siteKey = (s: Site): string => `${s.lat},${s.lon},${s.eye_m ?? ''}`;

function groundFor(site: Site): number {
  const dem = state.dem;
  return dem && dem.covers(site.lat, site.lon) ? dem.heightAt(site.lat, site.lon) : 0;
}

function hourly(sc: Scenario, startMs: number, range: Range): Sample[] {
  const eph = state.eph;
  const endMs = eph ? readableTo(startMs, startMs + rangeMs(range)) : null;
  if (!eph || endMs === null) return [];
  return cached(seriesCache, `${siteKey(sc.site)}|${startMs}|${range}`, () =>
    series(eph, sc.site, groundFor(sc.site), skylineFor(sc), startMs, endMs, HOUR_MS));
}

export function skylineFor(sc: Scenario): Skyline {
  return cached(skylineCache, siteKey(sc.site), () => skylineAt(state.dem, sc.site));
}

/** Hourly from sc.tMs: strips, sky paths. */
export function samplesFor(sc: Scenario, range: Range): Sample[] {
  return hourly(sc, sc.tMs, range);
}

/** Hourly from the window start for the live scenario, from its own time for any other. */
export function timelineFor(sc: Scenario, range: Range): Sample[] {
  return hourly(sc, sc.id === LIVE_ID ? state.windowStartMs : sc.tMs, range);
}

/** Over 30 days from sc.tMs. */
export function summaryFor(sc: Scenario): Summary {
  const samples = samplesFor(sc, '30d');
  // No hours yet may only mean the decade is still downloading: don't remember zeros for it.
  if (samples.length === 0) return summary([]);
  return cached(summaryCache, `${siteKey(sc.site)}|${sc.tMs}`, () => summary(samples));
}

/** Next rise or set after sc.tMs. */
export function flipFor(sc: Scenario, body: Body): Flip {
  const eph = state.eph;
  const endMs = eph ? readableTo(sc.tMs, sc.tMs + FLIP_DAYS * DAY_MS) : null;
  if (!eph || endMs === null) return null;
  return cached(flipCache, `${siteKey(sc.site)}|${sc.tMs}|${body}`, () =>
    nextFlip(eph, sc.site, groundFor(sc.site), skylineFor(sc), sc.tMs, body, (endMs - sc.tMs) / DAY_MS));
}

/**
 * No sunlight there from sc.tMs to the end of the table (2100): no part of the Sun's disc
 * clears the skyline at any hour. False within 60 days of the end, where that proves nothing. Answers false at once when the Sun is up or rises within 60
 * days, which needs no extra download. Otherwise it needs every decade from sc.tMs to 2100;
 * until they arrive it answers false (the countdown then reads "No sunrise in the next 60
 * days", which is also true) and the readout updates when they are in. The same while the scan
 * itself runs: a long one carries on in slices between frames (issue #32, row 1).
 */
export function neverLitFor(sc: Scenario): boolean {
  const eph = state.eph;
  // Near the end of the table a few dark hours would prove nothing: ask for 60 days at least.
  if (!eph || sc.tMs < eph.startMs || eph.endMs - sc.tMs < FLIP_DAYS * DAY_MS) return false;
  if (sunlitTest(eph, sc)(sc.tMs) || flipFor(sc, 'sun') !== null) return false;
  if (!covered(sc.tMs, eph.endMs)) return false;
  const litMs = lastLitMs(eph, sc, sc.tMs);
  return litMs !== null && litMs < sc.tMs;
}

/**
 * True while neverLitFor can't answer yet but will once the decades to 2100 are in: the Sun is
 * down there, it doesn't rise within 60 days, and a decade from sc.tMs to the end of the table
 * is still downloading (issue #32, row 3). The countdown then says it is still checking, rather
 * than "No sunrise in the next 60 days" turning into "Permanently shadowed" seconds later.
 * False once the decades are in (neverLitFor answers), false when one of them failed to
 * download (neverLitFor can't answer before a reload), and false wherever neverLitFor answers
 * false at once: the Sun up, a sunrise within 60 days, or within 60 days of the end of the table.
 * Asks for nothing itself; neverLitFor, called beside it, asks for the decades.
 */
export function neverLitPendingFor(sc: Scenario): boolean {
  const eph = state.eph;
  if (!eph || !table || sc.tMs < eph.startMs || eph.endMs - sc.tMs < FLIP_DAYS * DAY_MS) return false;
  if (sunlitTest(eph, sc)(sc.tMs) || flipFor(sc, 'sun') !== null) return false;
  const need = table.missing(sc.tMs, eph.endMs);
  return need.length > 0 && !need.some((i) => failed.has(i));
}

/**
 * The test "is any of the Sun's disc above the skyline there at tMs". The site's ground height
 * and skyline are looked up once here, not once per hour: the scan below asks 650,000 times.
 */
function sunlitTest(eph: Ephemeris, sc: Scenario): (tMs: number) => boolean {
  const skyline = skylineFor(sc);
  const sunAt = sunAltAzAtSite(eph, sc.site);   // the site's axes once, not once an hour
  return (tMs) => {
    const sun = sunAt(tMs);
    return sun.alt - skylineElev(skyline, sun.az) + SUN_RADIUS > 0;
  };
}

/**
 * Hours scanned in one go. A dark spot near the pole scans about 650,000 hours from 2100 back
 * to today: about 0.75 s in one piece on a mid-range phone (T27, issue #32 row 1). In slices of
 * this size each takes about 15 ms there, and the page keeps drawing in between. A count, not a
 * time limit, so the tests are the same on every machine.
 */
export const LIT_SCAN_SLICE_HOURS = 20_000;

/**
 * The latest hour with sunlight there, at or after downToMs, or -Infinity if none; null while
 * the scan is still running. Scans back hour by hour from the end of the table and remembers
 * how far it got, so dragging the time earlier only scans the new hours, and a site that sees
 * the Sun again before 2100 stops at once. The first slice runs now; a longer scan carries on in
 * slices between frames and calls notify() when it is done, so the modules read the answer.
 */
function lastLitMs(eph: Ephemeris, sc: Scenario, downToMs: number): number | null {
  const key = siteKey(sc.site);
  let scan = litScans.get(key);
  if (!scan) {
    if (litScans.size >= CACHE_LIMIT) litScans.clear();
    scan = { litMs: -Infinity, fromMs: eph.endMs + HOUR_MS, toMs: downToMs, running: false };
    litScans.set(key, scan);
  }
  scan.toMs = Math.min(scan.toMs, downToMs);
  if (scan.running) return null;
  if (!scanSlice(scan, sunlitTest(eph, sc))) return scan.litMs;
  // Not done in one slice: carry on in the background. A scan dropped meanwhile (the caches were
  // cleared, or the site fell out of them) stops at its next slice.
  scan.running = true;
  const sunlit = sunlitTest(eph, sc);
  const next = (): void => {
    if (litScans.get(key) !== scan) return;
    if (scanSlice(scan, sunlit)) { soon(next); return; }
    scan.running = false;
    notify(false);
  };
  soon(next);
  return null;
}

// Runs fn as a new task, after the browser has had its turn. A message, not setTimeout(fn, 0):
// browsers hold nested timeouts back by 4 ms each, which made 30-odd slices 0.2 s slower.
const slices: (() => void)[] = [];
const sliceChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
if (sliceChannel) {
  sliceChannel.port1.onmessage = () => { slices.shift()?.(); };
  // In Node (the tests) an open port would keep the process alive; browsers have no unref.
  (sliceChannel.port1 as { unref?: () => void }).unref?.();
}
function soon(fn: () => void): void {
  if (!sliceChannel) { setTimeout(fn, 0); return; }
  slices.push(fn);
  sliceChannel.port2.postMessage(null);
}

/** Scans up to one slice of hours. True when there is more to scan. */
function scanSlice(scan: LitScan, sunlit: (tMs: number) => boolean): boolean {
  for (let i = 0; i < LIT_SCAN_SLICE_HOURS; i++) {
    if (scan.litMs !== -Infinity || scan.fromMs <= scan.toMs) return false;
    const t = scan.fromMs - HOUR_MS;
    scan.fromMs = t;
    if (sunlit(t)) scan.litMs = t;
  }
  return scan.litMs === -Infinity && scan.fromMs > scan.toMs;
}

// ---------------------------------------------------------------------------------------------
// The mission (T34)
// ---------------------------------------------------------------------------------------------

const sameSiteTime = (sc: { site: Site; tMs: number }, land: { site: Site; tMs: number }): boolean =>
  sc.tMs === land.tMs && Math.abs(sc.site.lat - land.site.lat) < 1e-6 && Math.abs(sc.site.lon - land.site.lon) < 1e-6;

/** True when the scenario is where and when the mission lands. */
export function isLanding(sc: Scenario): boolean {
  return state.landing !== null && sameSiteTime(sc, state.landing);
}

/**
 * The landing point as a scenario, so the accessors above work on it: the label and colour of a
 * pinned or live scenario at the same place and time, or "Landing site" in the accent colour.
 */
export function landingScenario(): Scenario | null {
  const land = state.landing;
  if (!land) return null;
  const same = [...state.pinned, state.live].find((sc) => sameSiteTime(sc, land));
  return {
    id: LANDING_ID,
    label: same ? same.label : 'Landing site',
    color: same ? same.color : '--accent',
    site: { ...land.site },
    tMs: land.tMs,
  };
}

export type MissionResult =
  | { status: 'none' }        // no landing point chosen
  | { status: 'loading' }     // the table, or the decade of the arrival, is on its way
  | { status: 'outside' }     // the arrival or touchdown is outside the Sun and Earth table
  | { status: 'ready'; plan: MissionPlan };

let missionCache: { key: string; plan: MissionPlan } | null = null;

/**
 * The mission to the landing point (core/mission.ts), worked out once per landing point, pad,
 * lander and table. The Earth-Moon distance comes from the table at the arrival, about a day
 * before touchdown with Apollo 11's lunar-orbit time.
 */
export function missionFor(): MissionResult {
  const land = state.landing;
  if (!land) return { status: 'none' };
  const eph = state.eph;
  if (!eph) return { status: 'loading' };
  const arrivalMs = land.tMs - APOLLO_11_TIMES.lunarOrbitS * 1000 - 2 * HOUR_MS;
  if (arrivalMs < eph.startMs || land.tMs > eph.endMs) return { status: 'outside' };
  const end = readableTo(arrivalMs, land.tMs);
  if (end === null) return { status: 'loading' };
  if (end < land.tMs) return { status: 'outside' };
  const earthMoonKm = earthMoonKmAt(eph, arrivalMs);
  if (earthMoonKm === null) return { status: 'loading' };
  const l = state.lander;
  const key = `${siteKey(land.site)}|${land.tMs}|${state.padId}|${l.massKg},${l.dryKg},${l.ispS},${l.thrustN}|${earthMoonKm}`;
  if (missionCache?.key !== key) {
    missionCache = {
      key,
      plan: planMission({ site: land.site, touchdownMs: land.tMs, pad: padById(state.padId), lander: l, earthMoonKm }),
    };
  }
  return { status: 'ready', plan: missionCache.plan };
}
