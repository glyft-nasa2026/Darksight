// Text for the mission card (T34). Formatting only: every number comes from core/mission.ts
// or the state.ts accessors; nothing here computes an angle, a speed or a mass.

const group = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const pad2 = (n: number): string => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-17 09:24" (UTC, to the minute). */
export function utcText(tMs: number): string {
  return new Date(tMs).toISOString().slice(0, 16).replace('T', ' ');
}

/** "11-17 09:24": the table's start column, where the year is the header's. */
export function shortUtcText(tMs: number): string {
  return new Date(tMs).toISOString().slice(5, 16).replace('T', ' ');
}

/** "17 Nov · 09:24 UTC": the flight-sequence cards. */
export function dayText(tMs: number): string {
  const d = new Date(tMs);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** A length of time: "47 s", "11 min 39 s", "2 h 33 min", "3 d 1 h". */
export function durationText(s: number): string {
  const t = Math.round(s);
  if (t < 60) return `${t} s`;
  if (t < 3600) return `${Math.floor(t / 60)} min ${t % 60} s`;
  const m = Math.round(t / 60);
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  const h = Math.round(t / 3600);
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Mission elapsed time: "T+ 1 d 18:44:05", or "T+ 18:44:05" in the first day. */
export function elapsedText(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const d = Math.floor(t / 86400);
  const clock = `${pad2(Math.floor((t % 86400) / 3600))}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
  return d > 0 ? `T+ ${d} d ${clock}` : `T+ ${clock}`;
}

/** A change in speed: "3.15 km/s", "0.91 km/s", "6 m/s" under 0.1 km/s. */
export function dvText(kmS: number): string {
  return kmS < 0.1 ? `${Math.round(kmS * 1000)} m/s` : `${kmS.toFixed(2)} km/s`;
}

/** A speed: "1.115 km/s", "938 m/s" under 1 km/s, "0.6 m/s" under 10 m/s. */
export function speedText(kmS: number): string {
  if (kmS >= 1) return `${kmS.toFixed(3)} km/s`;
  const m = kmS * 1000;
  return m >= 10 ? `${Math.round(m)} m/s` : `${m.toFixed(1)} m/s`;
}

/** An altitude or distance: "272,971 km", "74.4 km", "420 m" under 1 km. */
export function kmText(km: number): string {
  if (km >= 1000) return `${group.format(km)} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 1000)} m`;
}

/** A mass: "1,908 kg". */
export function kgText(kg: number): string {
  return `${group.format(kg)} kg`;
}

/** A share: "7 %". */
export function pctText(fraction: number): string {
  return `${Math.round(fraction * 100)} %`;
}

/** "89.6866° S · 162.8100° W": latitude north-positive, longitude east-positive in the data. */
export function coordText(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'} · ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;
}
