# T38: Say that libration and the Moon's orbit are included

Status: in progress (Yi Hung, branch `t38-libration`, draft pull request): About paragraph on libration and the Moon's changing distance, and a sky panorama caption where Earth's loop is drawn

| | |
|---|---|
| Tier | if time |
| Waits for | - (text and a caption only). T38 and T39 both edit `web/src/ui/about/index.ts`: agree an order |
| Branch | `t38-libration` |

## Goal

The challenge statement: "Consider whether your tool will account for factors like Earth's
libration (wobble) or the Moon's orbital variations." Darksight does. Every Sun and Earth position
comes from JPL's DE440 ephemeris and the Moon's own orientation file (`moon_pa_de440_200625.bpc`,
frame `MOON_ME_DE440_ME421`, in `data-prep/make_ephemeris.py`), so libration and the changing
Earth-Moon distance are in every number. But the word "libration" appears nowhere on the site or
in `docs/`, so a judge can't tell. Say it, and point to where it shows.

## Files in scope

- `web/src/ui/about/index.ts`: one paragraph in the text on how it works, and a known-limits line if
  one is needed
- `web/src/ui/sky/index.ts`: a caption under the panorama. Coordinate with T23 if it is polishing
  `ui/sky/`
- `docs/ai-use/T38.md`, `docs/sources/T38.md`, this file's `Status:` line

## Steps

1. Write one About paragraph in plain words. The Moon rocks a little as it orbits (libration), so
   from a near-side site Earth wanders round one spot in the sky over a month, and near the edge of
   the near side it rises and sets. The Earth-Moon distance also changes through the month.
   Darksight includes both, from DE440 and the Moon's orientation file. Cite a source for any size
   you quote.
2. Add a caption on the sky panorama where Earth's 30-day path is drawn, saying that the loop is the
   libration. First check on a real site (Apollo 11, say) that the loop can be seen at the chart's
   scale. If it can't, leave the caption out and say why in the pull request.
3. Add rows to `docs/sources/T38.md` for the ephemeris and the orientation file, with their NAIF
   links.

## Done when

- [ ] The About panel names libration and the Moon's changing distance, and says where they come
      from.
- [ ] The sky panorama has the caption, or the pull request says why not.
- [ ] Every size or number in the new text has a source in `docs/sources/T38.md`.
- [ ] At 390 px wide, the new text doesn't overlap anything or scroll sideways.
- [ ] `npm test` and `npm run build` pass.

## Notes

This is text, not a new feature. Whether it can merge after the M3 freeze ("bugs, video, write-up
only") is the team's call.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T38-libration.md. Do only that task, on branch t38-libration. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
