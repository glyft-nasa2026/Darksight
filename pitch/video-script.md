# Demo video: script

**Limit:** 30 seconds or less (Space Apps project submission guide, 13 Nov 2026; a longer video
is not eligible for global judging). **File:** `pitch/demo/darksight-demo.webm`, 28.8 s,
1280 × 720, silent, English captions burned in. **Made by** `node pitch/tools/record-demo.mjs`,
which drives the deployed site at darksight.space and cuts out the loading.

The one moment the video is built around: **move the pin 1 km and the sunlight collapses.**

All scenes use the same link, fixed at 15 Nov 2026 03:00 UTC, so the numbers don't change with
the day it is recorded:
`https://darksight.space/#live=-89.6866,-162.81,2026-11-15T03:00:00Z&a=-89.67,129.78,2026-11-15T03:00:00Z`
(live: Shackleton rim; A: Shackleton crater floor).

| Time | On screen | Caption (numbers read from the page while recording) |
|---|---|---|
| 0:00–0:03 | Title card on the page background | NASA SPACE APPS 2026 · LUNAR LANDING SITE NAVIGATOR · TEAM GLYFT / **DARKSIGHT** / When does a landing site on the Moon have sunlight and a line to Earth? |
| 0:03–0:07.5 | Problem card | A launch slips by a day. Does the landing site still get sunlight for power, and a line to Earth for radio? Today that answer takes about an hour across three tools. |
| 0:07.5–0:13.5 | The page scrolls to the Compare card; ring around it | Darksight compares sites in seconds. Shackleton rim: **100.0 %** lit over 30 days. The crater floor next to it: **0.0 %**. |
| 0:13.5–0:15 | Back to the map; ring around the Nudge panel | Now move the pin just **1 km north**… |
| 0:15–0:21.5 | "1.0 km N" pressed; the panel lists the change in red | …and the sunlight collapses: **−17 days of sunlight in 30 days**, and Earth drops out of sight. One kilometre. |
| 0:21.5–0:25 | Ghost discarded; ring around the Horizons badge in the top bar | Real NASA LOLA terrain and JPL ephemeris. Every angle checked against **JPL Horizons**: largest difference **0.000001°**. |
| 0:25–0:28.8 | End card | FOR MISSION PLANNERS, EDUCATORS AND THE CURIOUS / **DARKSIGHT** / Free in any browser: darksight.space |

A small label stays in the top-right corner the whole time: "AI-assisted build (Claude Code) ·
screen recording of the real site". The guide asks for a visible mark on any video made with
AI help. This video is a screen recording of the site, not generated footage, but the site
code and the captions were written with AI help, so it carries the label.

## What the video covers ("Done when")

| Needed | Where |
|---|---|
| Compare | 0:07.5–0:13.5 |
| Nudge | 0:13.5–0:21.5 |
| Horizons badge | 0:21.5–0:25 |
| Within the limit | 28.8 s, checked with ffmpeg (`Duration: 00:00:28.80`) |

## To record it again

After a redeploy, or if the site's wording changes:

```bash
cd web && npm ci && cd ..
node pitch/tools/record-demo.mjs
```

The script stops with an error instead of recording a wrong caption if the page doesn't show
what it expects: the compare rows, the "1.0 km N" result or the badge number. Stills of each
scene go to `pitch/demo/frames/` (not committed). For a voice-over, record it over the same
timings. Any spoken language is fine because the captions are already in English.

## Uploading

The form takes a link, not a file. Upload `darksight-demo.webm` to YouTube (public or unlisted,
not private), open the link in a private window to check that it plays without signing in, and
paste the link into the form. Fallback, once this branch has merged: the file on GitHub,
`https://github.com/glyft-nasa2026/Darksight/blob/main/pitch/demo/darksight-demo.webm`.
