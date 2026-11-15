// T35: the report prints the mission card's numbers. Both are built from one plan here: the card's
// table cells from the plan's steps, the report's from the report's phases; they must match, and
// so must the landing-site lines and warnings, which both take from ui/mission/conditions.ts.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_LANDER, planMission, type OkPlan } from '../../core/mission';
import { padById } from '../../core/pads';
import { buildReport, type LandingConditions } from '../../core/report';
import { stepCells, totalsCells } from '../mission/cells';
import { conditionStats } from '../mission/conditions';
import { clockText, dataText, statusOf, toTouchdownText, whereText } from './text';

const TOUCHDOWN = Date.parse('2026-11-21T16:04:00Z');
const SITE = { lat: -89.6866, lon: -162.81 };

function plan(dryKg = EXAMPLE_LANDER.dryKg): OkPlan {
  const p = planMission({
    site: SITE, touchdownMs: TOUCHDOWN, pad: padById('ksc-39a'), lander: { ...EXAMPLE_LANDER, dryKg }, earthMoonKm: 380_000,
  });
  if (!p.ok) throw new Error(p.error);
  return p;
}

const conditions: LandingConditions = {
  sun: { up: false, altDeg: -0.3, azDeg: 100, aboveSkylineDeg: -1.2, discFrac: 0 },
  earth: { up: true, altDeg: 4.1, azDeg: 8, aboveSkylineDeg: 3 },
  sunFlip: null, earthFlip: null, sunText: 'No sunrise in the next 60 days', earthText: 'Earth always visible',
  summary: { litPct: 0, longestLit_h: 0, longestDark_h: 720, earthPct: 100, longestEarthGap_h: 0 }, terrain: true, terrainCellM: 240,
  terrainText: 'Terrain from LOLA, 240 m cells',
};

const reportOf = (p: OkPlan, ephemeris = 'JPL DE440') => buildReport(p, {
  generatedMs: 0, site: { id: null, name: 'Scenario A', ...SITE }, pad: padById('ksc-39a'), padChecked: true,
  lander: EXAMPLE_LANDER, data: { ephemeris, terrain: 'LOLA' }, shareLink: '', conditions,
  surface: [], warnings: [],
});

describe('the report and the mission card, from one plan', () => {
  const p = plan();
  const r = reportOf(p);

  it('print the same cells for every phase', () => {
    expect(r.phases.length).toBe(p.steps.length);
    for (const [i, s] of p.steps.entries()) expect(stepCells(r.phases[i], r.orbit)).toEqual(stepCells(s, p.orbit));
  });

  it('print the same totals', () => {
    expect(totalsCells(r.totals)).toEqual(totalsCells(p.totals));
  });

  it('print the same landing-site lines', () => {
    expect(conditionStats(r.conditions!)).toEqual(conditionStats(conditions));
  });
});

describe('the report\'s words', () => {
  it('clock and countdown', () => {
    expect(clockText(0)).toBe('00:00');
    expect(clockText(272.4)).toBe('04:32');
    expect(toTouchdownText(0)).toBe('Touchdown');
    expect(toTouchdownText(3600)).toBe('T− 1 h 0 min');
  });

  it('a where line for every phase', () => {
    const r = reportOf(plan());
    for (const ph of r.phases) expect(whereText(ph, r).length).toBeGreaterThan(5);
    expect(whereText(r.phases[0], r)).toContain('Kennedy Space Center');
    expect(whereText(r.phases[r.phases.length - 1], r)).toContain('89.6866° S');
  });

  it('status: dark touchdown, then not enough propellant first', () => {
    expect(statusOf(reportOf(plan()))).toEqual({ text: 'Touchdown in darkness', level: 'warn' });
    const short = reportOf(plan(900));
    expect(statusOf(short).level).toBe('bad');
    expect(whereText(short.phases[short.phases.length - 1], short)).toBe('Not reached: out of propellant');
  });
});

describe('the data line in the title block', () => {
  it('says mock data with mock data, and the real sources otherwise', () => {
    expect(dataText(reportOf(plan(), 'mock'))).toBe('mock data: the numbers are examples');
    expect(dataText(reportOf(plan()))).toBe('JPL DE440 and LRO LOLA');
  });
});
