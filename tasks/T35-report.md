# T35: Mission report, print and download

Status: second delivery ready for review (P5, branch `t35-report-b`, pull request #173; the plan
merged in #156). Every "Done when" line passes; the two skyline timing tests in `npm test` fail on
this machine on `main` too. The added sections and the report's own page still want the team's
OK in the chat. The `report` design frame was made after the module, not before. Not after the
M3 freeze

| | |
|---|---|
| Tier | if time |
| Waits for | T34 (merged) |
| Branch | `t35-report` |

## Goal

"Generate full launch schedule" (brief, page 7) opens a report of the mission T34 planned: the
whole progress from launch to touchdown, then the first days on the surface. It can be printed
or saved as a PDF (brief, page 8: "Page for show report and print") and downloaded as data
files. No server: the browser builds the report from the same mission plan the `#mission` card
shows, so the two never disagree.

## Changed from the first version (15 Nov, at P5's request)

- **Where it lives.** The first version put the report on the site's page (`web/index.html`,
  `web/src/site.ts`). Since #145 the mission card has its own page, `mission.html`. The report
  now gets a page of its own too, `report.html`, as `simulation.html` does: the button opens it
  with the same page address, so `missionFor()` gives it the same plan. It prints alone with
  nothing to hide.
- **What it contains.** The first version had seven sections: title block, flight schedule,
  totals, powered descent, landing site at touchdown, warnings, model and limits. Added: the
  lander's inputs and phase lengths in the title block, key events, the translunar coast every
  12 h, the orbits behind the schedule, and the first 30 days on the surface (the goal names
  them; no section covered them).

## Where the numbers come from

**Every number in the report comes from `core/` or from the `state.ts` accessors the card uses,
and is formatted by `web/src/ui/mission/format.ts`, the card's formatter.** The report computes
no angle, Δv or mass of its own.

| Source | Gives |
|---|---|
| `missionFor()` (`state.ts`) | The plan: `{ status: 'ready', plan }`, or `none`, `loading`, `outside` |
| `plan.steps` (`core/mission.ts`) | One row per phase: start, end, who burns, Δv, burn time, propellant, mass after, altitude |
| `plan.totals`, `plan.orbit`, `plan.runsOutMs` | Totals, the orbits, when propellant runs out |
| `missionAt(plan, tMs)` | Altitude, speed, propellant left, the point under the craft, distance to the site: what the card's live line shows |
| `approachSeconds(plan)` | When the craft enters the Moon's sphere of influence |
| `landingScenario()`, `samplesFor`, `flipFor`, `summaryFor`, `neverLitFor`, `neverLitPendingFor` (`state.ts`); `countdownText` (`core/windows.ts`) | The landing site at touchdown and over the next 30 days |
| `padById`, `stateToAddress`, `state.lander`, `state.sites`, `eph.meta.source` | Pad, share link, lander inputs, site name, real or mock data |

**One function for the landing site's numbers.** Today the card gathers them inside
`drawConditions` (`web/src/ui/mission/index.ts`). Move that gathering into
`web/src/ui/mission/conditions.ts`, `landingConditions(): LandingConditions | 'loading' | null`
(plain data: Sun and Earth altitude, azimuth, height above the skyline, visible disc, the next
rise or set and its text, the 30-day summary, the warnings). The card and the report both call
it, so they can't drift apart. Kept out of `state.ts`, which T33 and T37 also change.

## What the report contains

In this order, on screen and on paper. Coordinates on paper use the card's `coordText`
(`89.6866° S · 162.8100° W`, 4 decimals); the data files use signed numbers, north- and
east-positive, longitude -180 to 180. Times on paper are UTC to the minute (`utcText`); in the
data files they are full ISO 8601 with `Z`.

### 1. Title block

- **Mission:** "Mission report · <site name>" (the curated site's name, or "Scenario A" as the
  card says), and a one-line status: "Ready", "Not enough propellant" (`--bad`), "Touchdown in
  darkness" or "Earth hidden at touchdown" (`--warn`).
