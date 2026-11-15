# Sources: load audit (loading speed and main-thread freezes)

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Playwright 1.65.1 (the repo's dev dependency), headless Chromium | Opening the built site, clicking through it, screenshots | https://playwright.dev | Apache-2.0 |
| Chrome DevTools Protocol: `Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`, `Profiler` | The phone profile (Fast 4G, CPU 4 times slower) and the CPU profile | https://chromedevtools.github.io/devtools-protocol/ | Documentation, BSD-style |
| W3C Long Tasks API, Long Animation Frames API, Resource Timing | Finding freezes of 50 ms and more, and when each file starts and ends | https://w3c.github.io/longtasks/ , https://w3c.github.io/long-animation-frames/ , https://www.w3.org/TR/resource-timing/ | W3C documents |
| HTML Standard: message channels, and the 4 ms clamp on nested timers | Why `slices.ts` schedules its next slice with a `MessageChannel` message, not `setTimeout(fn, 0)` | https://html.spec.whatwg.org/multipage/web-messaging.html#message-channels , https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers | WHATWG, CC BY 4.0 |
| ImageMagick 6.9.12 `compare -metric AE` | Counting pixels that differ between a build of `main` and of the branch | https://imagemagick.org/script/compare.php | ImageMagick licence |
| `web/src/map/index.ts`, `web/src/scene/globeHeights.ts`, `web/src/core/shade.ts`, `web/src/loadOrder.ts`, issues #96, #112, #118 | What the map does when the whole-Moon grid lands | In the repo | Project material |
