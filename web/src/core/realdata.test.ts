// T24: the terrain checks of spec section 7, on the real Sun and Earth table and the real height
// map in web/public/data/. Skips, saying why, while either file is T20's mock.
//
// The table is split into decade files (contract section 2), so it is built with
// readRealTable() (indexEphemeris + withChunk, every decade) rather than one parseEphemeris call.
// "The whole table" is 1900-01-01 to 2101-01-01, sampled hourly; that includes 2026-2035.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDem, type Dem, type DemMeta } from './dem';
import type { Ephemeris } from './ephemeris';
import { parseGlobe, parseNorth, type GlobeMeta } from './globe';
import { skylineAt } from './horizon';
import { readRealTable } from './realTable.testutil';
import type { CuratedSite, Site } from './types';
import { series } from './windows';

const dataFile = (rel: string): string => fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url));

function readJson<T>(rel: string): T | null {
  const f = dataFile(rel);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}

const ephMeta = readJson<{ source?: string }>('ephemeris.json');
const demMeta = readJson<DemMeta>('dem.json');

function whySkip(): string | null {
  if (!ephMeta) return 'web/public/data/ephemeris.json is missing';
  if (!demMeta) return 'web/public/data/dem.json is missing';
  const mock = [ephMeta.source === 'mock' && 'ephemeris.json', demMeta.source === 'mock' && 'dem.json']
    .filter(Boolean);
  if (mock.length > 0) return `${mock.join(' and ')} ${mock.length > 1 ? 'say' : 'says'} "source": "mock"`;
  // A real dem.json without its dem.bin is an error, not a reason to skip, as for the table's
  // decade files in readRealTable(): these checks would otherwise pass by not running.
  if (!existsSync(dataFile('dem.bin'))) throw new Error('web/public/data/dem.json is real but dem.bin is not there');
  return null;
}

const skipReason = whySkip();
if (skipReason) console.log(`realdata.test.ts skipped: ${skipReason}. These checks need the real files.`);

const HOUR_MS = 3_600_000;
const YEAR_MS = 365 * 24 * HOUR_MS;