- **Landing site:** name, coordinates, touchdown UTC.
- **Launch pad:** name, pad, country, coordinates; launch UTC (`plan.launchMs`).
- **Mission length:** touchdown less launch (`durationText`).
- **Lander** (**added**): mass after TLI, dry mass, engine Isp, thrust (`state.lander`), with
  "example lander (Nova-C size, example Isp)" when they equal `EXAMPLE_LANDER`. Without them
  the numbers can't be reproduced.
- **Phase lengths** (**added**): ascent, parking orbit, translunar coast, lunar orbit, and
  "Apollo 11's (NASA SP-4029)" while they are `APOLLO_11_TIMES`.
- **Made:** the time the report was built (UTC). **Data:** "DE440 and LOLA", or "mock data" when
  `eph.meta.source` or the height map's `source` says mock. **Share link:** `mission.html#…`
  from `stateToAddress()`, which reopens this mission. The badge "Planning model · not a
  flight-dynamics solution".

### 2. Flight schedule: the mission's progress, phase by phase

One row per step of `plan.steps`, all ten, touchdown included (the card's table leaves it out).

| # | Phase (`id`) | Where |
|---|---|---|
| 1 | Launch, to 185 km (`launch`) | The pad and its coordinates; into a 185 km orbit inclined `orbit.parkingIncDeg` (launched due east) |
| 2 | Earth parking orbit (`parking`) | 185 km circular |
| 3 | Translunar injection (`tli`) | At 185 km; the transfer's apogee `orbit.transferApogeeKm` |
| 4 | Translunar coast (`coast`) | Earth to the Moon; Earth–Moon distance at arrival `orbit.earthMoonKm`, arrival speed v∞ `orbit.vInfKmS` |
| 5 | Lunar orbit insertion (`loi`) | 100 km above the Moon, polar; the point under the craft, `missionAt(plan, start).ground` |
| 6 | Lunar orbit (`lunar-orbit`) | 100 km circular, period `orbit.lunarOrbitPeriodS`, revolutions (duration ÷ period) |
| 7 | Descent orbit insertion (`doi`) | At 100 km; the point under the craft |
| 8 | Descent orbit (`descent-orbit`) | 100 × `orbit.descentStartAltKm` km ellipse, half a revolution |
| 9 | Powered descent (`powered-descent`) | Ignition at `orbit.descentStartAltKm` km, the point under the craft, `orbit.descentRangeKm` from the site |
| 10 | Touchdown (`touchdown`) | The site's coordinates; touchdown speed `orbit.touchdownSpeedKmS` |

Columns: number; phase over "where" in one cell; who burns (launch vehicle, lander, or coast);
start UTC over T+ (mission elapsed time, `elapsedText`); end UTC; duration; Δv; burn time;
propellant used; mass after. Twelve columns don't fit A4 portrait, so these pairs share a cell,
leaving eight. A value the model doesn't give (the launch vehicle's propellant, the TLI burn
time) is "—" on paper and `null` in the data files, never 0. The launch's Δv carries the card's
asterisk: ideal, without gravity and drag losses.

### 3. Key events (**added**)

The moments in the flight, one row each: liftoff, Earth orbit insertion, TLI, entering the
Moon's sphere of influence (LOI less `approachSeconds(plan)`), LOI, DOI, powered descent
ignition, touchdown; and "Propellant runs out" at `plan.runsOutMs` when it does. Columns: UTC,
T+, time to touchdown, near Earth or the Moon, altitude, speed, propellant left: all from
`missionAt(plan, t)`, the card's live line at that moment.

### 4. Translunar coast, every 12 hours (**added**)

From TLI to LOI every 12 h, and at LOI: T+, UTC, near Earth or the Moon, altitude above it,
speed (`missionAt`). About seven rows for Apollo 11's coast. First to go if time runs out.

### 5. Totals and orbits

