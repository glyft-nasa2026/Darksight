// Pure helpers for the main page and the loading screen (docs/design/hero.png, loading.png).
// No DOM here, so they can be tested in node.

export type FileState = 'loading' | 'ok' | 'missing';

/** Where each data file stands, as main.ts tracks it. */
export interface LoadProgress {
  eph: FileState;
  sites: FileState;
  dem: FileState;
  /** Share of the height map downloaded so far, 0 to 1. */
  demFraction: number;
}

// The loading screen waits for the two files the numbers need: the Sun and Earth table and the
// site list. The 12.8 MB height map is not one of them: until it arrives the site gives the
// smooth-Moon answer and the page's status line shows how far the height map is (T27 step 3).
// The table carries most of the bar because it is the larger of the two.
const WEIGHTS = { eph: 0.8, sites: 0.2 } as const;

/** How full the loading bar is, 0 to 1. A file that failed counts as finished. */
export function loadFraction(p: LoadProgress): number {
  const part = (s: FileState): number => (s === 'loading' ? 0 : 1);
  return WEIGHTS.eph * part(p.eph) + WEIGHTS.sites * part(p.sites);
}

/** True once the Sun and Earth table and the site list have loaded or failed, whatever the height map is doing. */
export function readyToOpen(p: LoadProgress): boolean {
  return p.eph !== 'loading' && p.sites !== 'loading';
}

// A page opened before a deploy can't load the site's code after it: the code's files are
// renamed (their names carry a hash of their contents), and the host answers an old name with the
// page itself. The page then reloads itself once and opens straight on the loading screen. What
// it remembers across that reload (in sessionStorage) is a reload mark.

/** When the page last reloaded itself, and whether the reloaded page has opened on the loading screen yet. */
export interface ReloadMark {
  at: number;
  resumed: boolean;
}

/** A second failure this soon after a reload asks the visitor instead: no reload loop. */
export const RELOAD_WINDOW_MS = 60_000;

/** The mark as stored, or null if there is none or it is not one. */
export function parseReloadMark(text: string | null): ReloadMark | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as Partial<ReloadMark>;
    return typeof m.at === 'number' && typeof m.resumed === 'boolean' ? { at: m.at, resumed: m.resumed } : null;
  } catch {
    return null;
  }
}

/** True if the site's code failed and the page may reload itself: not twice within RELOAD_WINDOW_MS. */
export function mayReload(mark: ReloadMark | null, now: number): boolean {
  return mark === null || !(now - mark.at >= 0 && now - mark.at < RELOAD_WINDOW_MS);
}

/** True if this page is the reload a failure just made, and should open on the loading screen. */
export function resumeAfterReload(mark: ReloadMark | null, now: number): boolean {
  return mark !== null && !mark.resumed && now - mark.at >= 0 && now - mark.at < RELOAD_WINDOW_MS;
}
