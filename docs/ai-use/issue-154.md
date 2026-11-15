# AI use: issue #154, lighter shadow on the 2D map

| When | Who | Tool | What the AI did | What a person checked |
|---|---|---|---|---|
| 2026-11-15 | MarsRon | Claude Code (Opus 5.5) | In `web/src/map/index.ts`, replaced the three hard-coded 0.3 shadow brightnesses (polar cap, whole-Moon map, plain grid before `globe.bin` arrives) with one constant, `SHADOW_LIGHT = 0.5`. The polar cap's lit brightness now scales from that floor to 1, so lit ground keeps its full range. Took before and after screenshots in headless Chromium on the real data: the south polar map at Shackleton rim and the whole-Moon map at 0 N 0 E, 2026-11-14 10:00 UTC. Checks: `npm test` 573 of 573, `npm run build` passes, `npm run test:page` 8 of 8 (including canvas label contrast on both maps). | Pending: MarsRon to check the shade in the browser |
