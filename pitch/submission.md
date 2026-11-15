# Submission text, field by field

Paste each block into the team's Project page on spaceappschallenge.org (profile icon → My Team →
Project → Edit). The fields and their instructions are from the official
[Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)
(dated 13 Nov 2026). The guide gives no character limits. If the form shows a counter, trim to
fit and note it in `pitch/checklist.md`. All text must be in English.

Every number below is one the deployed site shows, at the fixed demo hour
(15 Nov 2026 03:00 UTC), or one recorded in the repo. `pitch/checklist.md` says where each comes
from.

---

## Project Name

Darksight

## High-Level Project Summary

Darksight is a free website that compares lunar landing sites and dates side by side: when each
site has sunlight (power) and a direct line of sight to Earth (radio), measured against the real
terrain skyline from NASA's LRO LOLA height map. It answers the Lunar Landing Site Navigator
challenge's question, "where and when can we land?", for the south pole, where the Sun skims the
horizon and a single ridge can hide it for days. A planner pins two or three scenarios and reads
countdowns to sunset and Earthset, the share of the next 30 days in sunlight and in contact, and the
longest dark gap. A nudge moves a site 1 km or a date by one day and says what changes: 1 km north
of Shackleton crater's rim loses 17 of the next 30 days of sunlight. Every Sun and Earth angle is
checked against NASA JPL Horizons, with a largest difference of 0.000001°. This matters because landing
sites are chosen to the kilometre and launch dates slip, and today the check takes about an hour
across three tools.

## Link to Project Demo

_(paste the public YouTube link to `pitch/demo/darksight-demo.webm` here, 29.2 s)_

Fallback after this branch merges:
https://github.com/glyft-nasa2026/Darksight/blob/main/pitch/demo/darksight-demo.webm

## Link to Final Project

https://darksight.space

## Detailed Project Description

**What it does.** Darksight is a website for choosing where and when to land on the Moon. You pick
a site (click the map, choose one of 24 curated sites such as the Apollo landings, Chandrayaan-3,
SLIM, south-pole candidates and upcoming mission targets, or type latitude and longitude) and a time between 1900 and 2100.
For that scenario it shows the Sun's and Earth's altitude and azimuth, how far each is above the
terrain skyline, how much of the Sun's disc is visible, and countdowns such as "Sunset in 47 d 18 h"
or "Permanently shadowed (until 2100)". Pin up to three scenarios and a compare table puts them side
by side: lit % and Earth contact % over the next 30 days, the longest unbroken light, the longest
dark and the longest gap in contact, with the best value in each row marked and a 30-day Sun and
Earth strip per scenario. A timeline, a sky panorama with the terrain skyline, and a 2D map and 3D
scene (the Sun lights the real terrain; Earth bobs at the horizon) show the same answer from
different angles. Map layers show average sunlight, Earth visibility and permanent shadow over the
whole Moon: LOLA's maps with terrain near both poles, our own smooth-Moon averages elsewhere, and
the page says which applies.

**The 1 km nudge.** Small moves change everything at the pole. The nudge buttons move the site north, south,
east or west (1 km to start, 0.1 to 10 km on a slider), one day earlier or later, or to a pole. The
site moves at once, where it was stays in grey on the map, and the panel says the difference in
words; Undo puts it back. From
the Shackleton rim on 15 Nov 2026, 1 km north gives "−17 days of sunlight in 30 days" and no Earth in
the next 60 days. The rim is lit 100.0 % of the next 30 days; the crater floor beside it, 0.0 %.

**How it works.** Python prepares the data once: a table of Sun and Earth directions seen from the
Moon every 3 hours from 1900 to 2100 (Skyfield with NASA JPL DE440), and LRO LOLA height maps: the
south pole at 240 m per cell (LDEM_75S_240M) and the whole Moon at 3.8 km per cell (from LDEM_16). At any moment the Sun's and Earth's directions from
the Moon are the same for every site; only the site's local "up" differs. So one table serves every
site, and the browser computes the rest: angles, the terrain skyline traced 150 km out in every
direction, rise and set times and percentages. There is no server, database or account. The site is
static files, and a share link reopens the same comparison. The Moon has no atmosphere, so no
refraction is applied.

**Why you can trust it.** Our angles were compared with NASA JPL Horizons for 18 cases (Sun and
Earth, several sites and times) against a tolerance of 0.1°. The largest difference is 0.000001°,
shown on a badge on every page, and a test repeats the comparison on every change. Terrain tests
check that the Shackleton crater floor is never lit to 2100 and that a rim point is lit more than
half the time. The code has 785 automated tests. The About panel lists the known limits: real
terrain everywhere, but at 240 m cells only south of 85° S and 3.8 km cells elsewhere, a 150 km
skyline, and Earth treated as a point.

