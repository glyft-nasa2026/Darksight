# T33: A decade that failed to download is tried again

Status: in review (Yi Hung, branch `t33-decade-retry`, draft pull request #147). "Done when" lines 1-4 pass, line 4 as a Playwright page test (`web/e2e/decade-retry.spec.ts`) instead of DevTools by hand; line 5: `npm run build` passes, `npm test` 580 of 582 (two `core/` timing tests fail only under another session's load, pass alone). Wording agreed in #147 (as proposed). The mission and launch simulation pages say it too

| | |
|---|---|
| Tier | if time |
| Waits for | - (the decade files, #31, have merged) |
| Branch | `t33-decade-retry` |

## Goal

Issue #32, row 4. When a decade file fails to download (a dropped connection, a phone going
through a tunnel), `state.ts` adds it to `failed`. It is not asked for again until the page
reloads. The panels then say "This time is outside the Sun and Earth table", which is wrong:
the time is inside 1900 to 2100, and the file just didn't arrive. A failed decade should be
tried again, and the page should say what happened.

The other half of row 4 is already fixed. The 3D scene no longer lights the Moon from the
nearest decade it has: `web/src/scene/index.ts` turns the Sun off when the time has no row of
its own. This task only checks that this still holds.

## Files in scope

- `web/src/state.ts`, `web/src/state.test.ts`
- `web/src/main.ts` (the status line at the top already lists files that did not load)
- The modules that print "This time is outside the Sun and Earth table" for a failed decade:
  `web/src/ui/readout/index.ts`, `web/src/ui/panel/index.ts`, `web/src/ui/nudge/index.ts`.
  `web/src/ui/sky/` and `web/src/ui/timeline/model.ts` already word it differently: check them,
  and change them only if needed.
- `docs/data-contract.md` section 4 ("Decades": "one that fails to download reads as outside
  the table")
- `docs/ai-use/T33.md`, `docs/sources/T33.md`, this file's `Status:` line

## Steps

1. Retry. A failed decade is asked for again the next time a scenario needs it, but not
   sooner than a short wait after the failure (for example 10 s), so a dead connection doesn't
   loop. Also try again when the browser reports it is back online (the `online` event).
   `fetchChunk` and `failed` in `state.ts` are the place. While a retry is downloading, the
   decade counts as downloading again, so panels show "Loading" as they do for any decade.
2. Say what happened. Add a state accessor the modules can read, for example
   `tableGap(tMs): 'none' | 'outside' | 'failed'`. A time in a failed decade reads something
   like "The Sun and Earth table for the 2050s did not download. Trying again…", not "outside
   the table". Agree the exact text in the pull request. The status line names the failed
   decade too.
3. Update contract section 4, "Decades", to match.
4. Check the scene: with a decade failed, the 3D view still shows no Sun at a time in it.

## Done when

- [ ] A state test: the first download of a decade fails, the scenario needs it again after
      the wait, the second download succeeds, and `eph` becomes non-null with no reload.
- [ ] A state test: a decade that keeps failing is not asked for again before the wait is over.
- [ ] A state test: `tableGap` gives `outside` before 1900 and after 2100, `failed` in a failed
      decade, and `none` otherwise.
- [ ] On `npm run dev`, use DevTools request blocking on `ephemeris/2050.bin`, then set the time
      to 2055. The readout says the download failed, not "outside the table", and the 3D view
      shows no Sun. Unblock and wait: the numbers come back without a reload.
- [ ] `npm test` and `npm run build` pass.

## Notes

How long a decade takes to arrive is measured in T27 (`docs/load-time.md`): 0.70 MB per file,
1.42 s of "Loading" on Fast 4G for a jump to 1969. Neither row 3 (T32) nor this task changes
when decades are fetched, only what happens after a failure.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T33-decade-retry.md. Do only that task, on branch t33-decade-retry. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