- **Totals** (`plan.totals`): Δv of the launch vehicle (ideal, the asterisk) and of the lander;
  the lander's propellant loaded, used and left; the margin as a share of the load, or "short by
  X kg" in `--bad`; mass at touchdown.
- **Orbits** (**added**, `plan.orbit`): parking orbit altitude and inclination; transfer apogee;
  Earth–Moon distance at arrival; v∞; coast time; lunar orbit altitude, inclination (polar) and
  period; descent start altitude; throttle held through the descent; descent range; touchdown
  speed. When the descent starts above 15 km, say why: the engine is too weak to stop from 15 km
  (`planDescent`).

### 6. Powered descent

- **Facts:** start altitude, throttle, Δv, duration, ground range, propellant used, touchdown
  speed.
- **Chart:** altitude against distance to go (`missionAt(...).rangeToGoKm`), one point a second,
  the site at 0, spreading `plotLayout()`.
- **Table every 30 s** from ignition, plus the exact touchdown as the last row: time since
  ignition (mm:ss), UTC, altitude, speed, distance to go, propellant left.

### 7. Landing site at touchdown

From `landingConditions()`, the same numbers as the card's "At the landing site":

- **Sun:** altitude, azimuth, height above the skyline (`sunAbove`), visible share of the disc;
  or "Below the skyline". **Earth:** altitude, azimuth, height above the skyline; or "Hidden".
- **Working period:** time to sunset (or sunrise, or "Permanently shadowed (until 2100)", or
  "checking to 2100…" while that is still being worked out), as `countdownText` says.
  **Earth link:** time to Earthset or Earthrise.
- **Next 30 days:** lit %, longest light, longest dark, Earth contact %, longest gap without
  Earth (`summaryFor`).
