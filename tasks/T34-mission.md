# T34: Mission simulation, launch to touchdown

Status: done (P5). Seven deliveries merged: #100, #104, #106, #123, #133, #145 and #151 (P5; #133 makes the simulation's zoom between Earth orbit, the TLI coast and the Moon glide, and the 2D card zoom from Earth to the Moon to the landing site; #145 moved the mission card to its own page, `mission.html`; #151 moved "Open mission" from the landing scenario's card to beside "Copy share link" in the Scenarios panel). The team agreed on 15 Nov 2026 (F20 in `SPEC.md`); every "Done when" line passes. Issue #80 (pull request #115) added the real star sky behind the picker's globe (Earth's orientation at the planned launch) and the simulation (the transfer plane laid on the Moon's real orbit plane at touchdown). The twelve pad coordinates added in #104 are checked against their source pages by a Playwright script that an AI agent ran for Yi Hung on 15 Nov 2026 (pull request #185, a data fix, which the freeze allows): eleven match, and Taiyuan LC-9, which held its spaceport's coordinate, is fixed (`docs/sources/T34.md`). The table in #185 lets a person confirm each value in a couple of minutes. Issue #105's four changes merged in #106; the issue stays open for follow-ups. No more deliveries after the M3 freeze.

| | |
|---|---|
| Tier | if time |
| Waits for | M2 (the team agreed on 15 Nov 2026). Uses T08, T15, T19, T22 (all merged) |
| Branch | `t34-mission` |

## Goal

Choose one scenario as the landing point and watch the whole mission that ends there: from a
launch pad on Earth, through the trip to the Moon and lunar orbit, to touchdown at the
scenario's site and time. Every phase shows where the craft is, when, the Δv (change in speed)
and the propellant it costs, so the user has a full overview of the mission.

The brief already draws it (`tasks/Quarterly Company News.pdf`):

- **Page 7, "04 Simulation":** a mission header, the launch pad and final landing site cards,
  one "animation for all the process", a target-vicinity inset, an altitude readout, and five
  flight-sequence cards: Launch, Translunar injection, Lunar orbit insertion (100 km orbit),
  Powered descent (15 km to the surface), Touchdown. Buttons "Begin now" and "Generate full
  launch schedule" (that one is T35).
- **Page 6, "03 Launch Site":** seven launch pads in a list beside a globe, "Confirm launch pad".
- **Pages 4 and 5, "Mission telemetry":** translunar injection Δv and burn time, lunar orbit
  insertion Δv, powered descent Δv and duration, continuous daylight period, fuel, Earth
  line-of-sight, working period, launch window, and the note "add more: landing date, return
  date, etc."
- **Pages 4 and 5, site cards:** each has a "Finalize landing site" button. That is the button
  this task adds to the scenario cards.

`docs/design.md` ("Needs team decision", item 5) records that Launch Site and the flight
sequence have no feature in the spec. This task is that feature.

It is a **planning model, not a flight-dynamics solution**: patched conics from Earth to the
Moon, closed-form orbit changes at the Moon, and a numerically simulated powered descent. The
brief's panel says "Example values · not an orbital solution"; ours are computed, and the card
says which simplifications they rest on (Model, below).

## What the user sees

1. **"Land here" on each scenario card** in `#scenarios` (Live, A, B, C), the brief's "Finalize
   landing site". It copies that card's site and time into the mission as the landing point.
   The card that matches gets a "Landing site" badge (`.badge`). Pressing it on another card
   moves the landing point there. It is a copy, because pinned scenarios never change
   (`docs/decisions.md`, 14 Nov); editing Live afterwards doesn't move the landing point.
