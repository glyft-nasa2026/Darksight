# Demo video: script (second version)

**Limit:** 30 seconds or less (Space Apps project submission guide, 13 Nov 2026; a longer video
is not eligible for global judging). **File:** `pitch/demo/darksight-demo.webm`, 1280 × 720,
English captions burned in. **Made by** `node pitch/tools/record-demo.mjs`, which drives the
deployed site at darksight.space and cuts out the loading.

This version replaces the 1 km nudge story (first version, `git log pitch/video-script.md`)
with a tour of the features: the question, famous sites, solar panels, compare, timeline, the
mission simulation and the Horizons check.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:04 | Title card: **DARKSIGHT** · NASA Space Apps 2026 | "Introducing Darksight: a Lunar Landing Site Navigator we developed for NASA Space Apps Challenge 2026." |
| 0:04–0:09 | Problem card with the question as text | "It lets mission planners and curious minds ponder a mission-critical question: does our lunar lander get enough solar power, and still talk to Earth?" |
| 0:09–0:12 | Site list opens and Shackleton is picked; the sky panorama shows the skyline | "Look up famous landing sites, with their real terrain skyline." |
| 0:12–0:14 | Solar panel card: flat against upright panel, battery numbers | "Know your solar panels." |
| 0:14–0:17 | Compare table; best values highlighted | "Compare sites to find the best one." |
| 0:17–0:20 | Timeline scrubbed fast; shadows sweep in 3D | "Scrub the timeline to find your perfect landing time." |
| 0:20–0:25 | "Land here" pressed on a scenario card. The mission card animates the flight from launch pad to touchdown, with the phases and Δv on screen | "Then simulate the launch, all the way to touchdown." |
| 0:25–0:28 | Zoom on the Horizons badge | "Every angle is checked against NASA JPL Horizons." |
| 0:28–0:30 | End card: **DARKSIGHT** · darksight.space | "Sunlight and Earth contact, in a single website. Darksight." |

## Fitting it into 30 seconds

As written the voiceover is about 95 words; 30 seconds of calm speech holds about 75. Cut in
this order until it fits:

1. Title: "Introducing Darksight, built for NASA Space Apps 2026." The challenge name is on the card.
2. Problem: drop "and curious minds".
3. End card: just "Darksight." The address is on screen.

With all three it is about 77 words, and the problem question stays word for word.

## Notes

- The mission simulation is a planning model (patched conics, a simulated powered descent), not
  a flight-dynamics solution. Say "simulate", never "the real flight path".
- Captions follow the voiceover lines, so the video works with the sound off.
