# T42: Date search: the first date with enough sunlight and Earth

Status: in progress (MarsRon, branch `t42-date-search`, draft pull request open). Next: `core/datesearch.ts` and its tests

| | |
|---|---|
| Tier | if time |
| Waits for | M2 (passed). Only if it can merge before the M3 freeze; not after it |
| Branch | `t42-date-search` |

## Goal

Today the page answers "what is it like here, at this time?". A mission planner usually asks the
reverse: "when, in the next few months, is it good enough here?". Someone has to drag the timeline
or step the date by hand to find out. Add a search in `core/` that scans the next N months for the
first date meeting a sunlight-and-Earth threshold, and a button for it in the Scenarios panel that
moves the live scenario to that date.

`core/windows.ts` already has what's needed: `series()` gives hourly samples with `sunFrac` and
`earthUp`, and `nextFlip()` refines an edge to under a minute. The search is built on those two;
it doesn't compute Sun or Earth angles itself.

## Model

- `core/datesearch.ts` (new): something like
  `firstWindow(eph, site, groundM, skyline, startMs, months, need): Window | null`, where `need`
  is the threshold and `Window` is `{ startMs, endMs }`. Agree the names and the threshold in the
  pull request. A proposal:
  - **Threshold:** the Sun up (any of its disc showing, as the countdowns count it) and Earth up,
    both at once, without a break for at least `minHours` (for example 24, 48, 96 h). Options to
    require only the Sun, or only Earth.
  - **Answer:** the start of the first such run at or after `startMs` that begins before
    `startMs + months`. Its start is refined to under a minute with `nextFlip()` (or the same
    halving), so it agrees with the countdowns. `endMs` is where the run ends, even if that is
    past the scan's end.
  - A run already going on at `startMs` counts from `startMs`, and its remaining length is what
    must reach `minHours`.
- Hourly samples, as the compare table uses. Twelve months is about 8,800 samples: measure it on
  the real data. If it takes more than about 50 ms on a phone, scan in slices between frames as
  `state.ts`'s never-lit scan does (`LIT_SCAN_SLICE_HOURS`).
- **Missing rows.** A decade that isn't loaded gives NaN rows. The search must never treat NaN as
  "hidden" and carry on: it stops there and says how far it got, or `state.ts` loads the decade
  first, the way a scenario's time does. Agree which in the pull request. The end of the table
  (2100) is a plain stop: "no window before 2100".
- Pure function, no DOM. Every number shown comes from it.

## What the user sees

- In the Scenarios panel, under the live scenario's time: **"Find a date"**, with the threshold
  (hours of Sun and Earth together; Sun only / Earth only / both) and how far to look
  (1, 3, 6, 12 months). Agree the choices and the defaults in the pull request.
- Pressing it moves the live scenario's time to the window's start through `setLiveTime`, as a
  typed time does. Pinned scenarios don't change. The line under the button says
  "Sun and Earth together for 3 d 4 h from 12 Mar 2027 06:40 UTC", worded with the same duration
  text as the countdowns.
- None found: "No 48 h window of Sun and Earth together in the next 6 months". The time doesn't
  move.
- While it scans: "Searching…", and the button can't be pressed twice. While `eph` is null the
  button says "Loading" and does nothing.
- Undo is the browser's own: nothing new. (T13's Undo is for nudges only.)

## Files in scope

- `web/src/core/datesearch.ts`, `datesearch.test.ts` (new)
- `web/src/ui/scenarios/` (`index.ts`, `input.ts`, `input.test.ts`, `scenarios.css`)
- `web/src/state.ts`, `state.test.ts`, only if the search runs in slices or loads decades. Keep it
  out of `state.ts` if you can
- `docs/data-contract.md` (section 3, the new function and its row in the table); `SPEC.md` (a new
  feature row, F22, if time); `history.md`
- `docs/ai-use/T42.md`, `docs/sources/T42.md`, this file's `Status:` line

## Done when

- [ ] Tests on the mock or a synthetic table: a site lit and in view all the time gives a window
      starting at `startMs`; a site never lit gives null; a threshold longer than any run gives
      null; the window's start agrees with `nextFlip()`'s sunrise (or Earthrise) to one minute;
      a run that starts inside the scan but ends after it is still found.
- [ ] A test with a missing decade: the search does not report a window inside the NaN rows.
- [ ] On real data (skips on mock): from 15 Nov 2026 at `shackleton-rim`, a 48 h Sun-and-Earth
      search over 6 months finds a window, and the countdowns at that time say the Sun and Earth
      are both up; at `shackleton-floor` it finds none.
- [ ] In the browser: the button moves the live time, the readout, strips, timeline and 3D follow,
      and no console errors. The scan time on the real data, 12 months, is written in the pull
      request.
- [ ] No colour code, font or pixel size in the module; at 1280 and 390 px wide nothing overlaps
      or scrolls sideways.
- [ ] `npm test` and `npm run build` pass.

## Notes

T23 may be polishing `scenarios.css`, and T40 (pull request #164) edits `state.ts`: agree an
order. Not in scope: searching several sites at once, a list of every window (only the first),
a search backwards in time, ranking dates by score.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T42-date-search.md. Do only that task, on branch t42-date-search. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
