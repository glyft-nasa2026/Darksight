// Tests for the mission report (T35): the files carry the plan's numbers exactly, and the
// surface periods agree with the 30-day summary.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_LANDER, planMission, type MissionInput, type OkPlan } from './mission';
import { padById } from './pads';
import {
  buildReport, CSV_COLUMNS, descentTrack, missionEvents, periods, REPORT_SCHEMA, reportCsv, reportFileName,
  reportJson, type LandingConditions, type ReportContext,
} from './report';
import type { Sample } from './types';
import { summary } from './windows';

const SITE = { lat: -89.6866, lon: -162.81 };
const TOUCHDOWN = Date.parse('2026-11-21T16:04:00Z');
const HOUR = 3600_000;

const plan = (over: Partial<MissionInput> = {}): OkPlan => {
  const p = planMission({
    site: SITE, touchdownMs: TOUCHDOWN, pad: padById('ksc-39a'), lander: EXAMPLE_LANDER, earthMoonKm: 380_000, ...over,
  });
  if (!p.ok) throw new Error(p.error);
  return p;
};

// Hourly samples with a made-up light pattern: up 50 h, down 30 h, and so on; Earth every third hour hidden.
const samples: Sample[] = Array.from({ length: 30 * 24 }, (_, i) => ({
  tMs: TOUCHDOWN + i * HOUR,
  sun: { alt: 1, az: 10 }, earth: { alt: 2, az: 20 }, sunAbove: 0, earthAbove: 0,
  sunFrac: i % 80 < 50 ? (i % 7) / 7 + 0.01 : 0,
  earthUp: i % 3 !== 0,
}));

const conditions: LandingConditions = {
  sun: { up: true, altDeg: 1.6, azDeg: 212, aboveSkylineDeg: 0.4, discFrac: 1 },
  earth: { up: false, altDeg: -0.5, azDeg: 9, aboveSkylineDeg: -2 },
  sunFlip: { type: 'set', tMs: TOUCHDOWN + 48 * 24 * HOUR },
  earthFlip: { type: 'rise', tMs: TOUCHDOWN + 3 * 24 * HOUR },
  sunText: 'Sunset in 48 d 0 h', earthText: 'Earthrise in 3 d 0 h',
  summary: summary(samples), terrain: true, terrainCellM: 240, terrainText: 'Terrain from LOLA, 240 m cells',
};

const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({
  generatedMs: Date.parse('2026-11-15T06:00:00Z'),
  site: { id: 'shackleton-rim', name: 'Shackleton rim', ...SITE },
  pad: padById('ksc-39a'), padChecked: true, lander: EXAMPLE_LANDER,
  data: { ephemeris: 'JPL DE440 via Skyfield', terrain: 'LRO LOLA LDEM_75S_240M' },
  shareLink: 'https://example.invalid/mission.html#land=-89.6866,-162.81,2026-11-21T16:04:00Z',
  conditions, surface: samples,
  warnings: [{ code: 'earth-hidden', level: 'warn', text: 'Earth is hidden at touchdown: no direct radio link.' }],
  ...over,
});

const p = plan();
const report = buildReport(p, ctx());

/** A small CSV reader for the test: quoted fields with doubled quotes. */
function readCsv(text: string): string[][] {
  return text.trimEnd().split('\r\n').map((line) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}
const num = (cell: string): number | null => (cell === '' ? null : Number(cell));

describe('CSV', () => {
  const rows = readCsv(reportCsv(report));

  it('has the header row and one row per phase', () => {
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows.length - 1).toBe(p.steps.length);
    expect(rows.slice(1).map((r) => r[1])).toEqual(p.steps.map((s) => s.id));
  });

  it('every time ends in Z, and reads back as the plan\'s (ISO to the ms; met_start_s exact)', () => {
    for (const [i, r] of rows.slice(1).entries()) {
      expect(r[4]).toMatch(/Z$/);
      expect(r[5]).toMatch(/Z$/);
      expect(Math.abs(Date.parse(r[4]) - p.steps[i].startMs)).toBeLessThan(1);
      expect(Math.abs(Date.parse(r[5]) - p.steps[i].endMs)).toBeLessThan(1);
      expect(num(r[6])).toBe((p.steps[i].startMs - p.launchMs) / 1000);
    }
  });

  it('its numbers read back equal the plan\'s, and not modelled is an empty cell', () => {
    const col = (name: (typeof CSV_COLUMNS)[number]): number => CSV_COLUMNS.indexOf(name);
    for (const [i, r] of rows.slice(1).entries()) {
      const s = p.steps[i];
      expect(num(r[col('dv_ms')])).toBe(s.dvKmS === null ? null : s.dvKmS * 1000);
      expect(num(r[col('burn_s')])).toBe(s.burnS);
      expect(num(r[col('propellant_kg')])).toBe(s.propellantKg);
      expect(num(r[col('mass_after_kg')])).toBe(s.massAfterKg);
      expect(num(r[col('alt_km')])).toBe(s.altKm);
      expect(num(r[col('duration_s')])).toBe((s.endMs - s.startMs) / 1000);
    }
    const launch = rows[1];
    expect(launch[col('propellant_kg')]).toBe('');   // the launch vehicle's: not modelled
    expect(num(launch[col('lat_deg')])).toBe(padById('ksc-39a').lat);
    const td = rows[rows.length - 1];
    expect(num(td[col('lat_deg')])).toBe(SITE.lat);
    expect(num(td[col('lon_deg')])).toBe(SITE.lon);
  });

  it('is plain ASCII', () => {
    // eslint-disable-next-line no-control-regex
    expect(reportCsv(report)).toMatch(/^[\x00-\x7f]*$/);
  });
});

