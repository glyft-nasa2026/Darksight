// The telemetry table's text, one row per step, shared by the mission card (T34) and the mission
// report (T35). Takes a plan step or a report phase: both carry the same numbers, so a test can
// check that the report prints what the card shows. Formatting only.
import type { OkPlan, Step, StepId } from '../../core/mission';
import { PHASE_NAMES } from '../../core/report';
import { durationText, dvText, kgText, kmText, pctText } from './format';

type StepLike = Pick<Step, 'id' | 'startMs' | 'endMs' | 'by' | 'dvKmS' | 'burnS' | 'propellantKg' | 'massAfterKg'>;
type OrbitLike = Pick<OkPlan['orbit'], 'parkingAltKm' | 'lunarOrbitAltKm' | 'descentStartAltKm'>;
type TotalsLike = Pick<OkPlan['totals'], 'landerDvKmS' | 'propellantUsedKg' | 'propellantLeftKg' | 'margin'>;

/** "Launch, to 185 km", "Lunar orbit, 100 km", "Descent orbit, to 15.0 km", or the plain name. */
export function stepName(id: StepId, orbit: OrbitLike): string {
  if (id === 'launch') return `Launch, to ${Math.round(orbit.parkingAltKm)} km`;
  if (id === 'lunar-orbit') return `Lunar orbit, ${Math.round(orbit.lunarOrbitAltKm)} km`;
  if (id === 'descent-orbit') return `Descent orbit, to ${kmText(orbit.descentStartAltKm)}`;
  return PHASE_NAMES[id];
}

export type StepCells = { name: string; takes: string; dv: string; burn: string; propellant: string; massAfter: string };

/** One step's cells as the card's table shows them. */
export function stepCells(s: StepLike, orbit: OrbitLike): StepCells {
  return {
    name: stepName(s.id, orbit),
    takes: s.endMs > s.startMs ? durationText((s.endMs - s.startMs) / 1000) : '—',
    dv: s.dvKmS === null ? '—' : `${dvText(s.dvKmS)}${s.id === 'launch' ? '*' : ''}`,
    burn: s.by === 'launch vehicle' ? 'launch vehicle' : s.burnS === null ? '—' : durationText(s.burnS),
    propellant: s.propellantKg === null ? '—' : kgText(s.propellantKg),
    massAfter: s.massAfterKg === null ? '—' : kgText(s.massAfterKg),
  };
}

/** The lander's totals line: Δv, propellant used, and left with the margin (or short by). */
export function totalsCells(t: TotalsLike): { dv: string; used: string; left: string; short: boolean } {
  const short = t.propellantLeftKg < 0;
  return {
    dv: dvText(t.landerDvKmS),
    used: kgText(t.propellantUsedKg),
    left: short ? `short by ${kgText(-t.propellantLeftKg)}` : `${kgText(t.propellantLeftKg)} left · ${pctText(t.margin)}`,
    short,
  };
}
