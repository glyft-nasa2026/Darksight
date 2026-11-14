// The Horizons badge (T16): reads web/public/data/validation.json (made by T03, contract
// section 2) into one of three states. Pure functions, no DOM: about.test.ts runs them in node.

export type HorizonsCheck =
  | { state: 'real'; maxDiffDeg: number; toleranceDeg: number; cases: number; checkedAt: string }
  | { state: 'pending' }
  | { state: 'unavailable'; reason: string };

/** Turns the parsed file into a state. Anything malformed reads as unavailable, never a crash. */
export function readValidation(json: unknown): HorizonsCheck {
  if (!json || typeof json !== 'object') return { state: 'unavailable', reason: 'not a JSON object' };
  const v = json as Record<string, unknown>;
  // Mock data (T20) says so with checked_at null (contract section 2).
  if (v.checked_at === null) return { state: 'pending' };
  if (typeof v.checked_at !== 'string') return { state: 'unavailable', reason: 'no checked_at' };
  const max = v.max_diff_deg;
  const tol = v.tolerance_deg;
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 0) {
    return { state: 'unavailable', reason: 'no max_diff_deg' };
  }
  return {
    state: 'real',
    maxDiffDeg: max,
    toleranceDeg: typeof tol === 'number' && Number.isFinite(tol) ? tol : NaN,
    cases: Array.isArray(v.cases) ? v.cases.length : 0,
    checkedAt: v.checked_at,
  };
}

/**
 * Degrees written out in full, never as 1e-6: up to 12 decimals, so a value stored with six
 * decimals (T03 writes six) reads back as the same number.
 */
export function formatDeg(x: number): string {
  return x.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
}

/** The short text in the bar, as in docs/design/about.png. */
export function badgeText(c: HorizonsCheck): string {
  if (c.state === 'pending') return 'Horizons check pending';
  if (c.state === 'unavailable') return 'Horizons check unavailable';
  return `Checked against JPL Horizons · ${formatDeg(c.maxDiffDeg)}°`;
}

/** The full sentence (spec F13), for the badge's tooltip and screen readers, and the panel. */
export function badgeSentence(c: HorizonsCheck): string {
  if (c.state === 'pending') return 'Horizons check pending: this build uses mock data.';
  if (c.state === 'unavailable') return `Horizons check unavailable (${c.reason}).`;
  return `Checked against JPL Horizons: largest difference ${formatDeg(c.maxDiffDeg)} degrees.`;
}
