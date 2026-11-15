# T37: Terrain skyline north of 85 S

Status: in review (Fabian started it, MarsRon took over the second half; branch `t37-terrain-north`, pull request #193). Option C. Every "Done when" line passes on `676a781` and after (`npm test` 778 passed, `npm run build` passed; height map in at 6.97 s on Fast 4G, `docs/load-time.md` section 9). `npx playwright test`: 18 of 20, the two `landing-wide.spec.ts` fails also fail on `main` (`4df5398`). Next: a person reviews and merges

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

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md, docs/decisions.md and tasks/T37-terrain-north.md. Do only that task, on branch t37-terrain-north. Start with step 1: if the team's choice of option isn't recorded, stop and tell me. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
