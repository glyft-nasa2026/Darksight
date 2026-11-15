# Sources: issue #112, north polar view and fading ring

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Polar stereographic projection, north and south aspects (standard map projection formulas) | `polarForward` and `polarInverse` with a `pole`; which way the north view faces | https://pubs.usgs.gov/pp/1395/report.pdf (Snyder, *Map Projections: A Working Manual*, USGS PP 1395, section 21) | US public domain |
| Canvas 2D `drawImage`, `scale` and `ImageData` | Drawing the north cap upside down, and the fading ring | https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D | CC BY-SA (reference only, no text copied) |
| Playwright (existing) | Screenshots and the click check | https://playwright.dev/ | Apache 2.0 |

No new data. north.bin and globe.bin are issue #66's (`docs/sources/issue-66.md`).