function readDem(meta: DemMeta): Dem {
  const bytes = readFileSync(dataFile('dem.bin'));
  return parseDem(meta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

function siteById(sites: CuratedSite[], id: string): Site {
  const s = sites.find((x) => x.id === id);
  if (!s) throw new Error(`sites.json has no "${id}" (T07 must provide it)`);
  return { lat: s.lat, lon: s.lon };
}

/** Hourly over the whole table, a year at a time so the samples never all sit in memory. */
function sunOverTable(eph: Ephemeris, dem: Dem, site: Site) {
  const ground = dem.heightAt(site.lat, site.lon);
  const sky = skylineAt(dem, site);
  let hours = 0, lit = 0, maxFrac = 0, maxAbove = -Infinity, maxAboveMs = 0;
  for (let t = eph.startMs; t < eph.endMs; t += YEAR_MS) {
    for (const s of series(eph, site, ground, sky, t, Math.min(t + YEAR_MS, eph.endMs), HOUR_MS)) {
      hours++;
      if (s.sunFrac > 0) lit++;
      if (s.sunFrac > maxFrac) maxFrac = s.sunFrac;
      if (s.sunAbove > maxAbove) { maxAbove = s.sunAbove; maxAboveMs = s.tMs; }
    }
  }
  return { ground, hours, lit, litPct: (100 * lit) / hours, maxFrac, maxAbove, maxAboveAt: new Date(maxAboveMs).toISOString() };
}

describe.skipIf(skipReason !== null)('real data: terrain checks (spec section 7)', () => {
  const eph = skipReason ? null : readRealTable();
  const dem = skipReason ? null : readDem(demMeta as DemMeta);
  const sites = readJson<CuratedSite[]>('sites.json') ?? [];
  const floor = skipReason ? { lat: 0, lon: 0 } : siteById(sites, 'shackleton-floor');
  const rim = skipReason ? { lat: 0, lon: 0 } : siteById(sites, 'shackleton-rim');
  const span = eph ? `${new Date(eph.startMs).toISOString()} to ${new Date(eph.endMs).toISOString()}` : '';

  it('floor: the lowest of the 360 skyline values is above 5 degrees', () => {
    const sky = skylineAt(dem, floor);
    const v = Array.from(sky.elev);
    const low = Math.min(...v);
    console.log(`shackleton-floor (${floor.lat}, ${floor.lon}), ground ${dem!.heightAt(floor.lat, floor.lon).toFixed(0)} m: ` +
      `skyline lowest ${low.toFixed(2)} deg at az ${v.indexOf(low)}, highest ${Math.max(...v).toFixed(2)} deg`);
    expect(sky.terrain).toBe(true);
    expect(low).toBeGreaterThan(5);
  });

  // Runs before the two full-table checks below: they build millions of hourly samples, and a
  // skyline timed straight after them also measured the clean-up of that memory (fastest of five
  // was 105.5 ms after them, about 40 ms on its own). Limit and method are unchanged.
  it('one real skyline takes under 100 ms', () => {
    let t = performance.now();
    skylineAt(dem, rim);
    const cold = performance.now() - t;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      t = performance.now();
      skylineAt(dem, rim);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`real skyline timing (shackleton-rim): first call ${cold.toFixed(1)} ms; next 5 ` +
      `${times.map((x) => x.toFixed(1)).join(', ')} ms (fastest ${times[0].toFixed(1)} ms)`);
    // The fastest of five, as in horizon.test.ts: a busy machine only ever adds time.
    expect(times[0]).toBeLessThan(100);
  });

  it('floor: never lit in the whole table (sunFrac 0 every hour)', () => {
    const r = sunOverTable(eph!, dem!, floor);
    console.log(`shackleton-floor, ${span}: ${r.hours} hourly samples, ${r.lit} lit; largest sunFrac ${r.maxFrac}; ` +
      `Sun centre came closest at ${r.maxAbove.toFixed(2)} deg relative to the skyline (${r.maxAboveAt})`);
    expect(r.lit).toBe(0);
  }, 300_000);

  it('rim: lit more than half of the whole table', () => {
    const r = sunOverTable(eph!, dem!, rim);
    console.log(`shackleton-rim (${rim.lat}, ${rim.lon}), ground ${r.ground.toFixed(0)} m, ${span}: ` +
      `lit ${r.lit} of ${r.hours} hours = ${r.litPct.toFixed(1)} %`);
    expect(r.litPct).toBeGreaterThan(50);
  }, 300_000);
});

// T37 (option C): the coarse skyline on the real globe.bin, north of 85 S. Skips, saying why,
// while globe.json is missing or says "mock" (the mock data set has none). Needs no table.
const globeMeta = readJson<GlobeMeta>('globe.json');
const globeSkip = !globeMeta ? 'web/public/data/globe.json is missing'
  : globeMeta.source === 'mock' ? 'globe.json says "source": "mock"' : null;
// A real globe.json without its globe.bin is an error, not a reason to skip (as for dem.bin above).
if (globeMeta && !globeSkip && !existsSync(dataFile('globe.bin'))) {
  throw new Error('web/public/data/globe.json is real but globe.bin is not there');
}
if (globeSkip) console.log(`realdata.test.ts, T37 skipped: ${globeSkip}.`);

describe.skipIf(globeSkip !== null)('real data: coarse terrain north of 85 S (T37)', () => {
  const globe = globeSkip ? null : (() => {
    const bytes = readFileSync(dataFile('globe.bin'));
    return parseGlobe(globeMeta as GlobeMeta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  })();
  const dem = skipReason || !demMeta ? null : readDem(demMeta);
  // north.bin, the 1.2 km grid for sites north of 80 N; null when it isn't the real file.
  const northMeta = readJson<DemMeta>('north.json');
  const north = !northMeta || northMeta.source === 'mock' || !existsSync(dataFile('north.bin')) ? null : (() => {
    const bytes = readFileSync(dataFile('north.bin'));
    return parseNorth(northMeta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  })();
  const sites = readJson<CuratedSite[]>('sites.json') ?? [];

  it('Apollo 15: the highest point of its skyline is above 1 degree (Mons Hadley and Hadley Delta)', () => {
    const a15 = siteById(sites, 'apollo-15');
    const sky = skylineAt(dem, a15, globe);
    const v = Array.from(sky.elev);
    const top = Math.max(...v);
    console.log(`apollo-15 (${a15.lat}, ${a15.lon}): grid ${sky.grid}, ${sky.cellM?.toFixed(0)} m cells; ` +
      `highest ${top.toFixed(2)} deg at azimuth ${v.indexOf(top)}, lowest ${Math.min(...v).toFixed(2)} deg`);
    expect(sky.grid).toBe('globe');
    expect(top).toBeGreaterThan(1);
  });

  it('every curated site has terrain: dem.bin south of 80 S, north.bin north of 80 N, globe.bin elsewhere', () => {
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      // No curated site lies within 0.01 degrees of either edge, where the map's square decides.
      expect(Math.abs(Math.abs(s.lat) - 80), s.id).toBeGreaterThan(0.01);
      const sky = skylineAt(dem, { lat: s.lat, lon: s.lon }, globe, north);
      const want = s.lat <= -85 ? (dem ? 'dem' : null)
        : s.lat < -80 && dem ? 'dem'
          : s.lat > 80 && north ? 'north' : 'globe';
      const v = Array.from(sky.elev);
      console.log(`${s.id.padEnd(22)} ${String(s.lat).padStart(9)} ${String(sky.grid).padEnd(5)} ` +
        `${sky.outer ? `(globe.bin past ${sky.outer.lat})` : ''} ` +
        `highest ${Math.max(...v).toFixed(2)} deg, lowest ${Math.min(...v).toFixed(2)} deg`);
      expect(sky.grid, s.id).toBe(want);
      // Only a site between 80 and 85 degrees can walk past its polar map's edge.
      expect(sky.outer !== undefined, s.id).toBe(sky.grid !== 'globe' && sky.grid !== null && Math.abs(s.lat) < 85);
      expect(v.every(Number.isFinite), s.id).toBe(true);
    }
  });

  it.skipIf(skipReason !== null)('IM-1, IM-2 and Chandrayaan-4 (80 S to 85 S) use the 240 m map', () => {
    for (const id of ['im-1', 'im-2', 'chandrayaan-4']) {
      const sky = skylineAt(dem, siteById(sites, id), globe, north);
      expect([sky.grid, sky.cellM, sky.outer?.lat], id).toEqual(['dem', 240, -80]);
    }
  });

  it.skipIf(skipReason !== null)('where a walk changes map, the two maps agree: dem.bin and north.bin against globe.bin, 0.2 degrees inside each edge', () => {
    const rings: [string, number, ((lon: number) => number) | null][] = [
      ['dem.bin at 80.2 S', -80.2, dem ? (lon) => dem.heightAt(-80.2, lon) : null],
      ['north.bin at 80.2 N', 80.2, north ? (lon) => north.heightAt(-80.2, lon) : null],
    ];
    for (const [name, lat, polar] of rings) {
      if (!polar) continue;
      const diff: number[] = [];
      for (let lon = -180; lon < 180; lon += 0.5) diff.push(polar(lon) - globe!.heightBilinear(lat, lon));
      const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
      const abs = diff.map(Math.abs).sort((a, b) => a - b);
      console.log(`${name} minus globe.bin, ${diff.length} points: mean ${mean.toFixed(1)} m, ` +
        `median ${abs[abs.length >> 1].toFixed(0)} m apart, worst ${abs[abs.length - 1].toFixed(0)} m`);
      // The same LOLA surface at two cell sizes: no offset, and a wrong longitude or a mirrored
      // grid would put them kilometres apart (heights on this ring span several km).
      expect(Math.abs(mean), name).toBeLessThan(20);
      expect(abs[abs.length >> 1], name).toBeLessThan(100);
    }
  });

  it('one real coarse skyline takes under 100 ms', () => {
    const site = siteById(sites, 'apollo-15');
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      skylineAt(dem, site, globe);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`real coarse skyline (apollo-15): ${times.map((x) => x.toFixed(1)).join(', ')} ms`);
    expect(times[0]).toBeLessThan(100);
  });
});