**Who it's for.** Mission planners shortlisting sites and launch dates by power and radio before
detailed analysis. Educators and students who want to see why polar sites are special. Anyone
curious, on a desktop or a phone. The site also plans a flight from a launch pad on Earth to
touchdown at the chosen site and time (a planning model, not a flight-dynamics solution), with a
mission report to print or download.

**What we hope to achieve.** To make "is this site still good if we slip a day, or land a kilometre
off?" a ten-second question instead of an hour's work, and to show anyone why the lunar south pole is
both promising and unforgiving.

**Tools.** TypeScript, Vite, three.js and Plotly.js in the browser; Python, Skyfield, NumPy and
Pillow for data preparation; Vitest and Playwright for tests; GitHub Actions and Cloudflare Pages
for build and hosting. Code: https://github.com/glyft-nasa2026/Darksight (MIT licence). Slides:
https://github.com/glyft-nasa2026/Darksight/blob/main/pitch/darksight-slides.pdf

## Use of Super Intelligence (SI)

Yes. The team built Darksight with AI coding assistants: mainly Claude Code (Anthropic's Claude
Opus 5.5 and Fable 5.2 models), with OpenAI Codex for parts of the 3D scene and the deployment
set-up, ChatGPT for one stylesheet fix, and Google Gemini and ChatGPT as second readers when
fact-checking sources and site positions. The idea, the choice of challenge, the feature list and
the visual design came from the team. AI tools wrote most of the code, tests, data-preparation
scripts and documentation, and drafted this text, the slides and the video captions. A team member
checked each piece with tests, by reading it, by comparing with NASA tools (JPL Horizons, LROC
QuickMap) or in the browser. Each task keeps a public record of what the AI generated and what a
person checked, in `docs/ai-use/` (237 records from 71 task notes), summarised in `pitch/ai-use.md` and shown in
the site's About panel. No image, video or audio was generated by AI. The Earth picture is NASA's
Blue Marble, the video is a screen recording of the real site, and it and every slide carry a
visible "AI-assisted" label.

## NASA Data

- **LRO LOLA height maps** (PDS Geosciences Node): LDEM_75S_240M v2.0 for the south-pole terrain
  and skylines; LDEM_16 for the terrain and skylines everywhere else; LDEM_64 and LDEM_75N_240M for
  the whole-Moon and north-pole views.
- **LRO LOLA average illumination products** (NASA GSFC Planetary Geodesy Data Archive): the average
  Sun and Earth visibility and permanent-shadow maps of both poles (AVGVISIB_65S/65N_240M_201608,
  their _EARTH versions, LPSR_65S/65N_240M_201608) for the map layers.
- **NASA JPL planetary ephemerides DE440 and DE421** and **NAIF lunar kernels** (Moon orientation
  and frame), through Skyfield, for the Sun and Earth table from 1900 to 2100.
- **NASA JPL Horizons API**: the independent check of our angles (18 cases, largest difference
  0.000001°).
- **NASA NSSDCA** Apollo landing-site coordinates; **LROC** (NASA/GSFC/ASU) images and map server for
  landing sites (Chang'e 4–6, Chandrayaan-3, SLIM, IM-1, IM-2, Blue Ghost) and for checking site
  positions; **LROC QuickMap** as the model for the flat map.
- **NASA GSFC Planetary Geodesy Data Archive**, lunar polar illumination map (E. Mazarico), and
  Gläser et al. (2018, NASA NTRS) to choose and check the south-pole sites.
- **NASA's Artemis III landing-region update** (Malapert Massif), **NASA Blue Marble** (the Earth
  picture), the **JPL astrodynamic parameters**, the **NASA Moon fact sheet** and **NASA SP-4029**
  (Apollo 11 timeline) for the mission planner.

## Space Agency Partner Data and Other References

Partner agencies: landing sites of ISRO's Chandrayaan-3 and JAXA's SLIM are among the curated
sites (positions from LROC and NASA images of the landers), and the south-pole site names follow
Bussey et al. (2010), which used JAXA Kaguya topography.

Other data and references: IAU/USGS Gazetteer of Planetary Nomenclature; Yale Bright Star
Catalogue (CDS VizieR); IAU rotational elements (Archinal et al. 2011); Snyder, *Map Projections*
(USGS PP 1395); Wagner et al. (2017) and Speyerer and Robinson (2013), Icarus; the Okabe–Ito
colour-blind-safe palette; WCAG 2.1 contrast formula; Wikipedia pages for launch-pad coordinates
(CC BY-SA).

Software: Skyfield, NumPy, Pillow, TypeScript, Vite, Vitest, three.js, Plotly.js,
Playwright, GitHub Actions, Cloudflare Pages (all open source or free services; licences in the
list).

Full list, every source with link and licence (304 distinct sources from 68 task files):
https://github.com/glyft-nasa2026/Darksight/blob/main/pitch/references.md. The same sources appear
in the site's About panel.
