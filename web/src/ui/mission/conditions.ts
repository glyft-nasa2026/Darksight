// The landing site's numbers at touchdown, and the mission's warnings: one place for the mission
// card (T34) and the mission report (T35), so the two can't disagree. Read from the same state.ts
// accessors as the readout; formatting only, nothing computed here.
import type { OkPlan } from '../../core/mission';
import type { LandingConditions, ReportWarning } from '../../core/report';
import { countdownText } from '../../core/windows';
import {
  flipFor, neverLitFor, neverLitPendingFor, samplesFor, skylineFor, summaryFor, type Scenario,
} from '../../state';
import { kgText, pctText, utcText } from './format';

/** The landing site at touchdown, or 'loading' while its hours are still on their way. */
export function landingConditions(sc: Scenario): LandingConditions | 'loading' {
  const now = samplesFor(sc, '30d')[0];
  if (!now || now.tMs !== sc.tMs) return 'loading';
  const sunUp = now.sunFrac > 0;
  const sunFlip = flipFor(sc, 'sun');
  const earthFlip = flipFor(sc, 'earth');
  return {
    sun: { up: sunUp, altDeg: now.sun.alt, azDeg: now.sun.az, aboveSkylineDeg: now.sunAbove, discFrac: now.sunFrac },
    earth: { up: now.earthUp, altDeg: now.earth.alt, azDeg: now.earth.az, aboveSkylineDeg: now.earthAbove },
    sunFlip,
    earthFlip,
    sunText: countdownText('sun', sunUp, sunFlip, sc.tMs, neverLitFor(sc), neverLitPendingFor(sc)),
    earthText: countdownText('earth', now.earthUp, earthFlip, sc.tMs),
    summary: summaryFor(sc),
    terrain: skylineFor(sc).terrain,
  };
}

/** The card's "At the landing site" lines: [label, value]. */
export function conditionStats(c: LandingConditions): [string, string][] {
  return [
    ['Sun', c.sun.up ? `Up ${c.sun.altDeg.toFixed(1)}° · ${pctText(c.sun.discFrac)} of disc` : 'Below the skyline'],
    ['Earth', c.earth.up ? `Up ${c.earth.altDeg.toFixed(1)}°` : 'Hidden'],
    ['Working period', c.sunText],
    ['Earth link', c.earthText],
    ['Lit, next 30 days', `${c.summary.litPct.toFixed(0)} %`],
    ['Earth contact, 30 days', `${c.summary.earthPct.toFixed(1)} %`],
  ];
}

/** The card's warnings, in its words: darkness, Earth hidden, not enough propellant. */
export function missionWarnings(plan: OkPlan | null, c: LandingConditions | 'loading' | null): ReportWarning[] {
  const out: ReportWarning[] = [];
  if (c && c !== 'loading') {
    if (!c.sun.up) out.push({ code: 'dark-touchdown', level: 'warn', text: 'Touchdown in darkness: the Sun is below the skyline there.' });
    if (!c.earth.up) out.push({ code: 'earth-hidden', level: 'warn', text: 'Earth is hidden at touchdown: no direct radio link.' });
  }
  if (plan && plan.runsOutMs !== null) {
    out.push({
      code: 'propellant', level: 'bad',
      text: `Not enough propellant: short by ${kgText(-plan.totals.propellantLeftKg)}. The lander runs dry at ${utcText(plan.runsOutMs)} UTC.`,
    });
  }
  return out;
}
