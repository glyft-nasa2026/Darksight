# T40: Play the timeline

Status: done (P5, pull request #164, merged 15 Nov 2026; the battery boxes keep a value typed beside a rejected one, #189). The "Done when" boxes were not ticked before the merge: "After the merge" says what has been checked since. As P5 asked, Play sits in a "Timeline" tab beside Scenarios in the side card, with the Sun, Earth, communication and battery as it plays; the solar panel card gains the battery inputs (`core/battery.ts`).

| | |
|---|---|
| Tier | if time |
| Waits for | M2 (passed). Not after the M3 freeze |
| Branch | `t40-timeline-play` |

## Goal

The challenge statement: "You may consider creating animations or timeline views that show how
Sun and Earth positions change over a lunar day or across multiple days." The timeline (F8) covers
this when someone drags it, but nothing plays by itself: a viewer, or the demo video, has to drag.
Add Play and Pause to the timeline. The live time moves forward at a chosen speed, and the readout,
strips, sky panorama and 3D shadows follow it exactly as they follow a drag.

## Behaviour

- A Play/Pause button and a speed choice go in the timeline's button row, for example 1 h/s,
  6 h/s and 1 day/s. Agree the speeds in the pull request.
- Play moves the live scenario's time through `setLiveTime`, as a drag does. Pinned scenarios never
  change, and playing selects Live, as a drag does.
- At the chart's right edge it pages on, as the "later" button does. At the end of the table it
  stops.
- While a decade file is still loading for the new time, it waits, then carries on. It never shows
  "outside the table" because it ran ahead.
- A drag, a typed time, a nudge or a new site pauses it.
- Time advances by the wall clock. If a frame takes too long, frames are skipped; the speed doesn't
  slow down.
- Nothing plays by itself. With reduced motion on, Play moves one step a second instead of
  gliding.

## Files in scope

- `web/src/ui/timeline/` (`index.ts`, `model.ts`, `model.test.ts`, `timeline.css`)
- `web/src/state.ts`, `state.test.ts`, only if the play state has to be shared (to pause on a
  nudge, for example). Keep it inside the timeline module if you can
- `SPEC.md` F8 (its behaviour gains Play), `history.md`
- `docs/ai-use/T40.md`, `docs/sources/T40.md`, this file's `Status:` line

## Done when

- [ ] Model tests: time advances by speed × elapsed time; a drag, typed time, nudge or new site
      pauses it; it stops at the end of the table; it waits while a decade loads.
- [ ] In the browser: Play at 6 h/s from the crater rim moves the readout, strips, sky marker and 3D
      shadows together, with no console errors.
- [ ] With the site's stored data cleared, playing from 31 Dec 2029 into 1 Jan 2030 waits for the
      decade file and then carries on.
- [ ] Nothing plays by itself; with reduced motion on, Play steps instead of gliding.
- [ ] No colour code, font or pixel size in the module.
- [ ] `npm test` and `npm run build` pass.

## Notes

T23 may be polishing `timeline.css`: agree an order. The mission card's `pace.ts`
(`web/src/ui/mission/`) already changes speed smoothly; reuse it if it fits.

## After the merge

- **Audit before submission (15 Nov 2026, pull request #189), headless Chromium on `main` at
  8c12601 with real data.** Play, pause and the four speeds work. The clock, time box, readout
  and timeline marker agree. A typed time or a selected pin pauses it. In a fresh browser profile
  it plays across 1 Jan 2030 and stops at the end of the table (2100) with a message. With
  reduced motion on it steps (6 moves in 6.9 s). No page errors.
- **Not checked:** the 3D shadows moving with Play ("Done when" line 2), and the speed on an idle
  machine (1.80, 5.29, 10.73 and 15.54 h/s measured for 2, 6, 12 and 24 at load 17: never faster
  than labelled). *cosmetic*

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T40-timeline-play.md. Do only that task, on branch t40-timeline-play. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
