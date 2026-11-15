# T18: Testing with a real person, bug list

Status: third delivery in progress (MarsRon, branch `t18-qa-c`, draft pull request to follow): the report `qa/m3.md` with every spec feature as pass or fail and a timed 60-second test, plus fixes to `qa/m2.md`. Before it: three of the four "Done when" lines fail. Merged: the M1 report `qa/m1.md` (#99), the F18 specification (#101) and the M2 report `qa/m2.md` (#102); M2 did the Firefox and real-phone passes, the six Quickmap sites (F12) and the team decision D1 (F18). The M1 delivery's line 1 passes (F12, partial at M1, passed in M2). The 60-second test has not been run with the set question and a time in either round (line 2 of both deliveries): `qa/m1.md` says pending, and `qa/m2.md` records a first-time user's exploration without the question or a time. `qa/m2.md` doesn't list every feature as pass or fail (the M2 delivery's line 1): it rechecked F12 and F18 only, and F14 and F20 have been built since M1. `qa/m2.md` still says "Pending" for its date, build and tester, and calls map-label contrast (B5) unresolved, but #116 fixed it and `web/e2e/contrast.spec.ts` checks it in CI. Posting B1 to B5 in the team chat isn't recorded. Next delivery on `t18-qa-c`.

| | |
|---|---|
| Tier | must |
| Waits for | M1, repeated at M2 |
| Branch | `t18-qa` at M1, `t18-qa-b` at M2 |

## Goal

Find what's broken or confusing before the judges do.

## Files in scope

- `qa/`
- `docs/ai-use/T18.md`, `docs/sources/T18.md`, this file's `Status:` line

## Steps

1. The 60-second test: someone outside the team, no instructions, is asked "which of these two sites gets more sunlight this month?" Time it. Write down where they hesitated.
2. Walk through every "Done when" in the spec's feature table on the deployed site, in Chrome and one other browser, and on a phone.
3. Bugs go in the team chat with the task id, affected files and reproduction steps, so anyone can claim a fix without duplicating active work.

## Done when

First delivery, at M1, on `t18-qa`:

- [ ] `qa/m1.md` lists every spec feature as pass or fail.
- [ ] The 60-second test was run with at least 1 person, with their time in `qa/m1.md`.

Second delivery, at M2, on `t18-qa-b`:

- [ ] `qa/m2.md` lists every spec feature as pass or fail.
- [ ] The 60-second test was run with at least 1 person who hasn't seen the site, with their time in `qa/m2.md`. That makes 2 people or more across the two rounds.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T18-qa.md. Do only that task, on branch t18-qa (t18-qa-b for the second delivery, at M2), and only that delivery's part of "Done when". Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
