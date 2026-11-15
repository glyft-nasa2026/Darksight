# T39: Why the Moon is different, in plain words

Status: done (Yi Hung, pull request #159; "Done when" line 2 by T18's 60-second tester, `qa/m3.md`, pull request #205): the About panel's "Why the Moon is different" section, five points in two sentences or fewer, each with a button to where the page shows it. After reading it, a friend not on the team said Earth doesn't rise or set at a near-side site because the Moon is tidally locked, and gave the low Sun as why a polar crater floor stays dark, without the crater's walls blocking it

| | |
|---|---|
| Tier | if time |
| Waits for | - (text only). T38 and T39 both edit `web/src/ui/about/index.ts`: agree an order |
| Branch | `t39-moon-vs-earth` |

## Goal

The challenge statement asks the tool to serve "educators and the general public curious about
why the Moon presents such distinct engineering challenges", and to "make the extreme differences
between lunar and terrestrial conditions apparent". Today the page's only comparison with Earth is
the About panel's sentence on refraction. Add a short explainer in plain words, tied to what the
user sees on the page.

## What to cover (two sentences or fewer each)

1. **A lunar day.** One sunrise to the next is about 29.5 Earth days, so a site gets about two
   weeks of light and then about two weeks of dark. A lander's batteries must last the night.
2. **No air.** No refraction, no twilight, a black sky by day, and hard-edged shadows: a rock
   either blocks the Sun or it doesn't.
3. **The poles.** The Sun stays near the horizon all month, so a hill a few hundred metres high
   decides whether a site has light, and some crater floors never see the Sun.
4. **Earth hardly moves.** From the near side, Earth hangs in about the same part of the sky all
   month; from most of the far side, it never rises. Radio contact depends on where you land more
   than when.
5. **Small moves, big changes.** Point to the Nudge panel.

Each point links to the part of the page that shows it ("see the strips", "try the Nudge").

## Where

The team picks in the pull request: a section of the About panel (`web/src/ui/about/`, T16's
module), or the landing page (`web/src/ui/intro/landing.ts`, from #139).

## Numbers

A fixed fact, such as 29.5 days, is plain text with a source. Any number about a particular site
or date comes from `core/` (CLAUDE.md), never worked out in the module.

## Files in scope

- `web/src/ui/about/index.ts` and its CSS, or `web/src/ui/intro/landing.ts` and its CSS
- `docs/ai-use/T39.md`, `docs/sources/T39.md`, this file's `Status:` line

## Done when

- [x] The explainer covers the five points, in two sentences or fewer each.
- [x] Someone outside the team reads it and can then say why a crater floor stays dark and why
      Earth doesn't rise or set at a near-side site. T18's 60-second tester can do this.
- [x] Every fact has a source in `docs/sources/T39.md`, and no number about a site or date is
      worked out outside `core/`.
- [x] At 390 px wide nothing overlaps or scrolls sideways, and `npm run test:page` (contrast)
      passes.
- [x] `npm test` and `npm run build` pass.

## Notes

This is text, not a new feature. Whether it can merge after the M3 freeze ("bugs, video, write-up
only") is the team's call.

## After the merge

- 15 Nov 2026, audit before submission (pull request #189). "No air" said "A ridge either blocks the Sun or it doesn't", while the readout shows a partly hidden disc. It now reads "A ridge hides the Sun, or part of its disc, and nothing bends the light round it". The other four points were checked and stand.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md, docs/design.md and tasks/T39-moon-vs-earth.md. Do only that task, on branch t39-moon-vs-earth. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
