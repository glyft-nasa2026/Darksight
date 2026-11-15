# T43: Map layers over the whole Moon

Status: done (MarsRon, pull request #172, merged as `4e0e6a8`). Every "Done when" line passes on the branch merged with main on 15 Nov. North uses the LOLA north maps (AVGVISIB_65N_240M_201608, _EARTH, LPSR_65N_240M_201608).

| | |
|---|---|
| Tier | if time (F14) |
| Waits for | M2 (passed), T14 and T41 (merged). T37 also lets `core/` read `globe.bin`: agree one reader. Not after the M3 freeze |
| Branch | `t43-layers-whole-moon` |

## Goal

Every map layer stops at 80 S today, so a planner looking at an Apollo, Chang'e or SLIM site sees
no layer at all. No spec line asked for that. Each task took the reach of its data file:

- `dem.bin` was cut at 80 S to fit its 15 MB budget (T04, SPEC section 5).
- T14 built the layers on `dem.bin`'s grid and drew them on the south-polar map only
  (contract section 5, `kind === 'south'` in `web/src/map/index.ts`).
- T41's slope copied the same limit ("It works wherever `dem.bin` has heights: south of 80 S").
- The only whole-Moon heights, `globe.bin`, were "for pictures only".

The rule is now: every map layer covers the whole Moon (`CLAUDE.md`, SPEC section 6, the
decision of 15 Nov 2026). This task makes the five layers do so, and adds a test that fails for any
future layer that doesn't.

## Model (SPEC section 6)

| Layer | Near the poles | Elsewhere |
|---|---|---|
| `sun`, `earth` | The LOLA team's maps, with terrain: south (today's files); north if the LOLA team publishes them (step 1) | Smooth Moon: the share of time any part of the disc is above 0°, over the same span as the LOLA maps (18.6 years) so the two agree in kind at the seam |
| `psr` | The LOLA team's permanent-shadow maps (south; north if published) | 0: a smooth Moon has no permanent shadow. The legend says so |
| `height` | `dem.bin` (240 m) south of 80 S, `north.bin` (1200 m) north of 80 N | `globe.bin` (0.125°, 3.8 km at the equator) |
| `slope` | The same polar grids, as `core/slope.ts` does now | `globe.bin`: central differences on the latitude-longitude grid, `dz/dy = Δz / (R Δφ)`, `dz/dx = Δz / (R cos φ Δλ)` |

- The smooth-Moon `sun` and `earth` layers are computed once in Python (`data-prep/`, Skyfield and
  DE440, as T01) on a coarse latitude-longitude grid. They vary slowly, so 0.5° is probably enough
  (720 × 360 bytes, 0.26 MB each). They are written to `web/public/data/layers/`. Agree the grid
  in the pull request.
- Where a polar map meets a global one, the values jump: terrain shadow against none. That's
  correct. Draw the seam, and have the legend name the source under the cursor or pin: "LOLA, 240 m,
  with terrain" or "Smooth Moon, no terrain shadows".
- The readout's slope line (F3) follows the slope layer: "Ground slope 2° (over 3.8 km)" on
  `globe.bin`. Name the distance the slope is measured over at that latitude (it shrinks with
  `cos φ` east to west), or state the larger of the two.

## Files in scope

- `web/src/core/`: a reader for `globe.bin` and `north.bin` (or the one T37 adds), `slope.ts`,
  `layers.ts` (one function giving a layer's value and source at any latitude and longitude), and
  their tests
- `data-prep/make_layers.py`, or a new `data-prep/make_layers_global.py`; `web/public/data/layers/`
- `web/src/ui/layers/` (sources, legend, the "whole Moon or north pole" message, which goes)
- `web/src/map/index.ts`: `drawLayers` on the north polar and whole-Moon maps, with a projection
  for each
- `web/src/ui/readout/` (the slope line)
- `docs/data-contract.md` sections 2, 3 and 5; `SPEC.md` section 6 if the sources change;
  `history.md`; `docs/load-time.md` (new files, T27's method)
- `docs/ai-use/T43.md`, `docs/sources/T43.md`, this file's `Status:` line

## Steps

1. Check on PGDA (product 69 and its neighbours) whether the LOLA team publishes north-polar
   average-visibility and permanent-shadow maps. If it does, use them north of the global grid as
   the south ones are used. If not, the north uses the smooth-Moon layers, and the legend says so.
2. Write the contract first: the reader in `core/`, the global layer files, and the source rule
   (which grid applies where, and what the legend says).
3. Code and tests, `core/` first.
4. Draw the layers on all three map views. Check the seams at 80 S and 80 N and across 180°.
5. Measure the load again with T27's method; layers are fetched only when switched on.

## Done when

- [x] A test over `LAYER_KEYS` (so a layer added later is covered without editing the test): every
      layer gives a value, not null, at 89 N, 45 N 90 E, 0 N 0 E, 0 N 180 E, 60 S 120 W and 89 S.
      One version on synthetic grids runs always; one on real data skips on mock.
- [x] On real data (skips on mock): the steepest slope within 20 km of Apollo 15 (Mons Hadley
      Delta) is steeper than the steepest within 20 km of Apollo 11 (Mare Tranquillitatis); the smooth-Moon Earth layer is near 1 at 0 N 0 E
      and near 0 at 0 N 180 E.
- [x] Every layer toggles and fades on the south polar, north polar and whole-Moon maps, and the
      legend names the source at the point shown.
- [x] The readout shows a slope at every site, with the distance it is measured over; the number
      comes from `core/`.
- [x] At 1280 and 390 px wide nothing overlaps or scrolls sideways.
- [x] The load-time budget still passes (a new row in `docs/load-time.md`).
- [x] `npm test` and `npm run build` pass.

## Notes

Pull request #164 (T40) edits `SPEC.md`, `docs/data-contract.md` and `history.md`; T37 changes
`core/` heights and `state.ts`. Agree an order before editing the same sections. Not in scope:
terrain skylines north of 85 S (T37), a finer global height map, layers in the 3D view.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T43-layers-whole-moon.md. Do only that task, on branch t43-layers-whole-moon. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
