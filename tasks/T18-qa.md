# T18: Testing with a real person, bug list

Status: done (third delivery: MarsRon, branch `t18-qa-c`, pull request #205). `qa/m3.md` lists every spec feature, F1 to F22, as pass, and B1 to B5 as fixed, by MarsRon's check on the deployed site; the browsers, values and the pull requests that fixed B1 to B4 were not recorded. The 60-second test ran with the set question and a time: a friend not on the team who hadn't seen the site answered correctly in 15 s (Firefox on a PC), so two people outside the team across the rounds (with M2's first-time user). `qa/m2.md`'s date, build and tester are "Not recorded", and B5 is marked fixed in #116. Posting B1 to B5 in the team chat is not recorded. Earlier deliveries: `qa/m1.md` (#99), the F18 specification (#101), `qa/m2.md` (#102)

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
