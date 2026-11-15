# Sources: loading fixes

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| `docs/load-time.md` (T27) and issue #95's notes | The measurement method (Fast 4G, long tasks) and where the time went before | `docs/load-time.md`, `docs/ai-use/issue-95.md` | Project |
| plotly.js-basic-dist-min 4.3.0 | Plotly's partial build with scatter, bar and pie, the only chart types the site draws | https://www.npmjs.com/package/plotly.js-basic-dist-min | MIT |
| Plotly.js "Partial bundles" | Which trace types each partial build holds | https://github.com/plotly/plotly.js/blob/master/dist/README.md#partial-bundles | MIT |
| plotly.js-dist-min 4.3.0 (dev dependency) | Type definitions for the basic build, which ships none | https://www.npmjs.com/package/plotly.js-dist-min | MIT |
| Vite 8.3.8 plugin API, `transformIndexHtml` | Writing the list of the site's code files into the built `index.html` | https://vite.dev/guide/api-plugin.html#transformindexhtml | MIT (docs) |
| Vite "Async chunk loading optimization" and "Load error handling" | How Vite's loader preloads a chunk's files, and that a deploy can break dynamic imports on an open page | https://vite.dev/guide/features.html#async-chunk-loading-optimization · https://vite.dev/guide/build.html#load-error-handling | MIT (docs) |
| MDN `rel="modulepreload"` | Fetching a module without running it | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload | CC-BY-SA 2.5 (docs) |
| MDN `sessionStorage` | The mark that lets the page reload itself only once | https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage | CC-BY-SA 2.5 (docs) |
| Cloudflare Pages "Single-page application (SPA) rendering" | Why a missing file comes back as the page with status 200 (checked on darksight.space, 15 Nov 2026) | https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering | Cloudflare (docs) |
| Playwright 1.65.1 for Node and the Chrome DevTools Protocol (`Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`, `Profiler`) | Timing the loads, slowing the line and processor, profiling the long tasks | https://playwright.dev/docs/api/class-cdpsession · https://chromedevtools.github.io/devtools-protocol/ | Apache 2.0 · CC BY 4.0 (docs) |
| MDN `PerformanceLongTaskTiming` | Measuring freezes (long tasks) in the page | https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming | CC-BY-SA 2.5 (docs) |
| ImageMagick `compare` | Checking the charts draw the same with the basic build (0 pixels differ) | https://imagemagick.org/script/compare.php | ImageMagick licence |