describe('JSON', () => {
  const doc = JSON.parse(reportJson(report));

  it('parses, with the schema version, every phase and the plan\'s totals', () => {
    expect(doc.schema).toBe(REPORT_SCHEMA);
    expect(doc.phases.map((x: { id: string }) => x.id)).toEqual(p.steps.map((s) => s.id));
    expect(doc.totals.lander_dv_ms).toBe(p.totals.landerDvKmS * 1000);
    expect(doc.totals.launch_vehicle_dv_ms).toBe(p.totals.launchVehicleDvKmS * 1000);
    expect(doc.totals.propellant_loaded_kg).toBe(p.totals.propellantLoadedKg);
    expect(doc.totals.propellant_used_kg).toBe(p.totals.propellantUsedKg);
    expect(doc.totals.propellant_left_kg).toBe(p.totals.propellantLeftKg);
    expect(doc.totals.margin_pct).toBe(p.totals.margin * 100);
  });

  it('times are ISO 8601 with Z; not modelled is null, never 0', () => {
    const times: string[] = [];
    JSON.stringify(doc, (k, v) => { if (/(_utc|^utc)$/.test(k) && typeof v === 'string') times.push(v); return v; });
    expect(times.length).toBeGreaterThan(30);
    for (const t of times) expect(t).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    const launch = doc.phases[0];
    expect(launch.propellant_kg).toBeNull();
    expect(launch.mass_after_kg).toBeNull();
    expect(doc.phases.find((x: { id: string }) => x.id === 'tli').burn_s).toBeNull();
  });

  it('carries the landing site\'s numbers, the data source and the warnings', () => {
    expect(doc.site_at_touchdown.sun.alt_deg).toBe(1.6);
    expect(doc.site_at_touchdown.earth.visible).toBe(false);
    expect(doc.site_at_touchdown.summary_30d.lit_pct).toBe(conditions.summary.litPct);
    expect(doc.site_at_touchdown.terrain_skyline).toBe(true);
    expect(doc.site_at_touchdown.terrain_cell_m).toBe(240);   // T37
    expect(doc.data.mock).toBe(false);
    expect(doc.warnings[0].code).toBe('earth-hidden');
    expect(doc.sources.length).toBeGreaterThan(3);
  });
});

describe('the report', () => {
  it('says mock data when a file is mock', () => {
    expect(buildReport(p, ctx({ data: { ephemeris: 'mock', terrain: 'LRO LOLA' } })).mock).toBe(true);
    expect(buildReport(p, ctx({ data: { ephemeris: 'JPL DE440', terrain: 'mock (T20)' } })).mock).toBe(true);
    expect(report.mock).toBe(false);
  });

  it('knows the example lander and Apollo 11\'s phase lengths', () => {
    expect(report.exampleLander).toBe(true);
    expect(report.apolloTimes).toBe(true);
    expect(buildReport(p, ctx({ lander: { ...EXAMPLE_LANDER, ispS: 330 } })).exampleLander).toBe(false);
  });

  it('places the lunar phases on the Moon and the launch on the pad', () => {
    expect(report.phases[0]).toMatchObject({ body: 'earth', lat: padById('ksc-39a').lat });
    for (const ph of report.phases.filter((x) => ['loi', 'doi', 'powered-descent'].includes(x.id))) {
      expect(ph.body).toBe('moon');
      expect(ph.lat).not.toBeNull();
    }
    expect(report.phases.find((x) => x.id === 'coast')!.body).toBeNull();
  });

  it('counts the lunar-orbit revolutions from its length and period', () => {
    const lo = p.steps.find((s) => s.id === 'lunar-orbit')!;
    expect(report.orbit.lunarOrbitRevolutions).toBeCloseTo((lo.endMs - lo.startMs) / 1000 / p.orbit.lunarOrbitPeriodS, 12);
  });
});

