# T36: Upcoming mission targets in the site list

Status: done (pull request #162): four planned sites (`im-3`, `blue-ghost-2`, `blue-ghost-3`, `chandrayaan-4`; 24 in all), `data-prep/check_features.py`, `features.json` and its contract entry, the planned-site test, "(planned)" after the name in the site list, and `web/scripts/quickmap-sheet.mjs`; Yi Hung checked the four pins on the contact sheet (F12). Extra scope: `web/src/ui/scenarios/input.ts` and `input.test.ts`. Open: IM-3's point has no independent second source (`docs/sources/T36.md`)

| | |
|---|---|
| Tier | if time |
| Waits for | M2 (passed); the count (agreed: 25). Not after the M3 freeze |
| Branch | `t36-planned-sites` |

## Goal

The challenge statement asks for a curated list with "past Apollo missions, future CLPS mission
targets, targets of other commercial lunar missions, or landing sites from other countries' lunar
programs". All 14 mission sites in `sites.json` have already landed (6 Apollo, 8 landers). The 4
south-pole `candidate` points come from sunlight studies, not from missions. Add up to 5 published
landing targets of upcoming missions, with `status: "planned"`: the contract already has that
word, and no site uses it yet.

## Files in scope

- `web/public/data/sites.json`
- `web/src/core/sites.test.ts`
- `data-prep/check_features.py` (new): the gazetteer check's data (step 3)
- `web/src/core/__fixtures__/features.json` (new), and its entry in `docs/data-contract.md`
  section 2 (fixtures)
- `web/scripts/quickmap-sheet.mjs` (new): the QuickMap contact sheet (step 5)
- `web/src/ui/scenarios/index.ts` (how the site list labels a planned site), only if step 4 needs
  it; `docs/data-contract.md` (`sites.json`) if step 4 adds a `group` word
- `docs/ai-use/T36.md`, `docs/sources/T36.md`, this file's `Status:` line

No new package: Python reads the gazetteer's KMZ with the standard library (`zipfile`,
`xml.etree`), and Playwright is already a dev dependency of `web/`.

## Steps

1. **Done:** the team agreed the count on 15 Nov 2026: up to 25 sites, the 20 stay, up to 5 new.
2. **Find the targets**, on the mission owners' own pages, on the day you do this. Aim for a mix:
   upcoming NASA CLPS deliveries, at least one non-US mission, and the centre of one or two of
   NASA's Artemis III candidate regions. Prefer a target published as a point over one published
   only as a region. For each target, write in `docs/sources/T36.md` the page, the date you read
   it, the coordinates as the page gives them, and a second source that agrees (another page, or
   a second model's check). Leave out any mission with no published target. Plans change: never
   copy a target from memory.
3. **Gazetteer check (automated).** For each new target, name the IAU feature it sits on (a
   crater, massif or mons). `data-prep/check_features.py`:
   - downloads the USGS Moon nomenclature file `MOON_nomenclature_center_pts.kmz` (linked from
     https://planetarynames.wr.usgs.gov/GIS_Downloads; regenerated nightly; LOLA 2011 control
     network, the same frame as ours; east longitude, planetocentric latitude) into
     `data-prep/raw/`, which is git-ignored;
   - reads each named feature's centre and diameter. The download page doesn't say whether the
     file has diameters; if it hasn't, read each one from the feature's own page,
     `https://planetarynames.wr.usgs.gov/Feature/<id>`;
   - writes `web/src/core/__fixtures__/features.json`: per new site id, the feature name, its
     gazetteer id, centre (longitude in -180..180), diameter in km, the file's date, and, for a
     region target, a margin in km with the reason. A target with no matching feature gets
     `"feature": null` and the reason; the QuickMap check covers it alone.

   `sites.test.ts` then checks every `planned` site against the fixture: the great-circle distance
   from the site to the feature's centre, on the 1737.4 km sphere, is at most half the diameter
   plus the margin. Work the distance out in the test; if you add a `core/` function for it
   instead, it gets its own test.
4. **Label.** Agree in the pull request how the list shows a planned site: its own group (a new
   `group` word, so the contract changes too), or "(planned)" after the name.
5. **QuickMap contact sheet (automated), with a person's sign-off.** `web/scripts/quickmap-sheet.mjs`
   uses Playwright to open LROC QuickMap for each new site. It types `lat,lon` into QuickMap's
   search box (placeholder "Type a lat,lon(,height) or search..."; `quickmap.lroc.asu.edu` now
   redirects to `quickmap.lroc.im-ldi.com`; both checked 15 Nov 2026), waits for the map, and saves
   one screenshot per site plus one HTML page of them all into `data-prep/raw/quickmap/`. If the
   search box isn't found or the map doesn't move, the script stops and says so; it never guesses.
   A person looks at the page and confirms each pin is on its named feature. Their name and the
   date go in `docs/sources/T36.md`. F12 needs a person's check; a model looking at the screenshots
   doesn't count. The screenshots aren't committed. The script reads public pages only, so run it
   by hand, not in CI.
6. Look at the south-polar map at 1280 and 390 px: new pins near Shackleton mustn't hide the
   existing pins or their labels.

## Done when

- [x] The team's answer on the count is recorded (step 1): up to 25 sites.
- [ ] At most 5 new sites, each with `status: "planned"` and a `source` link to the mission owner's
      page; `docs/sources/T36.md` gives the date each was read and its second source.
- [ ] `data-prep/check_features.py` runs from an empty `data-prep/raw/` and writes
      `features.json`; `sites.test.ts` checks every planned site against it, and passes.
- [ ] `web/scripts/quickmap-sheet.mjs` makes the contact sheet, and a person checked every new pin
      on it, named with the date in `docs/sources/T36.md`.
- [ ] The site list shows which sites are planned.
- [ ] At 1280 and 390 px the new pins don't hide the old ones or their labels.
- [ ] `npm test` and `npm run build` pass.

## Notes

`shackleton-floor` and `shackleton-rim` stay: T24's checks and the demo use them by id. A planned
target south of 85 S gets the terrain skyline; anywhere else it gets the smooth Moon (T37 covers
that). `tasks/T07-sites.md` still says "15-20": it records what T07 did.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md and tasks/T36-planned-sites.md. Do only that task, on branch t36-planned-sites. Step 1 is done (25 sites). Do steps 2 to 6 in order: find the targets with sources and a second check, write the gazetteer script, fixture and test, then the QuickMap contact-sheet script. Stop before step 5's sign-off and tell me the contact sheet is ready for a person to check; don't record a person's check yourself. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
