# Sources: issue #178, the landing logo on a wide screen

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Playwright for Node (existing dev dependency) | Before and after screenshots and box measurements; the page test `e2e/landing-wide.spec.ts` | https://playwright.dev/ | Apache 2.0 |
| MDN, CSS `min()`, `max()` and `calc()` | The column's side space and the logo's size cap | https://developer.mozilla.org/en-US/docs/Web/CSS/max | CC BY-SA 2.5 (documentation) |
| MDN, CSS custom properties | `--hero-col`, `--hero-side`, `--hero-logo` on `.intro-first`, used by its children | https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties | CC BY-SA 2.5 (documentation) |

No new data, papers or libraries. The column width (`--space-5` x 64) and the logo cap (`--space-5` x 36) were chosen from the screenshots: the 1440 x 900 layout is the one kept, and 1920 x 1080's logo stays its size.