describe('descent table, events and coast', () => {
  it('starts at ignition, steps 30 s and ends at touchdown', () => {
    const pd = p.steps.find((s) => s.id === 'powered-descent')!;
    const rows = report.descent.rows;
    expect(rows[0].tMs).toBe(pd.startMs);
    expect(rows[rows.length - 1].tMs).toBe(p.touchdownMs);
    for (let i = 1; i < rows.length - 1; i++) expect(rows[i].sinceIgnitionS - rows[i - 1].sinceIgnitionS).toBe(30);
    expect(rows[rows.length - 1].altKm).toBeLessThan(0.01);
    expect(rows[rows.length - 1].rangeToGoKm).toBeLessThan(0.5);
    expect(rows[0].rangeToGoKm).toBeCloseTo(p.orbit.descentRangeKm, 0);
  });

  it('ends where the propellant runs out, when it does', () => {
    const short = plan({ lander: { ...EXAMPLE_LANDER, dryKg: 900 } });
    expect(short.runsOutMs).not.toBeNull();
    const rows = descentTrack(short, 30);
    if (rows.length > 0) expect(rows[rows.length - 1].tMs).toBe(short.runsOutMs);
    const r = buildReport(short, ctx());
    expect(r.reached).toBe(false);
    expect(r.events.some((e) => e.id === 'runs-out')).toBe(true);
  });

  it('events are in time order, from liftoff to touchdown', () => {
    const ev = missionEvents(p);
    expect(ev[0].id).toBe('liftoff');
    expect(ev[ev.length - 1].id).toBe('touchdown');
    for (let i = 1; i < ev.length; i++) expect(ev[i].tMs).toBeGreaterThanOrEqual(ev[i - 1].tMs);
    const soi = ev.find((e) => e.id === 'soi')!;
    const loi = ev.find((e) => e.id === 'loi')!;
    expect(soi.tMs).toBeLessThan(loi.tMs);
    expect(ev[ev.length - 1].toTouchdownS).toBe(0);
  });

  it('the coast runs every 12 h from TLI to LOI', () => {
    const coast = p.steps.find((s) => s.id === 'coast')!;
    const c = report.coast;
    expect(c[0].tMs).toBe(coast.startMs);
    expect(c[c.length - 1].tMs).toBe(coast.endMs);
    expect(c[1].tMs - c[0].tMs).toBe(12 * HOUR);
  });
});

describe('periods', () => {
  for (const body of ['sun', 'earth'] as const) {
    it(`${body}: cover the 30 days with no gap or overlap`, () => {
      const list = periods(samples, body);
      expect(list[0].startMs).toBe(samples[0].tMs);
      expect(list[list.length - 1].endMs).toBe(samples[samples.length - 1].tMs + HOUR);
      for (let i = 1; i < list.length; i++) {
        expect(list[i].startMs).toBe(list[i - 1].endMs);
        expect(list[i].up).not.toBe(list[i - 1].up);
      }
    });
  }

  it('agree with summary(): lit share, Earth share and longest runs', () => {
    const s = summary(samples);
    const total = samples.length * HOUR;
    const share = (list: ReturnType<typeof periods>): number =>
      (100 * list.filter((x) => x.up).reduce((a, x) => a + x.endMs - x.startMs, 0)) / total;
    const longest = (list: ReturnType<typeof periods>, up: boolean): number =>
      Math.max(0, ...list.filter((x) => x.up === up).map((x) => (x.endMs - x.startMs) / HOUR));
    const sun = periods(samples, 'sun');
    const earth = periods(samples, 'earth');
    expect(share(sun)).toBeCloseTo(s.litPct, 9);
    expect(share(earth)).toBeCloseTo(s.earthPct, 9);
    expect(longest(sun, true)).toBe(s.longestLit_h);
    expect(longest(sun, false)).toBe(s.longestDark_h);
    expect(longest(earth, false)).toBe(s.longestEarthGap_h);
  });

  it('none from no samples', () => {
    expect(periods([], 'sun')).toEqual([]);
  });
});

describe('file names', () => {
  it('use the curated site\'s id and the touchdown to the minute', () => {
    expect(reportFileName(report, 'json')).toBe('darksight-mission-shackleton-rim-2026-11-21T1604Z.json');
    expect(reportFileName(report, 'csv')).toBe('darksight-mission-shackleton-rim-2026-11-21T1604Z.csv');
  });

  it('use the coordinates for a site with no id', () => {
    const r = buildReport(p, ctx({ site: { id: null, name: 'Scenario A', ...SITE } }));
    expect(reportFileName(r, 'csv')).toBe('darksight-mission-89.6866S-162.8100W-2026-11-21T1604Z.csv');
  });
});

describe('model and sources', () => {
  it('names GMAT as the next step, in the limits and the sources', () => {
    expect(report.model.some((l) => l.includes('GMAT'))).toBe(true);
    expect(report.sources.some((s) => s.name.includes('GMAT') && s.url.startsWith('https://'))).toBe(true);
  });
});
