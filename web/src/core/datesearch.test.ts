// Tests by T42. Every table here is made up in memory, as in windows.test.ts, so nothing depends
// on which data file is in the repo. The real-data checks at the end skip on T20's mock.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { END_LOOK_DAYS, firstWindow, monthsLater, type Need } from './datesearch';
import { parseDem, type DemMeta } from './dem';
import { indexEphemeris, parseEphemeris, type Ephemeris, type EphemerisMeta } from './ephemeris';
import { skylineAt } from './horizon';
import { readRealTable } from './realTable.testutil';
import type { CuratedSite, Site, Skyline } from './types';
import { durationText, nextFlip, series } from './windows';

const START = Date.parse('2027-01-01T00:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH_DAYS = 29.53;     // the Sun circles once
const WOBBLE_DAYS = 27.3;     // Earth swings east and west once
const EARTH_KM = 384_400;
const RAD = Math.PI / 180;

// ---- made-up tables --------------------------------------------------------------------------

type Sky = { sunLon: (d: number) => number; earthLon: (d: number) => number };
/** The Sun circling east to west once per 29.53 days, over longitude 0 at the start. */
const circling = (d: number): number => (-360 * d) / MONTH_DAYS;

/** Hourly rows, Sun and Earth over the equator at the longitudes asked for (degrees, by day). */
function rowsFor(days: number, sky: Sky): Float32Array {
  const rows = days * 24 + 1;
  const out = new Float32Array(rows * 6);
  for (let r = 0; r < rows; r++) {
    const d = r / 24;
    const s = sky.sunLon(d) * RAD;
    const e = sky.earthLon(d) * RAD;
    out.set([Math.cos(s), Math.sin(s), 0, EARTH_KM * Math.cos(e), EARTH_KM * Math.sin(e), 0], r * 6);
  }
  return out;
}

const META = {
  start: '2027-01-01T00:00:00Z', step_s: 3600, frame: 'MOON_ME_DE421',
  columns: [], source: 'made up for a test',
};

function table(days: number, sky: Sky): Ephemeris {
  const rows = rowsFor(days, sky);
  return parseEphemeris({ ...META, rows: rows.length / 6 }, rows.slice().buffer);
}

/** The same rows in two "decade" files that share their boundary row, the second not loaded. */
function halfLoaded(days: number, splitDay: number, sky: Sky): Ephemeris {
  const all = rowsFor(days, sky);
  const rows = all.length / 6;
  const cut = splitDay * 24;
  const meta: EphemerisMeta = {
    ...META, rows, home: 0,
    chunks: [
      { file: 'ephemeris/a.bin', start: META.start, rows: cut + 1 },
      { file: 'ephemeris/b.bin', start: new Date(START + cut * HOUR).toISOString(), rows: rows - cut },
    ],
  };
  return indexEphemeris(meta).withChunk(0, all.slice(0, (cut + 1) * 6).buffer);
}

/** Sun circling, Earth holding still over longitude 0. */
const month = table(120, { sunLon: circling, earthLon: () => 0 });
/** Sun circling, Earth swinging 7 degrees either side of longitude 0. */
const wobble = table(120, { sunLon: circling, earthLon: (d) => 7 * Math.sin((2 * Math.PI * d) / WOBBLE_DAYS) });
/** Sun and Earth both held over longitude 0. */
const still = table(120, { sunLon: () => 0, earthLon: () => 0 });

const flat: Skyline = { elev: new Float32Array(360), terrain: false };
const equator: Site = { lat: 0, lon: 0 };
const farSide: Site = { lat: 0, lon: 180 };
/** On the limb as seen from Earth: Earth sits on the horizon, up half the time with the wobble. */
const eastLimb: Site = { lat: 0, lon: 90 };

const search = (eph: Ephemeris, site: Site, from: number, to: number, need: Need, hours: number) =>
  firstWindow(eph, site, 0, flat, from, to, need, hours);
const at = (eph: Ephemeris, site: Site, t: number) => series(eph, site, 0, flat, t, t + 1, HOUR)[0];

// ---- the search ------------------------------------------------------------------------------

describe('firstWindow', () => {
  it('finds a window starting at the search start where the Sun and Earth are up all the time', () => {
    const r = search(still, equator, START + 5 * DAY + 17 * MIN, START + 30 * DAY, 'both', 48);
    expect(r).toEqual({ status: 'found', startMs: START + 5 * DAY + 17 * MIN, endMs: null });
  });

  it('finds none where the Sun never rises, and says how far it looked', () => {
    expect(search(still, farSide, START, START + 30 * DAY, 'sun', 1))
      .toEqual({ status: 'none', checkedToMs: START + 30 * DAY });
    // Earth is never up on the far side either, even with the Sun overhead.
    const sunOver180 = table(40, { sunLon: () => 180, earthLon: () => 0 });
    expect(search(sunOver180, farSide, START, START + 30 * DAY, 'both', 1).status).toBe('none');
    expect(search(sunOver180, farSide, START, START + 30 * DAY, 'sun', 1).status).toBe('found');
  });

  it('finds none when the threshold is longer than any run', () => {
    // At the equator the Sun is up for half of each 29.53-day month: 14.8 days at a time.
    const r = search(month, equator, START, START + 90 * DAY, 'sun', 15 * 24);
    expect(r).toEqual({ status: 'none', checkedToMs: START + 90 * DAY });
    expect(search(month, equator, START, START + 90 * DAY, 'sun', 14 * 24).status).toBe('found');
  });

  it("starts a window at the countdown's sunrise, to the minute, and ends it at the sunset", () => {
    const from = START + 10 * DAY;   // the Sun is down at longitude 0 then
    expect(at(month, equator, from).sunFrac).toBe(0);
    const r = search(month, equator, from, from + 60 * DAY, 'sun', 24);
    const rise = nextFlip(month, equator, 0, flat, from, 'sun');
    expect(rise?.type).toBe('rise');
    if (r.status !== 'found' || !rise) throw new Error('expected a window and a sunrise');
    expect(r.startMs - rise.tMs).toBeGreaterThanOrEqual(0);
    expect(r.startMs - rise.tMs).toBeLessThan(MIN);
    expect(r.startMs % MIN).toBe(0);                     // a whole minute, for the time box and link
    const set = nextFlip(month, equator, 0, flat, r.startMs, 'sun');
    expect(set?.type).toBe('set');
    expect(Math.abs((r.endMs ?? 0) - (set?.tMs ?? 0))).toBeLessThan(MIN);
  });

  it('agrees with Earthrise for an Earth-only search, and needs both at once for "both"', () => {
    // From the limb, Earth is up while it swings east: days 0 to 13.65 of each 27.3. Down at day 15.
    const from = START + 15 * DAY;
    expect(at(wobble, eastLimb, from).earthUp).toBe(false);
    const earth = search(wobble, eastLimb, from, from + 60 * DAY, 'earth', 24);
    const both = search(wobble, eastLimb, from, from + 90 * DAY, 'both', 24);
    if (earth.status !== 'found' || both.status !== 'found') throw new Error('expected two windows');
    const rise = nextFlip(wobble, eastLimb, 0, flat, from, 'earth');
    expect(rise?.type).toBe('rise');
    expect(earth.startMs - (rise?.tMs ?? 0)).toBeGreaterThanOrEqual(0);
    expect(earth.startMs - (rise?.tMs ?? 0)).toBeLessThan(MIN);
    // At the start of "both", both are up; a minute and a half earlier, one of them is not.
    const s = at(wobble, eastLimb, both.startMs);
    expect(s.sunFrac > 0 && s.earthUp).toBe(true);
    const before = at(wobble, eastLimb, both.startMs - 1.5 * MIN);
    expect(before.sunFrac > 0 && before.earthUp).toBe(false);
    // And every hour of it has both up, for at least 24 hours.
    const end = both.endMs ?? both.startMs + END_LOOK_DAYS * DAY;
    expect(end - both.startMs).toBeGreaterThanOrEqual(24 * HOUR);
    for (const x of series(wobble, eastLimb, 0, flat, both.startMs, end, HOUR)) {
      expect(x.sunFrac > 0 && x.earthUp).toBe(true);
    }
  });

  it('counts a run already under way at the start only from the start', () => {
    // The Sun sets at longitude 0 7.4 days in and rises again 14.8 days later. From day 7, under
    // 24 h of daylight is left.
    const from = START + 7 * DAY;
    const r = search(month, equator, from, from + 40 * DAY, 'sun', 24);
    if (r.status !== 'found') throw new Error('expected a window');
    expect(r.startMs).toBeGreaterThan(from + 14 * DAY);   // the next one, after the long night
    expect(r.startMs).toBeLessThan(from + 16 * DAY);
    const short = search(month, equator, from, from + 40 * DAY, 'sun', 2);
    expect(short).toMatchObject({ status: 'found', startMs: from });
  });

  it('still finds a run that starts inside the scan but ends after it', () => {
    const from = START + 10 * DAY;
    const rise = nextFlip(month, equator, 0, flat, from, 'sun')!.tMs;
    const r = search(month, equator, from, rise + HOUR, 'sun', 5 * 24);
    if (r.status !== 'found') throw new Error('expected a window');
    expect(r.endMs ?? 0).toBeGreaterThan(rise + 5 * DAY);
  });

  it('says "more than 60 days" (endMs null) for a window that is still going then', () => {
    const r = search(still, equator, START, START + 10 * DAY, 'sun', 1);
    expect(r).toEqual({ status: 'found', startMs: START, endMs: null });
  });

  it('stops at the end of the table', () => {
    const r = search(still, farSide, START + 100 * DAY, START + 200 * DAY, 'sun', 1);
    expect(r).toEqual({ status: 'none', checkedToMs: still.endMs });
    expect(search(still, farSide, START + 200 * DAY, START + 300 * DAY, 'sun', 1))
      .toEqual({ status: 'none', checkedToMs: still.endMs });
  });

  it('never reports a window in a decade that is not in memory', () => {
    // Day 0 to 12 loaded, the rest not. The Sun is down at day 10 and rises around day 22, in the
    // missing part: vectorsAt() would hand back day 12's row there, a Sun standing still.
    const half = halfLoaded(60, 12, { sunLon: circling, earthLon: () => 0 });
    const r = search(half, equator, START + 10 * DAY, START + 50 * DAY, 'sun', 24);
    expect(r.status).toBe('no-rows');
    if (r.status === 'no-rows') expect(r.atMs).toBeGreaterThan(START + 12 * DAY - HOUR);
    expect(r.status === 'no-rows' && r.atMs).toBeLessThanOrEqual(START + 12 * DAY + HOUR);
    // With the Sun held overhead in the missing part, it still doesn't call that a window.
    const frozen = halfLoaded(60, 12, { sunLon: (d) => (d < 12 ? 180 : 0), earthLon: () => 0 });
    expect(search(frozen, equator, START, START + 50 * DAY, 'sun', 1).status).toBe('no-rows');
  });

  it('finds none for a threshold or span that makes no sense', () => {
    expect(search(still, equator, START, START + DAY, 'sun', 0).status).toBe('none');
    expect(search(still, equator, START, START - DAY, 'sun', 1).status).toBe('none');
    expect(search(still, equator, Number.NaN, START, 'sun', 1).status).toBe('none');
  });

  it('before the table, has no rows', () => {
    expect(search(still, equator, START - 10 * DAY, START, 'sun', 1))
      .toEqual({ status: 'no-rows', atMs: START - 10 * DAY });
  });
});

describe('monthsLater', () => {
  it('adds calendar months in UTC, keeping the time of day', () => {
    expect(monthsLater(Date.parse('2026-11-15T06:40:00Z'), 6)).toBe(Date.parse('2027-05-15T06:40:00Z'));
    expect(monthsLater(Date.parse('2026-11-15T06:40:00Z'), 12)).toBe(Date.parse('2027-11-15T06:40:00Z'));
    expect(monthsLater(Date.parse('2029-12-31T23:00:00Z'), 1)).toBe(Date.parse('2030-01-31T23:00:00Z'));
  });
  it("uses the month's last day for a day it doesn't have", () => {
    expect(monthsLater(Date.parse('2027-01-31T12:00:00Z'), 1)).toBe(Date.parse('2027-02-28T12:00:00Z'));
    expect(monthsLater(Date.parse('2028-01-31T12:00:00Z'), 1)).toBe(Date.parse('2028-02-29T12:00:00Z'));
    expect(monthsLater(Date.parse('2027-08-31T00:00:00Z'), 3)).toBe(Date.parse('2027-11-30T00:00:00Z'));
  });
});

describe('durationText (exported for T42)', () => {
  it('reads as the countdowns do', () => {
    expect(durationText(3 * DAY + 4 * HOUR + 59 * MIN)).toBe('3 d 4 h');
    expect(durationText(5 * HOUR + 20 * MIN)).toBe('5 h 20 min');
  });
});

// ---- real data (skips on mock) ---------------------------------------------------------------

const dataFile = (rel: string): string => fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url));
const readJson = <T>(rel: string): T | null =>
  existsSync(dataFile(rel)) ? (JSON.parse(readFileSync(dataFile(rel), 'utf8')) as T) : null;
