# Load time on the real data (T27)

How long a judge waits on darksight.space with the real data. Every number here was measured
on the deployed site; nothing is estimated. A cell reading "–" is not measured yet.

| | |
|---|---|
| Measured on | 14 Nov 2026, 15:59 to 16:20 UTC |
| Commit measured | `961b65c` on `main` (T16, pull request #93). Every load served `assets/index-OfvBzPX0.js` and `assets/site-DbV41jqK.js`, the bundles in the `deploy` branch's build of `961b65c` (`71e3b3e`). The site has no `version.txt`: that address returns the page itself |
| Laptop | Lenovo 83JC, AMD Ryzen 7 7435HS, Windows 11 Home; Brave 1.99.57 (Chromium 157.0.8103.79) |
| Phone | Realme 6 (RMX2001), Android 11, Brave 1.99.57 (Chromium 157.0.8103.79), LTE mobile data with Wi-Fi off, no throttle. Measured 15 Nov 2026, 03:34 to 03:37 UTC, on the deploy live then (`237d5f6`, or `47ed7ee` just before it; both after issue #96's fix, pull request #109). Driven from the laptop over USB (Android Platform Tools 37.0.3, `adb forward` to Brave's DevTools socket) in a tab the script opened and closed; darksight.space's stored data cleared and the HTTP cache off before each load. **One load per measurement, not three** |
| Method | A Playwright script (Python, Playwright 1.65.2) drove the installed Brave in a visible 1440 x 900 window. Each load ran in a new, empty browser profile, with the HTTP cache switched off over the DevTools protocol, so Cache Storage held no decade files. "Fast 4G" is DevTools' own preset (9 Mbps down and 1.5 Mbps up, each x 0.9, 165 ms latency), set with `Network.emulateNetworkConditions`. Times are from the start of navigation, which is the moment Enter is pressed. The script clicked "Start exploring" as soon as it appeared, at 0.51 to 0.57 s on Fast 4G and 0.17 to 0.18 s with no throttle. Freezes are the longest `longtask` entries reported by the page. The script stays outside the repo, because this task changes no code (see section 7) |

## 1. What goes over the network

The bytes sent over the network include the response headers. The unpacked size is the size of
the file itself. Every response came over HTTP/3. Every `.bin` file is served as
`application/octet-stream`, without compression.

| File | Sent over the network | Unpacked | `content-encoding` |
|---|---|---|---|
| `data/ephemeris.json` | 1.1 KB | 3.1 KB | `br` |
| `data/sites.json` | 2.3 KB | 7.3 KB | `br` |
| `data/ephemeris/2020.bin` | 0.70 MB | 0.70 MB | none |
| `data/dem.bin` | 12.85 MB | 12.84 MB | none |
| `assets/index-OfvBzPX0.js` (main page) | 10.6 KB | 24.4 KB | `br` |
| `assets/site-DbV41jqK.js` (the site, fetched after "Start exploring") | 1.60 MB | 5.31 MB | `br` |
| `assets/plotly.min-Bl0pfJvI.js` | 0.6 KB | 58 B | `br` |
| `data/globe.bin` (issue #66, picture only) | 8.30 MB | 8.29 MB | none |
| `data/north.bin` (issue #66, picture only) | 0.52 MB | 0.52 MB | none |
| `data/stars.bin` (issue #80, picture only; added after these measurements) | not measured | 0.09 MB | none |

Total for a first visit: about 24 MB, of which 21.7 MB is the three height files.

## 2. Load times

Seconds from pressing Enter on the plain address. Three loads on each connection; the median is
first, then all three.

| Moment | Fast 4G | No throttle | Phone, mobile data |
|---|---|---|---|
| Readout shows Sun and Earth numbers (smooth Moon) | **6.46** (5.72, 6.58, 6.46) | **1.37** (1.44, 1.37, 1.34) | **5.60** (one load) |
| "Loading" line at the top gone (height map in) | **29.20** (25.75, 29.50, 29.20) | **2.20** (2.27, 2.20, 2.17) | **8.75** (one load, after #109) |
| Scene shows terrain (2D map, the default view: caption "South-pole terrain") | **29.20** (25.75, 29.50, 29.20) | **2.20** (2.27, 2.20, 2.17) | – |

On Fast 4G, what the waiting is made of:

| Event | Seconds |
|---|---|
| `2020.bin` in | 2.90 to 2.95 |
| `site-*.js` in. Its download starts only when "Start exploring" is clicked | 4.45 to 4.60 |
| Numbers on screen, after a 0.96 s long task that runs as soon as `site-*.js` arrives | 5.72 to 6.58 |
| `globe.bin` in. It downloads from 5.7 s on, alongside `dem.bin` | 22.94 to 23.83 |
| `dem.bin` in | 24.61 to 24.64 |
| "Loading" gone and terrain shown, after the height-map long tasks | 25.75 to 29.50 |

## 3. Longest freeze after loading

The longest long task on the laptop, with no throttle and everything loaded, from three
sessions. Each action was checked to have taken effect: the site changed, the time moved
from 14 Nov to 26 Nov during the drag, a scenario card was added, and every floor spot reads
"Permanently shadowed".

| Action | Laptop | Phone |
|---|---|---|
| Pick a new site south of 85 S (a map click; it landed at -88.91, 138.73) | **165 ms** (165, 73, 99) | – |
| Drag the time on the timeline (3 s back and forth) | **144 ms** (132, 144; 59 tasks over 50 ms per drag) | – |
| Pin | **under 50 ms** (no long task in any of three sessions) | – |
| Five new spots on the Shackleton floor (issue #32, row 1) | **486 ms** (per spot: 486, 440, 436, 484, 470 / 225, 223, 247, 245, 239 / 258, 254, 253, 223, 246) | **1022 ms** (per spot: 785, 886, 828, 810, 1022; one session) |

The floor spots were entered in the Latitude and Longitude boxes, one box per spot, so each
change is exactly one new site. The new site goes through the same `setLiveSite` call as a map
click. They were, in order: -89.70, 129.78; -89.70, 124.0; -89.65, 124.0; -89.65, 135.0;
-89.69, 135.0. All are within about 1.5 km of `shackleton-floor` (-89.67, 129.78).

**Freezes while loading** fall outside this budget, but a judge sees them. They are the longest
tasks between pressing Enter and the page being quiet:

| Connection | Longest task during loading | What it follows |
|---|---|---|
| Fast 4G | 1.09, 2.29, 2.08 s | 0.96 s right after `site-*.js` arrives; about 1.1 s right after `globe.bin` arrives (then 0.79 s); 0.34 and 0.52 s right after `dem.bin` arrives |
| No throttle | 1.91, 1.63, 1.96 s | 0.74 s after `site-*.js`; **1.06 s after `globe.bin`, which arrives at 2.9 s, after the "Loading" line is already gone** |

The "what it follows" column comes from one extra load on each connection that recorded every
long task with its start time.

On the phone (one load, mobile data, after #109) the long tasks of 300 ms or more while loading
were 2.52 s (at 2.9 s, as the site script arrives), 0.80 s and 1.30 s (as `dem.bin` arrives),
and **2.47 s then 1.36 s as `globe.bin` arrives at 15.1 s, after the "Loading" line has gone at
8.75 s**. That freeze is issue #118.

## 4. "Loading" when the time enters a decade not on the device

Each run started from an empty profile, so no decade was stored. Shown: seconds that some panel
says "Loading" (issue #32, row 2).

| Action | Fast 4G | No throttle | Phone, mobile data |
|---|---|---|---|
| Page the timeline from December 2029 into January 2030 | **0 s: never shows "Loading"** | **0 s: never shows "Loading"** | **0 s: never shows "Loading"** (every decade from 2020 to 2090 was already in, fetched in the background after loading) |
| Set the time to 1969 (typed in the Time box) | **1.42 s** | **0.61 s** | **0.63 s** (shown from 0.63 to 1.25 s after the change) |

Paging setup: live at `shackleton-rim` at 2029-09-01 00:00 UTC, nothing pinned, range 30 d,
with only `2020.bin` loaded at the start. "Later" was clicked one step at a time.
`2030.bin` (0.70 MB) was fetched in the background, without holding any panel, on the click
that moved the window from 1 to 30 Oct to 16 Oct to 14 Nov 2029. By December it was
already there. Not measured: arriving at a time in late December 2029 directly (a typed time
or a share link), which needs `2030.bin` at once. It would likely behave like the 1969 case.

1969: `1960.bin` (0.70 MB, no compression). In the trial run the day before, the same
measurement gave 1.45 s and 0.62 s.

## 5. Budgets

| Budget | On "Fast 4G" | Measured | Result |
|---|---|---|---|
| Sun and Earth numbers on screen | 3 s | 6.46 s (median of 3) | **Fail** |
| Height map in | 20 s | 29.20 s (median of 3) | **Fail** |
| Height map in, again after issue #96's fix 1 (pull request #109, commit `d70ffbd`, measured 15 Nov 2026) | 20 s | 16.44 s (median of 3: 16.63, 16.42, 16.44) | **Pass** |
| Longest freeze after loading, phone (Realme 6) | 0.5 s | 1.022 s (Shackleton floor, one session) | **Fail**: every one of the five spots is over 0.5 s (785 to 1022 ms). Issue #32, row 1 |
| Longest freeze after loading | 0.5 s | 0.486 s (Shackleton floor, laptop) | **Pass**, by 14 ms, on the laptop only. Not yet measured on a phone, which will be slower. The 1.06 s freeze when `globe.bin` arrives after loading is outside the four actions; see section 6, item 3 |

## 6. Fails and who can fix them

Each item has its numbers and the files a fix would touch, so anyone can claim it as a separate
task or pull request. This task changes no code. After a fix merges, the same measurement is
run again and a second row is added to section 5.

**1. Numbers on screen: 6.46 s against 3 s.** Follow-up: issue #95, not claimed yet.

- The data is not the problem: `2020.bin` is in at 2.9 s. The page waits for the 1.60 MB site
  script, which starts downloading only when "Start exploring" is clicked and arrives at
  about 4.5 s. Running it then takes another 0.96 s before the numbers show.
- Options: fetch the site script while the main page is still showing; split the parts not
  needed for the first numbers (Plotly, three.js) out of the site script; make the first run
  of the site cheaper.
- Files: `web/src/main.ts` (`loadSite`), `web/src/site.ts`, `web/src/ui/intro/index.ts`,
  `web/vite.config.ts`.

**2. Height map in: 29.20 s against 20 s.** Follow-up: issue #96. Fixed by its first option
(pull request #109): `globe.bin` and `north.bin` now start once `dem.bin` is in. Measured again
on 15 Nov 2026 on darksight.space, commit `d70ffbd` (`assets/main-Br7Jt4jk.js`), same laptop,
Brave and method: **16.44 s** on Fast 4G (16.63, 16.42, 16.44), `dem.bin` in at 15.61 to
15.82 s, then one 0.52 to 0.53 s long task before the "Loading" line goes. No throttle: 2.31 s
(2.28, 2.31, 2.35). The other options below were not needed for the budget; compression is
still listed in issue #118.

- `dem.bin` (12.85 MB) is sent without compression and shares the connection with `globe.bin`
  (8.30 MB) and `north.bin` (0.52 MB), which are for the picture only and also uncompressed.
  Together they are 21.7 MB, which at Fast 4G's 8.1 Mbps is about 21 s of transfer. Then 1.1 to
  4.9 s pass between `dem.bin` arriving and the "Loading" line going.
- Options, which can be combined:
  - Fetch `globe.bin` and `north.bin` only after `dem.bin` is in: `web/src/scene/globeHeights.ts`
    and `web/src/scene/globe.ts`, from issue #66.
  - Serve the `.bin` files compressed. Today Cloudflare sends them as `application/octet-stream`
    with no `content-encoding`. Whether a header rule or a different file type gets them
    compressed has not been checked here. Files: hosting setup (T21) and possibly the loaders
    `web/src/core/dem.ts` and `web/src/scene/globeHeights.ts`.
  - A coarser height map: T04's data preparation, `data-prep/make_dem.py`,
    `web/public/data/dem.json` and `dem.bin`. The contract lets `size` and `pixel_m` change; if
    the grid gets coarser, update the "Height map is 240 m per cell" line in `SPEC.md`
    section 8.
  - Shorter work after the download (0.34 s and 0.52 s long tasks): `web/src/core/dem.ts`,
    `web/src/core/shade.ts` and `web/src/map/index.ts`.

**3. Not a budget line, but noticed: a 1.06 s freeze after loading when `globe.bin` arrives.**
With no throttle it comes 0.6 s after the "Loading" line is gone, so the page looks ready and
then stops for a second. On Fast 4G it falls inside the loading time, at about 1.1 s. Files:
`web/src/scene/globeHeights.ts`, `web/src/scene/globe.ts` and `web/src/map/index.ts`
(issue #66). Follow-up: issue #118. After pull request #109 it is still there (1068, 1125,
1604 ms on Fast 4G; 1046, 1074, 1059 ms with no throttle), and on Fast 4G it now comes at about
30 s, after the "Loading" line has gone at 16.4 s.

**4. Close to the budget: the Shackleton floor freeze, 486 ms on the laptop.** It is a pass, but
a phone will be slower. If the phone measurement fails, the file is `web/src/state.ts`
(`neverLitFor`, `lastLitMs`), and the numbers go in issue #32. The possible fixes listed there
still apply.
Measured on the phone on 15 Nov 2026: **fails**, 785 to 1022 ms a spot (section 3). A profile of
one spot on the laptop with the CPU slowed 4 times (1237 ms in all) put 753 ms in `neverLitFor`'s
hour-by-hour scan (`lastLitMs` in `web/src/state.ts`, most of it in `sunAltAz`), 227 ms in the
new spot's skyline (`skylineAt`) and about 160 ms in Plotly. The results and fix options are in
issue #32.

## 7. How to measure again

The measurement script is not in the repo, because this pull request changes no code. It does
what is described under "Method" above: a fresh profile per load, the cache off, DevTools'
Fast 4G values, three loads per connection, then the freezes and the decade test. The team can
ask for it to be added in a separate pull request, for example as `tools/measure-load.py`, so a
fix can be checked against the same numbers.