- Where the skyline comes from: real terrain, or the smooth Moon, worded as the readout words it
  (T37 may move that line north of 85 S; don't write the latitude into the report).

### 8. The first 30 days on the surface (**added**)

The goal's "first days on the surface". Two lists from the hourly samples
(`samplesFor(sc, '30d')`): Sun up and Sun down periods, and Earth visible and hidden periods;
each with start UTC, end UTC and length. A new pure function in `core/report.ts`,
`periods(samples, body)`, tested. It uses `summary()`'s definitions (`core/windows.ts`): an hour
is lit when any of the Sun's disc clears the skyline (`sunFrac > 0`), and Earth is visible when
`earthUp`. Times are to the hour, the samples' step: the report says so.
A small strip of the same periods (like the compare strips) if time allows.

### 9. Warnings

The card's wording, from `landingConditions()` and the plan:

- "Touchdown in darkness: the Sun is below the skyline there." (`--warn`)
- "Earth is hidden at touchdown: no direct radio link." (`--warn`)
- "Not enough propellant: short by X kg. The lander runs dry at <UTC> UTC." (`--bad`); then
  Touchdown reads "not reached", and the descent table stops where it runs out.
- "Mock data: the numbers are examples." when the data are mock.
- The pad is one of the twelve whose coordinates nobody has checked yet (T34's open item), while
  that is so.

No report when there is no plan: with status `none`, `loading`, `outside`, or an error
(`bad-input`, `coast-out-of-range`, `thrust-too-low`), the button is disabled and says why, in
the card's words; the report page opened directly says the same.

### 10. Model and limits, and sources

- **Limits:** patched conics from Earth to the Moon; burns instant except the powered descent; a
  100 km circular polar lunar orbit; a gravity-turn descent at one held throttle; Apollo 11's
  phase lengths; the launch time is touchdown less the phases, no launch window is solved; the
  launch vehicle's propellant is not modelled and its Δv is ideal; no ascent from the Moon or
  return to Earth; the Earth–Moon picture is the model's plane, not an ephemeris track. The Moon
  has no atmosphere: no drag, no refraction.
- **Sources:** DE440 (JPL), LOLA, the JPL astrodynamic parameters, NASA SP-4029 (Apollo 11
  timeline), Nova-C (the example lander), the chosen pad's page; links as in
  `docs/sources/T34.md`. Kept as data in `core/report.ts`, so the JSON carries them too.

## Formats

- **Print, or Save as PDF** from the browser's print dialog. Portrait on A4 and US Letter; rows
  never split across pages (`tr { break-inside: avoid }`), table headers repeat
  (`thead { display: table-header-group }`), each section heading stays with its first rows, and
  each page carries the mission name and page number (`@page` margin boxes; check that headless
  Edge prints them, and say in the pull request if a fallback was needed). No PDF library.
- **JSON download:** `schema: "darksight-mission-report/1"`, then `generated_utc`, `data`
  (ephemeris and terrain source, or mock), `share_link`, `site` (`id` or null, `name`, `lat_deg`,
  `lon_deg`), `pad`, `lander` (`mass_after_tli_kg`, `dry_mass_kg`, `isp_s`, `thrust_n`),
  `phase_times_s`, `launch_utc`, `touchdown_utc`, `duration_s`, `phases[]` (`n`, `id`, `name`,
  `by`, `start_utc`, `end_utc`, `met_start_s`, `duration_s`, `dv_ms`, `burn_s`,
  `propellant_kg`, `mass_after_kg`, `alt_km`, `lat_deg`, `lon_deg`), `events[]`, `coast[]`,
  `totals` (`launch_vehicle_dv_ms`, `lander_dv_ms`, `propellant_loaded_kg`,
  `propellant_used_kg`, `propellant_left_kg`, `margin_pct`), `orbit`, `descent` (facts and
  `samples[]`: `t_s`, `utc`, `alt_km`, `speed_ms`, `range_to_go_km`, `propellant_left_kg`),
  `site_at_touchdown` (`sun`, `earth`: `alt_deg`, `az_deg`, `above_skyline_deg`, and the Sun's
  `disc_visible_pct`, Earth's `visible`; `next_sun_flip`, `next_earth_flip`; `summary_30d`),
  `surface_periods[]`, `warnings[]` (`code`, `text`), `model[]`, `sources[]` (`name`, `url`).
  Units in the key names; numbers not rounded, so they read back equal to the plan's; not
  modelled is `null`. The schema goes in the contract.
- **CSV download:** the flight schedule, one row per phase, UTF-8, header row
  `n,phase_id,phase,by,start_utc,end_utc,met_start_s,duration_s,dv_ms,burn_s,propellant_kg,mass_after_kg,alt_km,lat_deg,lon_deg`;
  empty cell for null; fields quoted when they hold a comma. Coordinates as numbers, not "°"
  text, so the file stays ASCII and opens the same in a spreadsheet without a byte-order mark.
- **File names:** `darksight-mission-<site>-<touchdown>.json` and `.csv`, where `<site>` is the
  curated site's id (or the coordinates, like `89.6866S-162.8100W`) and `<touchdown>` is like
  `2026-11-21T1604Z`.

Downloads are made in the browser from a `Blob`; nothing is sent anywhere.

## Design and theme (T22, T19)

- **Design first (T22's method):** add a `report` frame to `docs/design/mockup.html` (an A4 page
  in the print colours, and the on-screen view) and export `docs/design/report.png`. The brief
  has only a placeholder for this page, so this frame is the design.
- **Print colours (T19):** a dark page wastes ink, and browsers drop background colours when
  printing by default. Give the existing variables light values under `@media print` in
  `web/src/ui/theme.css`; names stay as they are (contract section 6). This is T19's file:
  coordinate with anyone changing it. Text in the print colours passes 4.5 to 1; name the checker
  in the pull request.
- **Theme:** `.card`, `.btn`, `.btn-primary`, `.table`, `.badge`, `.muted`; numbers in
  `--font-num`. The descent chart spreads `plotLayout()`. **On paper it is a picture:**
  `Plotly.toImage` drawn with the print colours, shown only under `@media print`, so it doesn't
  depend on `beforeprint` firing in every browser. No colour code, font or pixel size in the
  module; the only pixel value is the phone breakpoint.
- **On a phone** the report view is one column, and a wide table scrolls sideways inside its own
  box, never the page.

## If time runs short

Deliver in this order and stop at the freeze, saying in the pull request what was left out:

1. Title block, flight schedule, totals, warnings, model and limits; print styles; JSON and CSV.
2. Powered descent: table and chart.
3. Landing site at touchdown.
4. Key events, then the first 30 days on the surface, then the coast table.

## Files in scope

- `web/src/core/report.ts`, `web/src/core/report.test.ts` (new): `buildReport(plan, context)`
  (the report as plain data, numbers not text), `reportJson(report)`, `reportCsv(report)`,
  `reportFileName(report, ext)`, `periods(samples, body)`, and the event, coast and descent rows.
  Pure functions, no DOM.
- `web/report.html`, `web/src/reportPage/` (new): the page, loading the same data files as
  `mission.html` and mounting the report
- `web/src/ui/report/` (new): `index.ts` exporting `mount(el)`, `report.css` with the
  `@media print` rules for the report
- `web/src/ui/mission/conditions.ts` (new) and `web/src/ui/mission/index.ts`: the landing site's
  numbers moved into one function the card and report share; the "Generate full launch
  schedule" button
- `web/vite.config.ts`: `report.html` as a fourth page
- `web/src/ui/theme.css`: the `@media print` values only
- `web/e2e/smoke.spec.ts`: a smoke test that opens `report.html` with a landing point
- `docs/data-contract.md` (the `core/report.ts` row, the JSON schema, the `report.html` page)
- `docs/design/mockup.html`, `docs/design/report.png`, `docs/design.md`
- `docs/ai-use/T35.md`, `docs/sources/T35.md`, this file's `Status:` line

## Steps

1. Check that T34 has merged and the team's agreement is recorded (T34, step 1). Done.
2. Design: the `report` frame and picture.
3. `core/report.ts` with tests.
4. `landingConditions()`, used by the card first, with the card unchanged on screen.
5. `report.html`, the report view, the button in the `#mission` card, and the two downloads.
6. Print styles and print colours; print to PDF with headless Edge (`Page.printToPDF`) on A4
   and Letter, and look at every page.

## Done when

- [x] `core/report.test.ts`: the CSV has a header row and one row per phase, every time ends in
      `Z`, and its numbers read back equal the plan's; the JSON parses, has the schema version,
      every phase, and totals equal to the plan's; not-modelled values are `null`, not 0; the
      file names come out as above.
- [x] `core/report.test.ts`: the descent table starts at ignition, steps 30 s, and ends at
      touchdown (or where the propellant runs out); the events are in time order; `periods()`
      covers the 30 days with no gap or overlap, and its lit share, Earth share and longest runs
      equal `summary()`'s for the same samples.
- [x] The report's numbers are the `#mission` card's: a test builds both from one plan, and the
      landing site's numbers come from the one `landingConditions()`.
- [x] Printed to PDF with headless Edge on A4 and on Letter: light pages, no row split across a
      page, headers repeated, page numbers shown; the page count is in the pull request.
- [x] Downloads work with the network off after the page has loaded.
- [x] With mock data the title block says "mock data".
- [x] With no landing point, or a plan that fails, the button is disabled and says why, and
      `report.html` opened directly says the same and doesn't crash.
- [x] At 390 px wide the report is readable and the page doesn't scroll sideways. Searching
      `web/src/ui/report/` for `#` colour codes finds none.
- [x] `npm test`, `npm run build` and the browser smoke tests pass.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md, docs/design.md, tasks/T34-mission.md and tasks/T35-report.md. Do only T35, on branch t35-report. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. Work in the order of "If time runs short". When you think you're finished, run every line of "Done when" and show me the output for each.
```
