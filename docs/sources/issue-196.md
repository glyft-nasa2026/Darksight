# Sources: issue #196, the mission playback's speed buttons

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Issue #105 (this repo) | What the speed buttons and Auto were meant to do: "Keep the manual buttons (1 min/s, 1 h/s, 6 h/s). Choosing one turns Auto off", and its "manual speeds still work" | https://github.com/glyft-nasa2026/Darksight/issues/105 | This repo, MIT |
| `web/src/ui/mission/pace.ts`, `pace.test.ts` and the test plan in it (this repo) | The playback speed rules and the mission the probe and the tests play | `web/src/ui/mission/pace.ts` | This repo, MIT |
| Playwright for Node (existing dev dependency) | Measuring the playback speed on both pages before and after, from the "T+" clock | https://playwright.dev/ | Apache 2.0 |
| Vitest (existing dev dependency) | The tests, and a probe of the whole mission that wasn't committed | https://vitest.dev/ | MIT |

No new data, papers or libraries.