2. **A new full-width card, `#mission`**, under the sky panorama:
   - **Header:** the landing site's name (if it is a curated site) and coordinates, touchdown
     UTC, the launch pad, launch UTC and mission length.
   - **Launch pad:** the brief's seven pads, Kennedy LC-39A first (page 6). A `select` or radio
     list in `.field` style; no globe needed.
   - **Animation**, in three scales, one after the other:
     1. Earth and Moon: ascent to the parking orbit, translunar injection, the coast arc,
        arrival at the Moon.
     2. The Moon: lunar orbit insertion into a 100 km circular orbit, the parking orbit, the
        descent orbit down to 15 km.
     3. The landing site: the powered descent as altitude against distance to the site,
        ending on it.

     Play and pause, a speed choice, a scrubber, and the five flight-sequence cards as chapter
     buttons (the current one marked as the brief does). Under the animation, a live line:
     phase, UTC, mission elapsed time (T+), altitude, speed, propellant left.
   - **Telemetry table:** per phase, the start UTC, duration, Δv, burn time, propellant used and
     mass after; then the totals and the propellant left at touchdown, as kilograms and as a
     share of the load. The brief's "fuel efficiency 88 / 100, example index" becomes this
     margin: a real number, not an index.
   - **At the landing site**, from the existing `core/` functions and `state.ts` accessors, for
     the touchdown time: Sun altitude and visible disc, Earth visible or hidden, time to sunset
     (the brief's "working period" and "continuous daylight period"), time to Earthset, lit %
     and Earth contact % over the next 30 days. The same numbers the readout and compare table
     would show for that site and time.
   - **Warnings** (`--warn`, or `--bad` for the last one): touchdown in darkness; Earth hidden at
     touchdown; touchdown time outside the Sun and Earth table; not enough propellant (then the
     animation stops where it runs out and Touchdown reads "not reached").

## Model (`core/mission.ts`)

Times run **backwards from touchdown**, which is the landing scenario's time exactly. Each phase
gets a start, an end, a Δv and a position over time.

| # | Phase | How | Duration |
|---|---|---|---|
| 1 | Ascent to a 185 km circular parking orbit | Δv from a cited budget (gravity and drag losses included). Launch azimuth from the pad latitude and the orbit inclination (`cos i = cos φ sin Az`) | Cited (Apollo 11 reached orbit at about 12 min) |
| 2 | Parking-orbit coast | | Input, cited default (Apollo 11, about 2 h 44 min to TLI) |
| 3 | Translunar injection (TLI) | Vis-viva: from the parking orbit to a transfer ellipse that reaches the Earth-Moon distance at arrival (from `eph`) in the chosen coast time | Burn: not modelled (launch vehicle) |
| 4 | Translunar coast | Time of flight on that ellipse, Kepler's equation; the coast time is an input (default 3 days, Apollo-like), and the ellipse is solved for it | Input |
| 5 | Lunar orbit insertion (LOI) | Patched conic: arrival speed relative to the Moon (v∞) from step 4, then `Δv = √(v∞² + 2μ/r) − √(μ/r)` into a 100 km circular orbit, inclined enough to pass over the site | Burn from the rocket equation and the lander's thrust |
| 6 | Lunar parking orbit | Circular, 100 km; the Moon turns under it once per 27.32 days | Input, cited default (Apollo 11, about 1 day) |
| 7 | Descent orbit insertion (DOI) | Hohmann half: 100 km circle to a 100 × 15 km ellipse | Half the ellipse's period (about 57 min) |
| 8 | Powered descent | Numerically integrated from the 15 km periapsis to the surface under the lander's thrust and Isp (below) | From the simulation |
| 9 | Touchdown | At the site, at the scenario's time | |

- **Propellant** is the lander's, from separation after TLI: rocket equation for the short burns
  (LOI, DOI), the integrated mass flow for the descent. The launch vehicle's phases show Δv and
  time only; its propellant is not modelled. The lander's four inputs (mass after TLI, dry mass,
  engine Isp, maximum thrust) are editable in the card, with defaults from one cited public
  source (a CLPS lander's published figures, or the Apollo LM descent stage from the Apollo 11
  Mission Report). Record the choice in `docs/sources/T34.md`.
- **Powered descent guidance:** the implementer's choice, from a cited source. The simplest is a
  gravity turn (thrust against the velocity) with the throttle found by shooting so the speed
  reaches zero at the ground; the reference profile (braking, approach, landing) is in Bennett
  1970. A pure gravity turn from 15 km needs one exact thrust level: checked while writing this
  ticket (Isp 311 s, simple fixed-step integration), it is a thrust of 4.6 m/s² per unit of
  starting mass (2.9 lunar g), giving Δv 1.76 km/s, 4.8 min and 260 km from ignition to the
  site. If the lander can't reach the needed thrust, raise the descent start or use another
  law, and say which in the card.
- **Placing the orbit:** compute the descent first, so its ground distance is known; place the
  descent start that far before the site along the ground track; choose the orbit plane so the
  track crosses the site at touchdown, with the Moon turning underneath. Positions on the Moon
  are latitude, longitude and altitude in the Moon-fixed frame (contract section 1).