const demMeta = readJson<DemMeta>('dem.json');
const real = readRealTable();
const realSkip = !real || !demMeta || demMeta.source === 'mock';

describe.skipIf(realSkip)('real data: date search from 15 Nov 2026 (T42)', () => {
  const bytes = readFileSync(dataFile('dem.bin'));
  const dem = parseDem(demMeta as DemMeta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sites = readJson<CuratedSite[]>('sites.json') ?? [];
  const siteById = (id: string): Site => {
    const s = sites.find((x) => x.id === id);
    if (!s) throw new Error(`sites.json has no "${id}"`);
    return { lat: s.lat, lon: s.lon };
  };
  const from = Date.parse('2026-11-15T00:00:00Z');
  const to = monthsLater(from, 6);
  const run = (id: string, need: Need, hours: number) => {
    const site = siteById(id);
    const g = dem.heightAt(site.lat, site.lon);
    const sky = skylineAt(dem, site);
    const t0 = performance.now();
    const r = firstWindow(real as Ephemeris, site, g, sky, from, to, need, hours);
    return { r, site, g, sky, ms: performance.now() - t0 };
  };

  it('finds a 48 h window of Sun and Earth together at the crater rim, and both are up then', () => {
    const { r, site, g, sky, ms } = run('shackleton-rim', 'both', 48);
    console.log(`shackleton-rim, both, 48 h, 6 months: ${JSON.stringify(r)} in ${ms.toFixed(1)} ms`);
    if (r.status !== 'found') throw new Error(`expected a window, got ${r.status}`);
    const s = series(real as Ephemeris, site, g, sky, r.startMs, r.startMs + 1, 3_600_000)[0];
    expect(s.sunFrac).toBeGreaterThan(0);
    expect(s.earthUp).toBe(true);
    // The countdowns from then: no sunset and no Earthset within the 48 hours.
    for (const body of ['sun', 'earth'] as const) {
      const flip = nextFlip(real as Ephemeris, site, g, sky, r.startMs, body);
      if (flip) expect(flip.tMs - r.startMs).toBeGreaterThanOrEqual(48 * 3_600_000 - 2 * MIN);
    }
  });

  it('finds none on the crater floor', () => {
    const { r, ms } = run('shackleton-floor', 'both', 48);
    console.log(`shackleton-floor, both, 48 h, 6 months: ${JSON.stringify(r)} in ${ms.toFixed(1)} ms`);
    expect(r).toEqual({ status: 'none', checkedToMs: to });
  });

  it('scans 12 months in a reasonable time (the time is printed for the pull request)', () => {
    const site = siteById('shackleton-floor');
    const sky = skylineAt(dem, site);
    const t0 = performance.now();
    const r = firstWindow(real as Ephemeris, site, dem.heightAt(site.lat, site.lon), sky, from, monthsLater(from, 12), 'both', 48);
    const ms = performance.now() - t0;
    console.log(`shackleton-floor, both, 48 h, 12 months (a full scan): ${r.status} in ${ms.toFixed(1)} ms`);
    expect(r.status).toBe('none');
    expect(ms).toBeLessThan(2000);
  });
});
