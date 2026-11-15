// T17: prints pitch/slides.html to pitch/darksight-slides.pdf (7 pages, 1280 x 720) and one PNG
// per slide in pitch/slides-png/ for checking.
//
//   node pitch/tools/build-slides.mjs      (from the repo root, after `npm ci` in web/)

import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const require = createRequire(join(repo, 'web/package.json'));
const { chromium } = require('@playwright/test');

const MAX_SLIDES = 7; // the Space Apps limit, title and intro slides included
const src = pathToFileURL(join(repo, 'pitch/slides.html')).href;
const pngDir = join(repo, 'pitch/slides-png');
rmSync(pngDir, { recursive: true, force: true });
mkdirSync(pngDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.emulateMedia({ media: 'print' });
await page.goto(src, { waitUntil: 'networkidle' });

const slides = page.locator('.slide');
const n = await slides.count();
if (n > MAX_SLIDES) throw new Error(`${n} slides; the limit is ${MAX_SLIDES}`);

// Nothing may spill out of a slide or into its footer line.
const spill = await page.evaluate(() => [...document.querySelectorAll('.slide')].flatMap((s, i) => {
  const box = s.getBoundingClientRect();
  // The footer line keeps the bottom 56 px; everything else stays above it.
  return [...s.querySelectorAll('*')].filter((e) => {
    const r = e.getBoundingClientRect();
    const floor = e.closest('.foot') ? box.bottom : box.bottom - 56;
    return r.width > 0 && (r.right > box.right + 1 || r.bottom > floor + 1 || r.left < box.left - 1);
  }).map((e) => `slide ${i + 1}: <${e.tagName.toLowerCase()} class="${e.className}">`);
}));
if (spill.length) throw new Error(`Content outside its slide:\n${spill.join('\n')}`);

for (let i = 0; i < n; i++) {
  await slides.nth(i).screenshot({ path: join(pngDir, `slide-${i + 1}.png`) });
}
await page.pdf({ path: join(repo, 'pitch/darksight-slides.pdf'), width: '1280px', height: '720px',
  printBackground: true, pageRanges: `1-${n}` });
await browser.close();
console.log(`${n} slides -> pitch/darksight-slides.pdf, PNGs in pitch/slides-png/`);
