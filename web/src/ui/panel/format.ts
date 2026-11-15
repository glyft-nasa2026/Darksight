// How the panel writes the fractions core/panel.ts gives it. Pure, tested in node.

/** A 0..1 fraction of full power as a whole percentage. A sliver of power never reads 0 %. */
export function powerText(frac: number): string {
  if (!(frac > 0)) return '0 %';
  const p = Math.round(Math.min(1, frac) * 100);
  return p === 0 ? 'under 1 %' : `${p} %`;
}

/** Hours as "40 h", or "3.5 days" from two days up; "for ever" for Infinity (no load). */
export function hoursText(h: number): string {
  if (h === Infinity) return 'for ever';
  if (h < 48) return `${h < 10 ? Number(h.toFixed(1)) : Math.round(h)} h`;
  return `${Math.round((h / 24) * 2) / 2} days`;
}

/** A 0..1 charge as a whole percentage, never "0 %" or "100 %" unless it is. */
export function chargeText(frac: number): string {
  if (!(frac > 0)) return '0 %';
  if (frac >= 1) return '100 %';
  return `${Math.min(99, Math.max(1, Math.round(frac * 100)))} %`;
}
