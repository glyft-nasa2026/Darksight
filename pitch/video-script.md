# Demo video: script (second version)

**Limit:** 30 seconds or less (Space Apps project submission guide, 13 Nov 2026; a longer video
is not eligible for global judging). **File:** `pitch/demo/darksight-demo.webm`, 29.4 s,
1280 × 720, silent, English captions burned in. **Made by** `node pitch/tools/record-demo.mjs`,
which drives the deployed site at darksight.space and its launch simulation page, and cuts out
the loading.

This version replaces the 1 km nudge story (first version, `git log pitch/video-script.md`)
with a tour of the features: the question, famous sites, solar panels, compare, timeline, the
launch simulation and the Horizons check.

The site opens at a fixed hour, 15 Nov 2026 03:00 UTC, with Live on the connecting ridge and A on
the Shackleton crater floor; the sites scene picks Shackleton rim from the list. The simulation
page plans the landing at Shackleton rim at the same hour.

| Time | On screen | Voiceover (the captions use the shorter form, see below) |
|---|---|---|
| 0:00–0:03.3 | Title card: INTRODUCING · **DARKSIGHT** · A Lunar Landing Site Navigator, built for NASA Space Apps Challenge 2026 · Team GLYFT | "Introducing Darksight: a Lunar Landing Site Navigator we developed for NASA Space Apps Challenge 2026." |
| 0:03.3–0:08.3 | Question card: FOR MISSION PLANNERS AND CURIOUS MINDS · "Does our lunar lander get enough solar power, and still talk to Earth?" | "It lets mission planners and curious minds ponder a mission-critical question: does our lunar lander get enough solar power, and still talk to Earth?" |
| 0:08.3–9.8 | Ring around the site list; Shackleton rim is picked and the pin moves | "Look up famous landing sites, with their real terrain skyline." |
| 0:09.8–11.3 | The sky panorama: the terrain skyline, the Sun's and Earth's paths | (same line) |
| 0:11.3–13.3 | Ring around the solar panel card: flat against upright panel, the battery | "Know your solar panels." |
| 0:13.3–16.3 | Ring around the compare table: rim against floor, best values marked | "Compare sites to find the best one." |
| 0:16.3–19.3 | The timeline chart, dragged left to right; the time marker follows | "Scrub the timeline to find your perfect landing time." |
| 0:19.3–24.3 | The launch simulation page: liftoff from Kennedy LC-39A, the transfer, lunar orbit, the site marked; the five phases light up below | "Then simulate the launch, all the way to touchdown." |
| 0:24.3–27.3 | Back on the site; ring around the Horizons badge | "Every angle is checked against NASA JPL Horizons." Caption adds the badge's number, read from the page: 0.000001°. |
| 0:27.3–29.7 | End card: **DARKSIGHT** · Sunlight and Earth contact, in a single website · darksight.space | "Sunlight and Earth contact, in a single website. Darksight." |

A small label stays in the bottom-right corner the whole time: "AI-assisted build (Claude Code) ·
screen recording of the real site" (the guide's rule on AI help, as in the first version).

## Fitting a voiceover into 30 seconds

As written the voiceover is about 95 words; 30 seconds of calm speech holds about 75. Cut in
this order until it fits:

1. Title: "Introducing Darksight, built for NASA Space Apps 2026." The challenge name is on the card.
2. Question: drop "and curious minds".
3. End card: just "Darksight." The address is on screen.

With all three it is about 77 words, and the question stays word for word.

## Notes

- The launch simulation is a planning model (patched conics, a simulated powered descent), not
  a flight-dynamics solution; the page says so in its corner. Say "simulate", never "the real
  flight path".
- Each scene ends at a fixed time in the recorder, so a slow step (the site recomputing after the
  pick) shortens the wait after it, not the next scene. If a run still goes over the limit, the
  recorder plays the whole video slightly faster rather than cutting anything.
- Stills every 3 s go to `pitch/demo/frames/` (not committed).

## To record it again

```bash
cd web && npm ci && cd ..
node pitch/tools/record-demo.mjs
```

Uses `ffmpeg` from the PATH for VP9 when there is one, else Playwright's own build (VP8).
