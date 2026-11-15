# T24: Real-data checks

Status: done (pull request #81; a real `dem.json` without its `dem.bin` is an error, not a skip, #90)

| | |
|---|---|
| Tier | must |
| Waits for | T01, T04, T05, T06, T07 |
| Branch | `t24-real-data-checks` |

## Goal

The terrain checks of spec section 7, run on the real table and the real height map, as tests
that keep running on every pull request. These checks used to sit in T05 and T06 as "after T04"
lines that nobody owned once those tasks had merged.

## Files in scope

- `web/src/core/realdata.test.ts`
- `docs/ai-use/T24.md`, `docs/sources/T24.md`, this file's `Status:` line

## Steps

1. The test reads `web/public/data/` from disk and builds the table and the grid with `parseEphemeris` and `parseDem`. It skips, with a printed reason, when either file says `"source": "mock"`.
2. It takes `shackleton-floor` and `shackleton-rim` from `sites.json` by id.
3. The checks:
   - Floor: the lowest of the 360 skyline values is above 5 degrees.
   - Floor: never lit in the whole table (`sunFrac` is 0 in every hourly sample, 2026-2035).
   - Rim: lit more than half of the whole table.
   - One real skyline takes under 100 ms (print the timing).
4. If a check fails, keep the check and report the numbers with the affected area: `horizon.ts` (T05), `windows.ts` (T06), or the rim coordinates (T07). Anyone can claim a separate, coordinated fix; keep this test delivery independent of the fix.

## Done when

- [x] All four checks pass on the real files, with the printed numbers pasted into the pull request.
- [x] With the mock files put back, the test skips and says why.
- [x] `npm test` and `npm run build` pass.

## After the merge

14 Nov 2026, audit of the merged ticket.

Checked and correct: all four checks run on every pull request and give the same numbers in six CI runs as in #81 (floor skyline lowest 19.75 deg; 0 of 1,761,936 hours lit; rim 1,477,819 hours, 83.9 %). Each check fails when its input is broken on purpose: the rim put back on Bussey's Point A reads 46.7 % and fails; the floor point moved to the rim fails both floor checks; with the terrain skyline switched off the floor is lit 978,234 hours and fails. With T20's mock `dem.json` or both mock files put back, the 4 tests skip and print why.

- "The whole table" is 1900 to 2100, as spec section 7 says ("Never lit, to 2100"). Step 3's "2026-2035" was the table's span when the task was written.
- Changed after the audit: a real `dem.json` with `dem.bin` missing used to skip the four checks; it is now an error, the same rule `readRealTable()` has for the table's decade files.
- *cosmetic*: the 100 ms timing check has room in CI (fastest of five 22 to 54 ms in six runs) but less on a busy machine: #81 records 79 to 82 ms in full runs on its author's machine and one failure at 105.5 ms before the check was moved first.
- *cosmetic*: Vitest's quiet reporter (used when it detects an AI coding tool) hides the printed numbers and the skip reason. `npx vitest run src/core/realdata.test.ts --reporter=default` shows them.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T24-real-data-checks.md. Do only that task, on branch t24-real-data-checks. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. If a check fails, show me the numbers and stop; don't change any other file to make it pass. When you think you're finished, run every line of "Done when" and show me the output for each.
```
