# T36: Upcoming mission targets in the site list

Status: not started

| | |
|---|---|
| Tier | if time |
| Waits for | M2 (passed). Not after the M3 freeze |
| Branch | `t36-planned-sites` |

## Goal

The challenge statement asks for a curated list with "past Apollo missions, future CLPS mission
targets, targets of other commercial lunar missions, or landing sites from other countries' lunar
programs". All 14 mission sites in `sites.json` have already landed (6 Apollo, 8 landers). The 4
south-pole `candidate` points come from sunlight studies, not from missions. Add the published
landing targets of upcoming missions, with `status: "planned"`: the contract already has that
word, and no site uses it yet.

## Files in scope

- `web/public/data/sites.json`
- `web/src/core/sites.test.ts`
- `web/src/ui/scenarios/index.ts` (how the site list labels a planned site), only if step 3 needs it
- After step 1: `SPEC.md` F12 ("15-20 sites"), `docs/decisions.md`, `history.md`; and
  `docs/data-contract.md` (`sites.json`) if step 3 adds a `group` word
- `docs/ai-use/T36.md`, `docs/sources/T36.md`, this file's `Status:` line

## Steps

1. **Agree the count.** The list has 20 sites, the top of F12's "15-20". Ask the team in the chat
   to choose: raise the limit, or swap sites out. Record the answer in `docs/decisions.md` and in
   F12 in `SPEC.md`, with the old wording in `history.md`.
2. Find the targets on the mission owners' own pages, on the day you do this: upcoming NASA CLPS
   deliveries, other commercial landers, other countries' landers, and NASA's Artemis III
   candidate regions. Plans change, so write the date you checked each target in
   `docs/sources/T36.md`. Leave out any mission without a published target.
3. A target published as a region uses the region's published centre, and its `note` says how big
   the region is. Agree in the pull request how the list shows a planned site: its own group (a
   new `group` word, so the contract changes too), or "(planned)" after the name.
4. A person checks every new pin in LROC QuickMap against its source, as T07 did (F12's "Done
   when"). The result goes in `docs/sources/T36.md`.

## Done when

- [ ] The team's answer on the count is recorded (step 1).
- [ ] Every new site has `status: "planned"` and a `source` link to the mission owner's page, and
      `docs/sources/T36.md` gives the date each one was checked.
- [ ] A person checked every new pin in QuickMap; `docs/sources/T36.md` names who and when.
- [ ] The site list shows which sites are planned.
- [ ] `sites.test.ts` passes with the new sites and checks that every `planned` site has a source.
- [ ] `npm test` and `npm run build` pass.

## Notes

`shackleton-floor` and `shackleton-rim` stay: T24's checks and the demo use them by id. A planned
target south of 85 S gets the terrain skyline; anywhere else it gets the smooth Moon (T37 covers
that).

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T36-planned-sites.md. Do only that task, on branch t36-planned-sites. Start with step 1: if the team's answer on the count isn't recorded, stop and tell me. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
