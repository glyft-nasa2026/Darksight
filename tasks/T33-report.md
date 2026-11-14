# T33: Mission report, print and download

Status: proposed, not started. Waits for T32 and the same team agreement (T32, step 1). Not
before M2, and not after the M3 freeze

| | |
|---|---|
| Tier | if time |
| Waits for | T32 |
| Branch | `t33-report` |

## Goal

"Generate full launch schedule" (brief, page 7) opens a report of the mission T32 planned: the
whole progress from launch to touchdown, then the first days on the surface. It can be printed
or saved as a PDF (brief, page 8: "Page for show report and print") and downloaded as data
files. No server: the browser builds the report from the same mission plan the `#mission` card
shows, so the two never disagree.

## What the report contains

In this order, on screen and on paper:

1. **Title block:** landing site name and coordinates (latitude and longitude to 4 decimals,
   north- and east-positive, longitude -180 to 180), touchdown UTC, launch pad and launch UTC,
   mission length, when the report was made (UTC), the data it used (DE440 and LOLA, or "mock
   data"), and the share link that reopens this mission.
2. **Flight schedule**, one row per phase (T32's model table): number, phase, start and end UTC,
   T+ (mission elapsed time), duration, Δv, burn time, propellant used, mass after, and where
   (the pad, the parking orbit, the lunar orbit's altitude, latitude and longitude for the
   descent start and touchdown).
3. **Totals:** Δv of the launch vehicle and of the lander, propellant loaded, used and left, and
   the margin at touchdown.
4. **Powered descent:** the altitude against distance-to-site chart, and a table every 30 s
   (time, altitude, speed, distance to go, propellant left).
5. **Landing site at touchdown:** Sun altitude, azimuth, height above the skyline and visible
   disc; Earth altitude, azimuth and visible or hidden; time to sunset and to Earthset; the
   30-day summary (lit %, longest light, longest dark, Earth contact %, longest gap). The same
   `core/` functions the readout and compare table use.
6. **Warnings** from T32 (darkness, Earth hidden, propellant, outside the table).
7. **Model and limits:** T32's list (patched conics, circular lunar orbit, the descent guidance
   used, launch window not solved, launch vehicle propellant not modelled, no atmosphere on the
   Moon so no refraction), and the sources (DE440, LOLA, the NASA reports T32 cites).

## Formats

- **Print, or Save as PDF** from the browser's print dialog. The report view prints alone (the
  rest of the page is hidden under `@media print`), portrait on A4 and US Letter, rows never
  split across pages, table headers repeat, and each page carries the mission name and page
  number (`@page`). No PDF library.
- **JSON download:** the whole plan and the landing-site numbers, with a `schema` version, units
  in the key names (`dv_ms`, `duration_s`, `mass_kg`, `alt_km`), times as ISO 8601 with `Z`.
  The schema goes in the contract.
- **CSV download:** the flight schedule, one row per phase, UTF-8, units in the header row,
  times with `Z`.
- **File names:** `darksight-mission-<site>-<touchdown>.json` and `.csv`, where `<site>` is the
  curated site's id (or the coordinates) and `<touchdown>` is like `2026-11-21T1604Z`.

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
  `--font-num`. The descent chart spreads `plotLayout()` and is drawn again after the print
  colours apply (or saved as a picture with `Plotly.toImage`; say which in the pull request). No
  colour code, font or pixel size in the module; the only pixel value is the phone breakpoint.
- **On a phone** the report view is one column, and a wide table scrolls sideways inside its own
  box, never the page.

## Files in scope

- `web/src/core/report.ts`, `web/src/core/report.test.ts` (new): `buildReport(plan, …)` (the
  report as plain data), `reportJson(report)`, `reportCsv(report)`, `reportFileName(report, ext)`.
  Pure functions, no DOM.
- `web/src/ui/report/` (new): `index.ts` exporting `mount(el)` (or opened from the `#mission`
  card), `report.css` with the `@media print` rules for the report
- `web/src/ui/mission/index.ts`: the "Generate full launch schedule" button (T32's module;
  coordinate if T32 is still open)
- `web/src/ui/theme.css`: the `@media print` values only
- `web/index.html` and `web/src/site.ts` if the report gets its own slot; `docs/data-contract.md`
  (the `core/report.ts` row, the JSON schema, the slot if any)
- `docs/design/mockup.html`, `docs/design/report.png`, `docs/design.md`
- `docs/ai-use/T33.md`, `docs/sources/T33.md`, this file's `Status:` line

## Steps

1. Check that T32 has merged and the team's agreement is recorded (T32, step 1).
2. Design: the `report` frame and picture.
3. `core/report.ts` with tests.
4. The report view, the button in the `#mission` card, and the two downloads.
5. Print styles and print colours; print to PDF with headless Edge (`Page.printToPDF`) on A4
   and Letter, and look at every page.

## Done when

- [ ] `core/report.test.ts`: the CSV has a header row and one row per phase, every time ends in
      `Z`, and its numbers read back equal the plan's; the JSON parses, has the schema version,
      every phase, and totals equal to the plan's; the file names come out as above.
- [ ] The report's numbers are the `#mission` card's: a test builds both from one plan.
- [ ] Printed to PDF with headless Edge on A4 and on Letter: light pages, no row split across a
      page, headers repeated, page numbers shown; the page count is in the pull request.
- [ ] Downloads work with the network off after the page has loaded.
- [ ] With mock data the title block says "mock data".
- [ ] At 390 px wide the report is readable and the page doesn't scroll sideways. Searching
      `web/src/ui/report/` for `#` colour codes finds none.
- [ ] `npm test` and `npm run build` pass.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md, docs/design.md, tasks/T32-mission.md and tasks/T33-report.md. Do only T33, on branch t33-report. If T32 hasn't merged or the team's agreement isn't recorded, stop and tell me. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
