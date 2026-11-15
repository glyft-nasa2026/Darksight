// The mission report (T35): the plan T34 made, as plain data for the report page and the two
// downloads. Pure functions, no DOM. Every number comes from core/mission.ts (the plan and
// missionAt) or from the landing-site numbers the mission card shows (ui/mission/conditions.ts),
// passed in; nothing here works out an angle or a mass of its own.
//
// Units: times in ms since 1970 (UTC) inside the report, ISO 8601 with Z in the files; Δv and
// speeds in km/s inside, m/s in the files; altitudes and distances in km; masses in kg.
import { ASCENT_LOSSES_KMS, HIGH_GATE_KM, LOW_GATE_KM,
  APOLLO_11_TIMES, approachSeconds, DESCENT_START_ALT_KM, EXAMPLE_LANDER, missionAt,
  type Lander, type MissionTimes, type OkPlan, type Step, type StepId,
} from './mission';
import type { Pad } from './pads';
import type { Body, Flip, Sample, Summary } from './types';

export const REPORT_SCHEMA = 'darksight-mission-report/1';

/** Each step's plain name, for the report, the CSV and the mission card. */
export const PHASE_NAMES: Record<StepId, string> = {
  launch: 'Launch', parking: 'Parking orbit', tli: 'Translunar injection', coast: 'Translunar coast',
  loi: 'Lunar orbit insertion', 'lunar-orbit': 'Lunar orbit', doi: 'Descent orbit insertion',
  'descent-orbit': 'Descent orbit', 'powered-descent': 'Powered descent', touchdown: 'Touchdown',
};

/** The model's simplifications, the card's list (tasks/T34-mission.md, Model). */
/** The note on the launch's Δv, on the mission card and in the report (issue #181). */
export const LAUNCH_DV_NOTE =
  `* Includes ${ASCENT_LOSSES_KMS.toFixed(2)} km/s of gravity and drag losses, the middle of the usual 1.5 to 2 km/s; the launch vehicle is not modelled.`;

export const MODEL_LIMITS: readonly string[] = [
  'A planning model, not a flight-dynamics solution.',
  'Patched conics from Earth to the Moon; the Earth–Moon picture is the model’s plane, not an ephemeris track.',
  'Burns are instant, except the powered descent, which is simulated.',
  'A 100 km circular lunar orbit in the plane the arrival leads into, through the site at touchdown; LOI at the arrival’s closest point, so the wait before DOI moves from Apollo 11’s by under half a lap. The Moon keeps longitude 0 towards Earth and its axis upright to the transfer’s plane.',
  `A guided powered descent from 15 km in Apollo’s phases: braking at full thrust to a ${HIGH_GATE_KM} km high gate, an approach on a straight slant to a ${Math.round(LOW_GATE_KM * 1000)} m low gate, then throttled straight down to touchdown (Bennett 1970).`,
  'Phase lengths from Apollo 11 (NASA SP-4029). The launch time is touchdown less the phases: no launch window is solved.',
  'The launch vehicle’s propellant is not modelled. Its Δv includes a cited budget for gravity and drag losses, not a simulated ascent.',
  'No ascent from the Moon and no return to Earth.',
  'The Moon has no atmosphere: no drag, and no refraction of the Sun or Earth.',
  'For a flight-dynamics solution (full gravity, finite burns, targeting, a launch window), take this plan into a tool such as NASA’s General Mission Analysis Tool (GMAT), which is open source.',
];

