// T17: screenshots of the deployed site for the slides.
//
//   node pitch/tools/screenshots.mjs [site-url]      (from the repo root, after `npm ci` in web/)
//
// Writes pitch/img/: desktop.png (1280 x 800), phone.png (390 x 844), compare.png, nudge.png
// (after "1.0 km N" from the Shackleton rim) and badge.png. Same fixed hour as the demo video,
// so slides and video show the same numbers.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const require = createRequire(join(repo, 'web/package.json'));
const { chromium } = require('@playwright/test');

const SITE = process.argv[2] ?? 'https://darksight.space/';
const HASH = '#live=-89.6866,-162.81,2026-11-15T03:00:00Z&a=-89.67,129.78,2026-11-15T03:00:00Z';
const out = join(repo, 'pitch/img');
mkdirSync(out, { recursive: true });

async function open(browser, viewport, isMobile = false) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
  await page.goto(SITE + HASH, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('intro-open')
    && /Lit %/.test(document.querySelector('#compare')?.textContent ?? ''), null, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  return page;
}

const browser = await chromium.launch();

const desk = await open(browser, { width: 1280, height: 800 });
await desk.evaluate(() => document.querySelector('[aria-label="Move panel to the top left corner"]')?.click());
await desk.waitForTimeout(500);
await desk.screenshot({ path: join(out, 'desktop.png') });
await desk.locator('#about .about-badge').screenshot({ path: join(out, 'badge.png') });
// The sticky about bar would cover the top of the table in an element screenshot.
await desk.addStyleTag({ content: '#about { visibility: hidden; }' });
await desk.locator('#compare').screenshot({ path: join(out, 'compare.png') });
await desk.addStyleTag({ content: '#about { visibility: visible; }' });
await desk.evaluate(() => window.scrollTo(0, 0));
await desk.evaluate(() => [...document.querySelectorAll('#nudge button')].find((b) => b.textContent.trim() === '1.0 km N')?.click());
await desk.waitForTimeout(1500);
await desk.locator('#scene').screenshot({ path: join(out, 'nudge.png') });
await desk.close();

const phone = await open(browser, { width: 390, height: 844 }, true);
await phone.screenshot({ path: join(out, 'phone.png') });
await phone.close();

await browser.close();
console.log(`Screenshots in ${out}`);