- **Earth-Moon picture:** drawn in the plane of the transfer ellipse, with the Moon where the
  ellipse meets it. The card labels it a picture of the model, not an ephemeris track.
- **Constants:** μ Earth 398600.4418 km³/s² and Earth radius 6378.137 km (WGS 84); the Moon's GM
  from the DE440 header (4902.80 km³/s², copy the exact value); Moon radius 1737.4 km (contract);
  g₀ 9.80665 m/s². The Moon has no atmosphere: no drag, no refraction.
- **Not in this task:** the return to Earth and the ascent from the Moon; the launch vehicle's
  propellant; a launch window from the pad's rotation and the Moon's declination (the launch
  time is touchdown minus the phases, and the card says so); n-body or ephemeris-accurate
  trajectories; the "01 Explore … 04 Simulation" tabs in `#about`.

Suggested functions (agree the final names in the contract, section 3):
`planMission(input): MissionPlan` (phases, events, totals, warnings) and
`missionAt(plan, tMs)` (phase, altitude, speed, propellant left, Earth-Moon picture position,
Moon-fixed latitude, longitude and altitude, descent distance to go). The animation draws only
what `missionAt` returns.

## Design and theme (T22, T19)

- **Design first (T22's method).** Before coding the card, add a `mission` frame to
  `docs/design/mockup.html`, built from brief pages 6 and 7 and recoloured to `theme.css` as T22
  did with the other frames, and export `docs/design/mission.png` (1280 wide) and a phone
  picture (390 wide), with headless Edge as in `docs/mcp-and-skills.md` section 3. Update
  `scenarios.png` with the "Land here" button and the "Landing site" badge. A value the design
  needs that the contract doesn't name goes in `docs/design.md`, "Needs team decision"; never
  invent one in a module.
- **Theme (T19).** Shared classes `.card`, `.btn`, `.btn-primary`, `.field`, `.table`, `.badge`,
  `.muted`; numbers in `--font-num`. Plotly charts spread `plotLayout()`; three.js colours come
  from `themeColor()`: Earth `--earth`, Sun `--sun`, the Moon's surface `--terrain-lo` to
  `--terrain-hi`, the craft and its path `--accent`, the landing site in the colour and letter
  of the scenario it came from. The brief's orange-red buttons become `.btn-primary`. No colour
  code, font or pixel size in the module; the only pixel value is the phone breakpoint.
- **Layout (T19's `layout.css`):** a `mission` area across both columns after `sky` on desktop,
  and last on the phone. Coordinate with anyone changing `layout.css`.
- **Motion:** under `prefers-reduced-motion` the animation does not play by itself and changes
  of scale are cuts, not glides; the scrubber and chapter buttons still work.

## Files in scope

- `web/src/core/mission.ts`, `web/src/core/mission.test.ts` (new): the model above
- `web/src/core/pads.ts`, `web/src/core/pads.test.ts` (new): the seven pads (id, name, pad,
  country, latitude, longitude), each checked against a cited source, not copied from the brief
- `web/src/ui/mission/` (new): `index.ts` exporting `mount(el)`, `mission.css`
- `web/src/ui/scenarios/index.ts` and its CSS: the "Land here" button and the badge
- `web/src/state.ts`, `web/src/state.test.ts`: the landing point (a copy of a site and time, or
  null), the pad and the lander's inputs, their actions, and their keys in the page address so a
  shared link opens the same mission
- `web/index.html` (the `#mission` slot), `web/src/site.ts` (its mount), `web/src/ui/layout.css`
- `docs/data-contract.md` sections 3, 4 and 5; `docs/design/mockup.html` and the new pictures,
  `docs/design.md`
- Added on 15 Nov at P5's request (branch `t34-mission-b`, after #100 merged): "Proceed" and the launch-site picker
  (`web/src/ui/launch/`, `web/public/textures/earth.jpg`), more pads in `core/pads.ts`, and the
  launch simulation page (`web/simulation.html`, `web/src/simulation/`, `web/vite.config.ts`)
- After step 1: `SPEC.md` (section 2, a new feature row), `docs/decisions.md` (one line),
  `history.md` (the cut line's old wording), `tasks/README.md` (status on the board)
- `docs/ai-use/T34.md`, `docs/sources/T34.md`, this file's `Status:` line

three.js and Plotly are already dependencies: no new package. If the Moon in the animation
reuses `web/src/scene/globe.ts`, import it; coordinate with the scene's owner before changing
scene files.

## Steps

1. **Agree the scope change.** Post in the chat: landing trajectories move from Out to If time,
   as this task and T35. When agreed, write the line in `docs/decisions.md`, move the item in
   `SPEC.md` section 2, add feature rows (mission simulation, mission report), and record the old
   wording in `history.md`. If the team says no, set this file's `Status:` to "declined" and
   stop.
2. Design: the `mission` frame and pictures (Design and theme, above).
3. `core/pads.ts` and `core/mission.ts` with tests, including the numbers under "Done when".
4. State: the landing point, pad and lander inputs, actions, and the address keys.
5. The "Land here" button and badge on the scenario cards.
6. The `#mission` card: header, pad, telemetry table, landing-site conditions, warnings.
7. The animation, reading positions only from `missionAt`.
8. Layout area, phone order, reduced motion; check at 1280 and 390 wide.

## Done when

- [x] The team's agreement is recorded: `docs/decisions.md`, `SPEC.md` section 2 and its feature
      rows, `history.md`.
- [x] `docs/design/mission.png` and the phone picture exist, made from `mockup.html` with contract
      section 6 names only.
- [x] "Land here" on each of Live, A, B and C sets the landing point and moves the badge; editing
      Live afterwards leaves the landing point alone; reloading the shared link restores the
      landing point, pad and lander inputs.
- [x] `core/mission.test.ts` checks, with these expected values (computed from the formulas with
      a short Python check while writing this ticket):
  - TLI from a 185 km circular orbit to a Hohmann ellipse reaching 384,400 km: 3.135 ± 0.005
    km/s, coast 4.98 ± 0.01 days; a shorter coast needs more Δv.
  - LOI into a 100 km circular orbit from v∞ = 0.8 km/s: 0.811 ± 0.002 km/s.
  - DOI from 100 km circular to 100 × 15 km: 19.5 ± 0.2 m/s; the 100 km orbit's period
    117.8 ± 0.2 min.
  - The powered descent ends under 3 m/s at the surface, its Δv is above the periapsis speed
    (1.692 km/s) and under 2.2 km/s, and the gravity-turn case above agrees with the simulation
    within 2 %.
  - Rocket equation: propellant for a Δv, and the Δv back from that propellant, agree to 1e-9.
  - Touchdown is at the scenario's time exactly, and within 0.01 degrees of its site.
  - Phases are in order, touch end to start, and have positive durations.
- [x] At the crater floor (`shackleton-floor`) the card warns "Touchdown in darkness" whenever the
      readout says the Sun is hidden there; the same for Earth.
- [x] With `eph` null the card shows "Loading" and never crashes; with mock data it says so.
- [x] Every number in the card comes from `core/`; `ui/mission/` computes no angle, Δv or mass.
- [x] With reduced motion on, nothing plays by itself.
- [x] At 1280 and 390 px wide nothing overlaps or scrolls sideways; `#mission` is full width after
      the sky panorama, and last on the phone. Searching `web/src/ui/mission/` for `#` colour codes
      finds none.
- [x] `npm test` and `npm run build` pass.

## Sources to start from

- `tasks/Quarterly Company News.pdf`, pages 4 to 7 (the brief's wireframes), and `docs/design.md`.
- F. V. Bennett, *Apollo Lunar Descent and Ascent Trajectories*, NASA TM X-58040, 1970:
  https://ntrs.nasa.gov/citations/19700024568 (descent phases, DOI, powered descent).
- *Apollo 11 Mission Report*, MSC-00171, 1969: https://ntrs.nasa.gov/citations/19700008096
  (mission timeline, burns and their Δv, LM masses).

Read and cite the pages used in `docs/sources/T34.md`; the ticket names them only as a start.

## Prompt to paste into Claude Code

```text
Read CLAUDE.md, docs/data-contract.md, docs/design.md, docs/mcp-and-skills.md section 3 and tasks/T34-mission.md. Do only that task, on branch t34-mission. Start with step 1: if the team's agreement isn't recorded yet, stop and tell me. Use "Files in scope" as the starting scope; follow CLAUDE.md's coordination rules for any additional files or dependencies. When you think you're finished, run every line of "Done when" and show me the output for each.
```
