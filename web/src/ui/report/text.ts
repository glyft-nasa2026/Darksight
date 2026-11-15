// The report's words (T35): formatting only, from the report's plain data (core/report.ts) with
// the mission card's formatters (ui/mission/format.ts). Nothing here computes a number.
import type { Report, ReportPhase } from '../../core/report';
import { coordText, durationText, kgText, kmText, speedText } from '../mission/format';

/** "04:30": minutes and seconds since ignition. */
export function clockText(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** "T− 3 d 1 h", or "Touchdown" at zero. */
export function toTouchdownText(s: number): string {
  return s <= 0 ? 'Touchdown' : `T− ${durationText(s)}`;
}

/** The "where" line under each phase of the schedule. */
export function whereText(p: ReportPhase, r: Report): string {
  const o = r.orbit;
  const over = p.lat !== null && p.lon !== null ? coordText(p.lat, p.lon) : '';
  switch (p.id) {
    case 'launch':
      return `${r.pad.name} · ${r.pad.pad} · ${over} → ${Math.round(o.parkingAltKm)} km orbit, inclined ${o.parkingIncDeg.toFixed(1)}°`;
    case 'parking':
      return `${Math.round(o.parkingAltKm)} km circular, inclined ${o.parkingIncDeg.toFixed(1)}°`;
    case 'tli':
      return `At ${Math.round(o.parkingAltKm)} km · transfer apogee ${kmText(o.transferApogeeKm)}`;
    case 'coast':
      return `Earth to Moon · Earth–Moon ${kmText(o.earthMoonKm)} at arrival · arrives at ${speedText(o.vInfKmS)}`;
    case 'loi':
      return `${Math.round(o.lunarOrbitAltKm)} km lunar orbit, inclined ${o.lunarOrbitIncDeg.toFixed(0)}° · over ${over}`;
    case 'lunar-orbit':
      return `${Math.round(o.lunarOrbitAltKm)} km circular · period ${durationText(o.lunarOrbitPeriodS)} · ${o.lunarOrbitRevolutions.toFixed(1)} revolutions`;
    case 'doi':
      return `At ${Math.round(o.lunarOrbitAltKm)} km · over ${over}`;
    case 'descent-orbit':
      return `${Math.round(o.lunarOrbitAltKm)} × ${kmText(o.descentStartAltKm)} ellipse, half a revolution`;
    case 'powered-descent':
      return `From ${kmText(o.descentStartAltKm)} over ${over} · ${kmText(o.descentRangeKm)} to the site`;
    case 'touchdown':
      return r.reached ? `At the site, ${over} · ${speedText(o.touchdownSpeedKmS)}` : 'Not reached: out of propellant';
  }
}

/** One line on the mission's state: the worst first. */
export function statusOf(r: Report): { text: string; level: 'ok' | 'warn' | 'bad' } {
  if (!r.reached) return { text: 'Not enough propellant', level: 'bad' };
  const c = r.conditions;
  if (c && !c.sun.up) return { text: 'Touchdown in darkness', level: 'warn' };
  if (c && !c.earth.up) return { text: 'Earth hidden at touchdown', level: 'warn' };
  return { text: 'Ready', level: 'ok' };
}

export function landerText(r: Report): string {
  const l = r.lander;
  const base = `${kgText(l.massKg)} after TLI · ${kgText(l.dryKg)} dry · Isp ${l.ispS} s · thrust ${new Intl.NumberFormat('en-US').format(l.thrustN)} N`;
  return r.exampleLander ? `${base} (example lander, about Nova-C’s size; the Isp is an example value)` : base;
}

export function phaseTimesText(r: Report): string {
  const t = r.times;
  const base = `ascent ${durationText(t.ascentS)} · parking orbit ${durationText(t.parkingS)} · coast ${durationText(t.coastS)} · lunar orbit ${durationText(t.lunarOrbitS)}`;
  return r.apolloTimes ? `${base} (Apollo 11’s, NASA SP-4029)` : base;
}

export function dataText(r: Report): string {
  return r.mock ? 'mock data: the numbers are examples' : 'JPL DE440 and LRO LOLA';
}

/** "Mission report · Shackleton rim · touchdown 2026-11-21 16:04 UTC": each printed page's header. */
export function pageTitle(r: Report, touchdownUtc: string): string {
  return `Darksight mission report · ${r.site.name} · touchdown ${touchdownUtc} UTC`;
}
