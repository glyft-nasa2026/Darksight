# T41: Ground slope, as a map layer and a readout line

Status: done (pull request #165): core/slope.ts with tests, dem.hasData(), the Slope map layer and the readout line; contract, SPEC F3 and F14, history.md updated. Extra scope: web/src/core/dem.ts and dem.test.ts.

| | |
|---|---|
| Tier | if time |
| Waits for | M2 (passed), T14 (merged). Not after the M3 freeze |
| Branch | `t41-slope` |

## Goal

The challenge statement: "South pole terrain is particularly complex, and you may consider how to
represent steep slopes and deep craters that create extreme shadow conditions." Slopes show as
shading on the map and in 3D, but nothing measures them, and slope is one of the first things a
landing planner checks. Work out the slope from the height map in `core/`, then show it as a fifth
map layer and as a line in the readout.

## Model

- `core/slope.ts`: the slope at a point, in degrees, from the height map's neighbouring cells
  (central differences on the polar stereographic grid, corrected for the projection's scale at
  that latitude). Agree the method in the pull request.
- A slope over 240 m cells is a baseline slope, not the slope under the lander's feet: a boulder or
  a 10 m crater doesn't show. The readout says "over 240 m".
- It works wherever `dem.bin` has heights: south of 80 S, or further if T37 extends it.

## What the user sees

- **Layers:** "Slope", a colour ramp from flat to steep, with on/off, transparency and fading like
  T14's layers. Build it from the loaded height map, as the height layer is built; take its colours
  from theme variables.
- **Readout:** "Ground slope 7° (over 240 m)" for the selected scenario. North of 80 S it says
  there is no height map there.

## Files in scope

- `web/src/core/slope.ts`, `slope.test.ts` (new)
- `web/src/ui/layers/` (`model.ts`'s `LAYER_KEYS`, `index.ts`), and `web/src/core/layers.ts` if the
  layer needs a grid there
- `web/src/ui/readout/index.ts` and its CSS
- `docs/data-contract.md` (section 3, the function; the T14 layers paragraph); `SPEC.md` F3 and
  F14; `history.md`
- `docs/ai-use/T41.md`, `docs/sources/T41.md`, this file's `Status:` line

## Done when

- [ ] Tests: a synthetic tilted plane gives its slope within 0.1°; a flat grid gives 0; a cell
      next to `nodata` gives null, not a number.
- [ ] On real data (skips on mock): the point halfway between `shackleton-floor` and
      `shackleton-rim`, on the crater's inner wall, is steeper than both.
- [ ] The Slope layer toggles and fades like T14's layers, and its colours come from theme
      variables.
- [ ] The readout shows the slope south of 80 S and says why it doesn't elsewhere; the number comes
      from `core/`.
- [ ] At 1280 and 390 px wide nothing overlaps or scrolls sideways.
- [ ] `npm test` and `npm run build` pass.

## Notes

T23 may be polishing the readout's CSS: agree an order. Not in scope: a finer height map, hazard
maps, rock counts.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T41-slope.md. Do only that task, on branch t41-slope. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
