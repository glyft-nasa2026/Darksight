# T32: A dark site says it is still checking to 2100

Status: merged (Fabian, pull request #138), not done: lines 1-4 and 6 of "Done when" pass; line 5 passed on a local production build with Fast 4G figures and has not been checked on a preview. Follow-ups: the mission card (`ui/mission/index.ts`, T34), not changed in #138; "checking" while #132's sliced scan runs, pull request #148

| | |
|---|---|
| Tier | if time |
| Waits for | - (T06 and the decade files, #31, have merged) |
| Branch | `t32-never-lit-checking` |

## Goal

Issue #32, row 3. On a crater floor the Sun countdown first reads "No sunrise in the next 60
days". A few seconds later it changes to "Permanently shadowed (until 2100)", once the decade
files up to 2100 have downloaded in the background: 5.6 MB counting from 2026, up to 14.1 MB
from 1900. Both texts are true, but the change looks like a mistake, and on first open it
happens in the pinned floor column while a judge is reading it. While the check is still
waiting for decades, the text should say so.

## Files in scope

- `web/src/state.ts`, `web/src/state.test.ts`
- `web/src/core/windows.ts`, `web/src/core/windows.test.ts` (`countdownText`)
- `web/src/ui/readout/index.ts`, `web/src/ui/compare/index.ts`, `web/src/ui/nudge/index.ts`:
  the three callers of `countdownText` with a Sun verdict
- `docs/data-contract.md` section 3 (the `countdownText` wording table) and section 4 ("Never lit")
- `docs/ai-use/T32.md`, `docs/sources/T32.md`, this file's `Status:` line

## Steps

1. In `state.ts`, add an accessor next to `neverLitFor`, for example
   `neverLitPendingFor(sc: Scenario): boolean`. It is true exactly when `neverLitFor` would scan
   but can't yet: the Sun is down, no sunrise within 60 days, and a decade between the
   scenario's time and the end of the table is still downloading. It is false once those
   decades are in, false when the only ones missing failed to download, and false whenever
   `neverLitFor` returns false at once (Sun up, a rise within 60 days, or near the end of the
   table). Keep `neverLitFor`'s signature: the three modules already call it.
2. In `countdownText`, add the case to the wording table, for example a sixth argument
   `checking = false`. Agree the exact text in the pull request; a starting point is
   "No sunrise in the next 60 days · checking to 2100…". `neverLit` wins when both are true.
3. The readout, compare and nudge pass the new flag. No module computes it itself.
4. Update contract section 3 (the new row of the wording table) and section 4 ("Never lit":
   what the text says while decades are downloading).

## Done when

- [x] A state test: a never-lit site with the later decades still downloading gives
      `neverLitPendingFor` true and `neverLitFor` false; after they arrive, false and true.
- [x] A state test: a later decade fails to download, so `neverLitPendingFor` is false and the
      text is today's "No sunrise in the next 60 days".
- [x] A state test: a lit site, or a dark site with a sunrise within 60 days, never reads pending.
- [x] A `countdownText` test for the new wording, and one showing that `neverLit` wins.
- [ ] On the pull request's preview, with DevTools on "Fast 4G" and the site's data cleared, the
      plain address shows the floor column (A) with the "checking" text, and then
      "Permanently shadowed (until 2100)". Never "No sunrise…" in between.
- [x] `npm test` and `npm run build` pass.

## Notes

The wait is measured in T27 (`docs/load-time.md`): one decade file is 0.70 MB with no
compression. On first open, the floor's decades share the connection with the height map, so
the "checking" text may show for most of the load.

Not in scope: the freeze when the scan runs (issue #32, row 1, 486 ms on the laptop in T27) and
precomputing the verdict in `data-prep/`. Precomputing only works for listed sites, not for a
clicked spot.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T32-never-lit-checking.md. Do only that task, on branch t32-never-lit-checking. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
