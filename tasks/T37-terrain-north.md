# T37: Terrain skyline north of 85 S

Status: done (Fabian, then MarsRon; pull request #193, merged as `7c463d9`; Compare, the timeline and the report page follow `globe.bin` when it arrives, #207). Option C: `dem.bin` (240 m) at or south of 85 S, `globe.bin` (3.8 km) elsewhere. Every "Done when" line passed on `5ffa690` before the merge (`npm test` 779 passed, `npm run build` passed, CI `test-and-build` and `preview` passed; height map in at 6.97 s on Fast 4G, `docs/load-time.md` section 9). `npx playwright test`: 18 of 20; the two `landing-wide.spec.ts` fails also fail on `main`. The browser checks were done by MarsRon before the merge

| | |
|---|---|
| Tier | if time |
| Waits for | M2 (passed); pull request #146 (it changes the globe and height-map loaders). Both T37 and T33 change `state.ts`: agree an order. Not after the M3 freeze |
| Branch | `t37-terrain-north` |

## Goal

The challenge statement: "Lunar topography data from sources like the Lunar Orbiter Laser
Altimeter (LOLA) can help create realistic surface visualizations and accurate horizon
calculations." The skyline uses real terrain only south of 85 S (`docs/decisions.md`, 14 Nov).
14 of the 20 curated sites get a smooth Moon instead: every Apollo site, Chang'e 4, 5 and 6,
Chandrayaan-3, SLIM, IM-1, Blue Ghost 1, and IM-2 at 84.79 S. The page says so. Give these sites a
terrain skyline too, even a coarse one.

## Options (the team picks one in step 1)

| Option | Terrain reaches | Cost |
|---|---|---|
| A. Skyline from `globe.bin` (2880 × 1440 cells, 0.125° each: 3.8 km at the equator) | The whole Moon | No new download, because the page already fetches it for the pictures. But it is coarse: it catches crater walls and massifs, not a 1 km ridge. The contract says no number comes from `globe.bin` and `core/` never loads it, so that rule changes |
| B. `dem.bin` grows from 80 S to 75 S, from the same LOLA product (`LDEM_75S_240M` reaches 75 S) | 80 S, which puts IM-1 (80.13 S) just inside | At 240 m the file grows from 12.85 MB to about 29 MB; at 480 m it stays near 13 MB but halves the detail at the pole. T27's height-map budget (20 s on Fast 4G) has to pass again |
| C. A everywhere, with today's 240 m grid kept south of 85 S | The whole Moon, at full detail near the pole | The most code: two grids, and a rule for which one a site uses |

## Files in scope

- `web/src/core/horizon.ts`, `horizon.test.ts`; `web/src/core/dem.ts` (option B), or a new reader
  in `core/` for the globe heights (A, C)
- `web/src/state.ts`, `state.test.ts`: which grid a site uses, and where `terrain` is true
- Option B: `data-prep/make_dem.py`, `web/public/data/dem.json`, `dem.bin`
- `docs/data-contract.md` sections 2 and 3; `docs/decisions.md`; `SPEC.md` section 8's "240 m per
  cell" line if the cell size changes; `history.md`
- `web/src/ui/about/index.ts` (the line "Real terrain applies south of 85° S")
- `docs/load-time.md` (a new height-map row, measured with T27's method)
- `docs/ai-use/T37.md`, `docs/sources/T37.md`, this file's `Status:` line

## Steps

1. **Agree the option** in the chat, with the numbers above. Record it in `docs/decisions.md`, and
   the old rule ("Real terrain for any point south of 85 S") in `history.md`.
2. Write the contract first: the grid, its cell size, where `terrain` becomes true, and (for A or
   C) that `core/` may read the globe heights.
3. Code and tests. A coarse grid uses the contract's walk unchanged: the step is the larger of half
   a cell and 1 % of the distance so far.
4. Update the About panel's known limits with the new reach and cell size. A site on a coarse grid
   says so wherever the page names the terrain.
5. Measure the load again with T27's method, and add a row to `docs/load-time.md`.

## Done when

- [x] The team's choice is recorded (step 1).
- [x] A test: a synthetic grid with a ring wall gives the wall's elevation at every azimuth, within
      one cell's worth.
- [x] On real data (skips on mock): Apollo 15's skyline has its highest point above 1°, since Mons
      Hadley and Hadley Delta rise kilometres above the site.
- [x] T24's terrain checks still pass.
- [x] The height-map budget passes again on Fast 4G (a new row in `docs/load-time.md`).
- [x] The About panel and every "smooth Moon" label agree with where terrain now applies.
- [x] `npm test` and `npm run build` pass.

## Notes

Draft pull request #91 labels a Compare column with no terrain "Smooth Moon, no terrain". Agree an
order with it. Not in scope: looking beyond 150 km.

## After the merge

Rechecked on 15 Nov 2026 on `main` at 6b76957 with real data (pull request #207).

**Fixed in #207**

- **Three cards kept the smooth-Moon answer after `globe.bin` arrived.** It arrives after the
  height map with no other change of state. The readout and the sky panorama redrew; the Compare
  card, the timeline and the report page did not, until the next click. At Apollo 15, Compare
  stayed on "Smooth Moon until the whole-Moon height map loads" and 50.4 % lit (48.2 % with the
  terrain), and `report.html` printed the same label and 50 %. `web/e2e/globe-arrival.spec.ts`
  holds `globe.bin` and lets it through; it fails without each of the three changes.
- **The map caption said "outside terrain coverage"** away from the south-pole height map, beside
  a readout that says "Coarse terrain". The clause is gone.

**Checked and correct**

- The engine's skyline on `globe.bin` equals an independent one (own reading of the file, own
  geometry) to 0.0000° at the same distances, at ten sites: both poles' neighbourhoods, the
  180° line, Apollo 11, 15 and 17, IM-2. Apollo 15's highest point is 10.95° at azimuth 173.
- The seam: 85° S exactly uses `dem.bin`, 84.9999° S uses `globe.bin`; no grid, no terrain.
- Breaking the code three ways (heights ignored, the seam moved to 80° S, the cell size times 4)
  fails 5, 4 and 3 of T37's tests.
- A coarse skyline takes 7 to 17 ms.
- The labels while `globe.bin` is loading and when it is missing; the never-lit scan at a
  coarse-terrain site (82.121° S, 9.79° E: "Permanently shadowed (until 2100)", the layers agree).

**How far the coarse terrain is from the detailed one** (not faults: the page says "Coarse terrain")

| Measure | Before T37 (smooth Moon) | Now |
|---|---|---|
| Map shadow drawn where the engine has the Sun up, 80° S to 85° S (5,271 cells, three dates) | 23.7 % | 10.2 % |
| Sunlight layer against the engine's share of 2026, 80.5° S to 84.5° S, 60 points: median gap, points over 20 | 19, 28 | 5, 6 |
| The same, 87° N to 89.5° N | 41, 56 | 14, 22 |
| 88.42° N, 116.87° W (layers: never lit): the engine's share of the year with the Sun in view | 58 % | 0 % |

- Against a 240 m skyline from `dem.bin` at eight sites between 80° S and 85° S, the coarse one
  is off by 1.7° to 6.7° at its worst azimuth (0.4° to 2.1° on average) and gives 2 to 9 points
  more sunlight over a year (IM-2: 50.6 % against 48.2 %; 83° S, 60° W: 50.6 % against 41.9 %).
  *costs time*: IM-2 and Chandrayaan-4 lie inside `dem.bin` and could use it.
- The walk steps half a cell (1.9 km), so it reads up to 0.9° under a 250 m walk of the same grid
  at single azimuths (0.14° on average at the worst site). *cosmetic*

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md, docs/decisions.md and tasks/T37-terrain-north.md. Do only that task, on branch t37-terrain-north. Start with step 1: if the team's choice of option isn't recorded, stop and tell me. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