/** Where the numbers come from (docs/sources/T34.md, docs/sources/T35.md). */
export const REPORT_SOURCES: readonly { name: string; url: string }[] = [
  { name: 'Sun and Earth directions: JPL DE440, via Skyfield', url: 'https://ssd.jpl.nasa.gov/planets/eph_export.html' },
  { name: 'Terrain: LRO LOLA (PDS Geosciences Node)', url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm' },
  { name: 'GM of Earth and the Moon (DE440): JPL Astrodynamic Parameters', url: 'https://ssd.jpl.nasa.gov/astro_par.html' },
  { name: 'Phase lengths: NASA SP-4029, Apollo 11 timeline', url: 'https://www.nasa.gov/wp-content/uploads/static/history/SP-4029/Apollo_11i_Timeline.htm' },
  { name: 'Example lander: Intuitive Machines Nova-C (Isp an example value)', url: 'https://en.wikipedia.org/wiki/Intuitive_Machines_Nova-C' },
  { name: 'Moon’s sidereal rotation: NASA Moon fact sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html' },
  { name: 'The next step, not used for these numbers: NASA General Mission Analysis Tool (GMAT), open source', url: 'https://etd.gsfc.nasa.gov/capabilities/capabilities-listing/general-mission-analysis-tool-gmat/' },
];

// ---------------------------------------------------------------------------------------------
// The landing site's numbers, as the mission card shows them (ui/mission/conditions.ts)
// ---------------------------------------------------------------------------------------------

export type BodyAtTouchdown = {
  up: boolean;
  altDeg: number;
  azDeg: number;
  aboveSkylineDeg: number;   // centre less the skyline at its azimuth
};

export type LandingConditions = {
  sun: BodyAtTouchdown & { discFrac: number };
  earth: BodyAtTouchdown;
  sunFlip: Flip;
  earthFlip: Flip;
  sunText: string;           // countdownText: "Sunset in 48 d 6 h", "Permanently shadowed (until 2100)"
  earthText: string;
  summary: Summary;          // next 30 days
  terrain: boolean;          // the skyline is real terrain, not the smooth Moon
  terrainCellM: number | null;   // T37: the skyline's grid cell, metres (240, about 3790); null for a smooth Moon
  terrainText: string;       // T37: which terrain, in ui/terrain.ts's words ("Coarse terrain: ... 3.8 km cells")
};

export type ReportWarning = { code: string; text: string; level: 'warn' | 'bad' };

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

export type ReportContext = {
  generatedMs: number;
  site: { id: string | null; name: string; lat: number; lon: number };
  pad: Pad;
  padChecked: boolean;               // false for a pad whose coordinates nobody has checked yet
  lander: Lander;
  times?: MissionTimes;              // Apollo 11's when left out, as planMission
  data: { ephemeris: string | null; terrain: string | null };   // the files' "source" lines
  shareLink: string;
  conditions: LandingConditions | null;
  surface: Sample[];                 // hourly from touchdown, 30 days
  warnings: ReportWarning[];         // the card's, in its words
};

export type ReportPhase = {
  n: number;
  id: StepId;
  name: string;
  by: Step['by'];
  startMs: number;
  endMs: number;
  metStartS: number;                 // since launch
  durationS: number;
  dvKmS: number | null;
  burnS: number | null;
  propellantKg: number | null;
  massAfterKg: number | null;
  altKm: number | null;
  body: 'earth' | 'moon' | null;     // where lat and lon are measured; null in flight between
  lat: number | null;
  lon: number | null;
};

export type ReportEventId =
  | 'liftoff' | 'orbit-insertion' | 'tli' | 'soi' | 'loi' | 'doi' | 'pdi' | 'touchdown' | 'runs-out';

export const EVENT_NAMES: Record<ReportEventId, string> = {
  liftoff: 'Liftoff', 'orbit-insertion': 'Earth orbit insertion', tli: 'Translunar injection',
  soi: 'Enters the Moon’s sphere of influence', loi: 'Lunar orbit insertion', doi: 'Descent orbit insertion',
  pdi: 'Powered descent ignition', touchdown: 'Touchdown', 'runs-out': 'Propellant runs out',
};

/** The craft at one moment: what the card's live line shows then. */
export type ReportPoint = {
  tMs: number;
  metS: number;
  near: 'earth' | 'moon';
  altKm: number;
  speedKmS: number;
  propellantLeftKg: number;
};

export type ReportEvent = ReportPoint & { id: ReportEventId; toTouchdownS: number };

export type DescentRow = ReportPoint & { sinceIgnitionS: number; rangeToGoKm: number };

export type SurfacePeriod = { body: Body; up: boolean; startMs: number; endMs: number };

export type Report = {
  schema: typeof REPORT_SCHEMA;
  generatedMs: number;
  mock: boolean;
  data: ReportContext['data'];
  shareLink: string;
  site: ReportContext['site'];
  pad: Pad;
  padChecked: boolean;
  lander: Lander;
  exampleLander: boolean;
  times: MissionTimes;
  apolloTimes: boolean;
  launchMs: number;
  touchdownMs: number;
  durationS: number;
  reached: boolean;                  // false when the propellant runs out first
  phases: ReportPhase[];
  events: ReportEvent[];
  coast: ReportPoint[];
  totals: OkPlan['totals'] & { massAtTouchdownKg: number };
  orbit: OkPlan['orbit'] & { lunarOrbitRevolutions: number; descentStartRaised: boolean };
  descent: {
    startMs: number; durationS: number; dvKmS: number; propellantKg: number;
    rows: DescentRow[];
  };
  conditions: LandingConditions | null;
  surface: SurfacePeriod[];
  warnings: ReportWarning[];
  model: readonly string[];
  sources: readonly { name: string; url: string }[];
};

const isMock = (source: string | null): boolean => source !== null && /mock/i.test(source);

function point(plan: OkPlan, tMs: number): ReportPoint {
  const s = missionAt(plan, tMs);
  return {
    tMs, metS: (tMs - plan.launchMs) / 1000, near: s.near, altKm: s.altKm, speedKmS: s.speedKmS,
    propellantLeftKg: s.propellantLeftKg,
  };
}

/** Every stepS seconds from fromMs, and toMs itself as the last. */
function times(fromMs: number, toMs: number, stepS: number): number[] {
  const out: number[] = [];
  for (let t = fromMs; t < toMs; t += stepS * 1000) out.push(t);
  out.push(toMs);
  return out;
}

/** The powered descent, every stepS seconds from ignition to its end (or where it runs dry). */
export function descentTrack(plan: OkPlan, stepS: number): DescentRow[] {
  const pd = plan.steps.find((s) => s.id === 'powered-descent')!;
  if (plan.runsOutMs !== null && plan.runsOutMs < pd.startMs) return [];   // dry before ignition
  const end = plan.runsOutMs !== null ? Math.min(plan.runsOutMs, pd.endMs) : pd.endMs;
  return times(pd.startMs, end, stepS).map((t) => {
    const s = missionAt(plan, t);
    return { ...point(plan, t), sinceIgnitionS: (t - pd.startMs) / 1000, rangeToGoKm: s.rangeToGoKm ?? 0 };
  });
}

/** The key moments of the flight, in time order. */
export function missionEvents(plan: OkPlan): ReportEvent[] {
  const at = (id: StepId): Step => plan.steps.find((s) => s.id === id)!;
  const list: [ReportEventId, number][] = [
    ['liftoff', plan.launchMs],
    ['orbit-insertion', at('launch').endMs],
    ['tli', at('tli').startMs],
    ['soi', at('loi').startMs - approachSeconds(plan) * 1000],
    ['loi', at('loi').startMs],
    ['doi', at('doi').startMs],
    ['pdi', at('powered-descent').startMs],
    ['touchdown', plan.touchdownMs],
  ];
  if (plan.runsOutMs !== null) list.push(['runs-out', plan.runsOutMs]);
  return list
    .map(([id, t]) => ({ id, ...point(plan, t), toTouchdownS: (plan.touchdownMs - t) / 1000 }))
    .sort((a, b) => a.tMs - b.tMs);
}

/** The translunar coast every stepH hours from TLI, and at LOI. */
export function coastTrack(plan: OkPlan, stepH = 12): ReportPoint[] {
  const coast = plan.steps.find((s) => s.id === 'coast')!;
  return times(coast.startMs, coast.endMs, stepH * 3600).map((t) => point(plan, t));
}

/**
 * Up and down periods from evenly spaced samples, with summary()'s rules (core/windows.ts): the
 * Sun is up when any of its disc clears the skyline, Earth when earthUp. Each sample stands for
 * one step from its own time, so the periods cover the samples' span with no gap or overlap.
 */
export function periods(samples: Sample[], body: Body): SurfacePeriod[] {
  if (samples.length === 0) return [];
  const stepMs = samples.length > 1 ? samples[1].tMs - samples[0].tMs : 3600_000;
  const upAt = (s: Sample): boolean => (body === 'sun' ? s.sunFrac > 0 : s.earthUp);
  const out: SurfacePeriod[] = [];
  for (const s of samples) {
    const up = upAt(s);
    const last = out[out.length - 1];
    if (last && last.up === up) last.endMs = s.tMs + stepMs;
    else out.push({ body, up, startMs: s.tMs, endMs: s.tMs + stepMs });
  }
  return out;
}

const sameLander = (a: Lander, b: Lander): boolean =>
  a.massKg === b.massKg && a.dryKg === b.dryKg && a.ispS === b.ispS && a.thrustN === b.thrustN;
const sameTimes = (a: MissionTimes, b: MissionTimes): boolean =>
  a.ascentS === b.ascentS && a.parkingS === b.parkingS && a.coastS === b.coastS && a.lunarOrbitS === b.lunarOrbitS;

function phaseOf(plan: OkPlan, s: Step, i: number, ctx: ReportContext): ReportPhase {
  let body: ReportPhase['body'] = null;
  let lat: number | null = null;
  let lon: number | null = null;
  if (s.id === 'launch') {
    body = 'earth'; lat = ctx.pad.lat; lon = ctx.pad.lon;
  } else if (s.id === 'touchdown') {
    body = 'moon'; lat = ctx.site.lat; lon = ctx.site.lon;
  } else if (['loi', 'lunar-orbit', 'doi', 'descent-orbit', 'powered-descent'].includes(s.id)) {
    const g = missionAt(plan, s.startMs).ground;
    if (g) { body = 'moon'; lat = g.lat; lon = g.lon; }
  }
  return {
    n: i + 1, id: s.id, name: PHASE_NAMES[s.id], by: s.by, startMs: s.startMs, endMs: s.endMs,
    metStartS: (s.startMs - plan.launchMs) / 1000, durationS: (s.endMs - s.startMs) / 1000,
    dvKmS: s.dvKmS, burnS: s.burnS, propellantKg: s.propellantKg, massAfterKg: s.massAfterKg, altKm: s.altKm,
    body, lat, lon,
  };
}

/** The report as plain data, from a plan and what the page knows about it. */
export function buildReport(plan: OkPlan, ctx: ReportContext): Report {
  const times = ctx.times ?? APOLLO_11_TIMES;
  const td = plan.steps[plan.steps.length - 1];
  const lunar = plan.steps.find((s) => s.id === 'lunar-orbit')!;
  const pd = plan.steps.find((s) => s.id === 'powered-descent')!;
  return {
    schema: REPORT_SCHEMA,
    generatedMs: ctx.generatedMs,
    mock: isMock(ctx.data.ephemeris) || isMock(ctx.data.terrain),
    data: { ...ctx.data },
    shareLink: ctx.shareLink,
    site: { ...ctx.site },
    pad: { ...ctx.pad },
    padChecked: ctx.padChecked,
    lander: { ...ctx.lander },
    exampleLander: sameLander(ctx.lander, EXAMPLE_LANDER),
    times: { ...times },
    apolloTimes: sameTimes(times, APOLLO_11_TIMES),
    launchMs: plan.launchMs,
    touchdownMs: plan.touchdownMs,
    durationS: (plan.touchdownMs - plan.launchMs) / 1000,
    reached: plan.runsOutMs === null,
    phases: plan.steps.map((s, i) => phaseOf(plan, s, i, ctx)),
    events: missionEvents(plan),
    coast: coastTrack(plan),
    totals: { ...plan.totals, massAtTouchdownKg: td.massAfterKg ?? Number.NaN },
    orbit: {
      ...plan.orbit,
      lunarOrbitRevolutions: (lunar.endMs - lunar.startMs) / 1000 / plan.orbit.lunarOrbitPeriodS,
      descentStartRaised: plan.orbit.descentStartAltKm > DESCENT_START_ALT_KM + 1e-9,
    },
    descent: {
      startMs: pd.startMs, durationS: (pd.endMs - pd.startMs) / 1000, dvKmS: pd.dvKmS ?? 0,
      propellantKg: pd.propellantKg ?? 0, rows: descentTrack(plan, 30),
    },
    conditions: ctx.conditions,
    surface: [...periods(ctx.surface, 'sun'), ...periods(ctx.surface, 'earth')],
    warnings: [...ctx.warnings],
    model: MODEL_LIMITS,
    sources: REPORT_SOURCES,
  };
}

// ---------------------------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------------------------

const iso = (tMs: number): string => new Date(tMs).toISOString();
const ms = (kmS: number | null): number | null => (kmS === null ? null : kmS * 1000);

function pointJson(p: ReportPoint): Record<string, unknown> {
  return {
    utc: iso(p.tMs), met_s: p.metS, near: p.near, alt_km: p.altKm, speed_ms: p.speedKmS * 1000,
    propellant_left_kg: p.propellantLeftKg,
  };
}

const flipJson = (f: Flip): Record<string, unknown> | null => (f ? { type: f.type, utc: iso(f.tMs) } : null);

/** The whole report as the JSON download (schema in docs/data-contract.md). */
export function reportJson(r: Report): string {
  const c = r.conditions;
  const o = r.orbit;
  const doc = {
    schema: r.schema,
    generated_utc: iso(r.generatedMs),
    data: { ephemeris: r.data.ephemeris, terrain: r.data.terrain, mock: r.mock },
    share_link: r.shareLink,
    site: { id: r.site.id, name: r.site.name, lat_deg: r.site.lat, lon_deg: r.site.lon },
    pad: { id: r.pad.id, name: r.pad.name, pad: r.pad.pad, country: r.pad.country, lat_deg: r.pad.lat, lon_deg: r.pad.lon, checked: r.padChecked },
    lander: {
      mass_after_tli_kg: r.lander.massKg, dry_mass_kg: r.lander.dryKg, isp_s: r.lander.ispS, thrust_n: r.lander.thrustN,
      example: r.exampleLander,
    },
    phase_times_s: {
      ascent: r.times.ascentS, parking_orbit: r.times.parkingS, translunar_coast: r.times.coastS,
      lunar_orbit: r.times.lunarOrbitS, apollo_11: r.apolloTimes,
    },
    launch_utc: iso(r.launchMs),
    touchdown_utc: iso(r.touchdownMs),
    duration_s: r.durationS,
    touchdown_reached: r.reached,
    phases: r.phases.map((p) => ({
      n: p.n, id: p.id, name: p.name, by: p.by, start_utc: iso(p.startMs), end_utc: iso(p.endMs),
      met_start_s: p.metStartS, duration_s: p.durationS, dv_ms: ms(p.dvKmS), burn_s: p.burnS,
      propellant_kg: p.propellantKg, mass_after_kg: p.massAfterKg, alt_km: p.altKm,
      body: p.body, lat_deg: p.lat, lon_deg: p.lon,
    })),
    events: r.events.map((e) => ({ id: e.id, name: EVENT_NAMES[e.id], ...pointJson(e), to_touchdown_s: e.toTouchdownS })),
    coast: r.coast.map(pointJson),
    totals: {
      launch_vehicle_dv_ms: r.totals.launchVehicleDvKmS * 1000, lander_dv_ms: r.totals.landerDvKmS * 1000,
      propellant_loaded_kg: r.totals.propellantLoadedKg, propellant_used_kg: r.totals.propellantUsedKg,
      propellant_left_kg: r.totals.propellantLeftKg, margin_pct: r.totals.margin * 100,
      mass_at_touchdown_kg: r.totals.massAtTouchdownKg,
    },
    orbit: {
      parking_alt_km: o.parkingAltKm, parking_inc_deg: o.parkingIncDeg, transfer_apogee_km: o.transferApogeeKm,
      v_inf_ms: o.vInfKmS * 1000, earth_moon_km: o.earthMoonKm, coast_s: o.coastS,
      lunar_orbit_alt_km: o.lunarOrbitAltKm, lunar_orbit_inc_deg: o.lunarOrbitIncDeg,
      lunar_orbit_period_s: o.lunarOrbitPeriodS, lunar_orbit_revolutions: o.lunarOrbitRevolutions,
      descent_start_alt_km: o.descentStartAltKm, descent_start_raised: o.descentStartRaised,
      throttle_pct: o.throttle * 100, descent_range_km: o.descentRangeKm, touchdown_speed_ms: o.touchdownSpeedKmS * 1000,
    },
    descent: {
      start_utc: iso(r.descent.startMs), duration_s: r.descent.durationS, dv_ms: r.descent.dvKmS * 1000,
      propellant_kg: r.descent.propellantKg,
      samples: r.descent.rows.map((d) => ({
        t_s: d.sinceIgnitionS, utc: iso(d.tMs), alt_km: d.altKm, speed_ms: d.speedKmS * 1000,
        range_to_go_km: d.rangeToGoKm, propellant_left_kg: d.propellantLeftKg,
      })),
    },
    site_at_touchdown: c ? {
      sun: {
        alt_deg: c.sun.altDeg, az_deg: c.sun.azDeg, above_skyline_deg: c.sun.aboveSkylineDeg,
        disc_visible_pct: c.sun.discFrac * 100, up: c.sun.up,
      },
      earth: { alt_deg: c.earth.altDeg, az_deg: c.earth.azDeg, above_skyline_deg: c.earth.aboveSkylineDeg, visible: c.earth.up },
      next_sun_flip: flipJson(c.sunFlip), next_earth_flip: flipJson(c.earthFlip),
      sun_text: c.sunText, earth_text: c.earthText,
      summary_30d: {
        lit_pct: c.summary.litPct, longest_lit_h: c.summary.longestLit_h, longest_dark_h: c.summary.longestDark_h,
        earth_pct: c.summary.earthPct, longest_earth_gap_h: c.summary.longestEarthGap_h,
      },
      terrain_skyline: c.terrain,
      terrain_cell_m: c.terrainCellM,
    } : null,
    surface_periods: r.surface.map((p) => ({
      body: p.body, up: p.up, start_utc: iso(p.startMs), end_utc: iso(p.endMs), duration_s: (p.endMs - p.startMs) / 1000,
    })),
    warnings: r.warnings.map((w) => ({ code: w.code, level: w.level, text: w.text })),
    model: r.model,
    sources: r.sources,
  };
  return JSON.stringify(doc, null, 2);
}

export const CSV_COLUMNS = [
  'n', 'phase_id', 'phase', 'by', 'start_utc', 'end_utc', 'met_start_s', 'duration_s', 'dv_ms', 'burn_s',
  'propellant_kg', 'mass_after_kg', 'alt_km', 'lat_deg', 'lon_deg',
] as const;

const csvCell = (v: string | number | null): string => {
  if (v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The flight schedule as CSV: a header row, then one row per phase. */
export function reportCsv(r: Report): string {
  const rows = r.phases.map((p) => [
    p.n, p.id, p.name, p.by, iso(p.startMs), iso(p.endMs), p.metStartS, p.durationS, ms(p.dvKmS), p.burnS,
    p.propellantKg, p.massAfterKg, p.altKm, p.lat, p.lon,
  ].map(csvCell).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** "89.6866S-162.8100W": a site with no id, in a file name. */
function coordName(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}${lat < 0 ? 'S' : 'N'}-${Math.abs(lon).toFixed(4)}${lon < 0 ? 'W' : 'E'}`;
}

/** darksight-mission-<site>-<touchdown>.<ext>, the touchdown like 2026-11-21T1604Z. */
export function reportFileName(r: Report, ext: 'json' | 'csv'): string {
  const site = r.site.id ?? coordName(r.site.lat, r.site.lon);
  const t = new Date(r.touchdownMs).toISOString();
  const stamp = `${t.slice(0, 13)}${t.slice(14, 16)}Z`;
  return `darksight-mission-${site}-${stamp}.${ext}`;
}
