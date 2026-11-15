// T26 (c): the README's screenshots, one per major feature, from the deployed site.
//
//   node docs/screenshots/take-screenshots.mjs [site-url]   (from the repo root, after `npm ci` in web/)
//
// Uses web/'s @playwright/test and its bundled Chromium. Writes the PNGs next to this file.
// Same fixed hour as the slides and the demo video (15 Nov 2026 03:00 UTC), so every picture
// shows the same numbers: live on the Shackleton rim, scenario A on the crater floor beside it.

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const require = createRequire(join(repo, 'web/package.json'));
const { chromium } = require('@playwright/test');

const SITE = (process.argv[2] ?? 'https://darksight.space/').replace(/\/?$/, '/');
const T = '2026-11-15T03:00:00Z';
const HASH = `#live=-89.6866,-162.81,${T}&a=-89.67,129.78,${T}`;
const LAND = `${HASH}&land=-89.6866,-162.81,${T}`;
const DESK = { width: 1440, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (target, name) => target.screenshot({ path: join(here, `${name}.png`) });

async function openSite(browser, viewport, opts = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ...opts });
  await page.goto(SITE + HASH, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('intro-open')
    && /Lit %/.test(document.querySelector('#compare')?.textContent ?? '')
    && /\d/.test(document.querySelector('#about')?.textContent ?? ''), null, { timeout: 120_000 });
  await sleep(4000); // map tiles, strips and charts settle
  return page;
}

const label = (page, name) => page.locator(`[aria-label="${name}"]`).first();

const browser = await chromium.launch();

const page = await openSite(browser, DESK);

// The first screen after "Start exploring": map, scenarios, readout.
await shot(page, 'overview');

// One panel each.
for (const id of ['compare', 'readout', 'panel', 'timeline', 'sky', 'scenarios']) {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await sleep(600);
  await shot(page.locator(`#${id}`), id);
}

// The map card from its title row to the bottom of the map, at the top of the page (the About
// bar is sticky, so an element screenshot would have it over the map's top edge).
async function sceneShot(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const clip = await page.evaluate(() => {
    const s = document.getElementById('scene').getBoundingClientRect();
    const v = [...document.querySelectorAll('#scene canvas')].map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    const bottom = Math.max(...v.map((r) => r.bottom));
    return { x: s.x, y: s.y, width: s.width, height: bottom - s.y };
  });
  await page.screenshot({ path: join(here, `${name}.png`), clip });
}
const foldNudge = (open) => page.evaluate((o) => {
  const f = document.querySelector('#nudge .nudge-fold');
  if (f && (f.getAttribute('aria-expanded') === 'true') !== o) f.click();
}, open);

// Nudge: 1 km north of the Shackleton rim.
await foldNudge(true);
await sleep(500);
await label(page, 'Move the live site 1.0 km north').click();
await page.waitForFunction(() => /days of sunlight in 30 days/.test(document.getElementById('nudge')?.innerText ?? ''),
  null, { timeout: 30_000 }).catch(() => {});
await sleep(2500);
await sceneShot('nudge');
await page.getByRole('button', { name: 'Undo' }).click();
await foldNudge(false);
await sleep(1500);

// Map layers: the permanent-shadow layer at the south pole, then the sunlight layer over the whole Moon.
await label(page, 'Never lit (permanent shadow)').click();
await sleep(4000);
await sceneShot('layer-never-lit');
await label(page, 'Never lit (permanent shadow)').click();
await label(page, 'Sunlight (share of time lit)').click();
const map = page.locator('#scene .map-canvas').first();
const box = await map.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 400); await sleep(120); }
await sleep(5000);
await sceneShot('layer-sunlight');
await label(page, 'Sunlight (share of time lit)').click();

// The 3D orbit view: real terrain lit by the Sun at the chosen time.
await page.getByRole('button', { name: '3D orbit' }).click();
await sleep(9000);
await sceneShot('scene-3d');

// Date search: the first date with Sun and Earth for 48 h, from the live time. Last on this page,
// because it moves the live time.
await page.getByRole('button', { name: 'Find a date' }).click();
await sleep(5000);
await shot(page.locator('#sidecard'), 'date-search');

// Timeline playback, in the side card's second tab.
await page.locator('#sidetabs').getByRole('tab', { name: 'Timeline' }).click();
await sleep(1500);
await shot(page.locator('#sidecard'), 'playback');

// The About panel.
await page.locator('#about').getByRole('button', { name: 'About' }).click();
await sleep(1500);
await shot(page, 'about');
await page.close();

// Mission planner, launch simulation and report: their own pages.
const other = await browser.newPage({ viewport: DESK, deviceScaleFactor: 1 });
await other.goto(`${SITE}mission.html${LAND}`, { waitUntil: 'domcontentloaded' });
await sleep(12000);
await shot(other, 'mission');
await other.goto(`${SITE}simulation.html${LAND}`, { waitUntil: 'domcontentloaded' });
await sleep(10000);
await shot(other, 'simulation');
await other.goto(`${SITE}report.html${LAND}`, { waitUntil: 'domcontentloaded' });
await sleep(10000);
await shot(other, 'report');
await other.close();

await browser.close();
console.log(`Screenshots in ${here}`);
