// T17: records the 30-second demo video from the deployed site.
//
//   node pitch/tools/record-demo.mjs [site-url]      (from the repo root, after `npm ci` in web/)
//
// Uses web/'s @playwright/test and its bundled Chromium and ffmpeg. Writes
// pitch/demo/darksight-demo.webm (1280 x 720, VP9, silent, English captions burned in) and one
// still per scene in pitch/demo/frames/. Every number in a caption is read from the page while
// it records, so the captions always say what the site shows (CLAUDE.md: numbers come from
// core/, through the page, never typed in here).
//
// The page loads first (intro, data) with the camera running; the script notes when the demo
// itself starts and cuts the video from there with ffmpeg, so the loading never counts against
// the 30-second limit.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const require = createRequire(join(repo, 'web/package.json'));
const { chromium } = require('@playwright/test');

const SITE = process.argv[2] ?? 'https://darksight.space/';
// A fixed hour, so the numbers in the video don't change with the day it is recorded.
const HASH = '#live=-89.6866,-162.81,2026-11-15T03:00:00Z&a=-89.67,129.78,2026-11-15T03:00:00Z';
const W = 1280;
const H = 720;
const LIMIT_S = 30;
const out = join(repo, 'pitch/demo');
const raw = join(out, 'raw');
const frames = join(out, 'frames');

/** $FFMPEG if set, else Playwright's own ffmpeg build (installed with its browsers). */
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
      : process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright')
        : join(homedir(), '.cache/ms-playwright'));
  const dir = readdirSync(base).find((d) => d.startsWith('ffmpeg'));
  if (!dir) throw new Error(`No ffmpeg in ${base}; run "npx playwright install ffmpeg" in web/`);
  const exe = readdirSync(join(base, dir)).find((f) => f.startsWith('ffmpeg'));
  return join(base, dir, exe);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(raw, { recursive: true, force: true });
rmSync(frames, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: raw, size: { width: W, height: H } },
});
const page = await context.newPage();
const videoT0 = Date.now();

await page.goto(SITE + HASH, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Start exploring' }).click();
// Ready: the intro layer is gone, the compare table has its rows, the badge has its number.
await page.waitForFunction(() => !document.body.classList.contains('intro-open')
  && /Lit %/.test(document.querySelector('#compare')?.textContent ?? '')
  && /\d/.test(document.querySelector('#about')?.textContent ?? ''), null, { timeout: 120_000 });
await sleep(2500); // the map tiles and the strips settle

// What the captions will say, read from the page.
const facts = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#compare tr')].map((tr) =>
    [...tr.querySelectorAll('th,td')].map((c) => c.textContent.replace('(best)', '').replace(/\s+/g, ' ').trim()));
  const row = (label) => rows.find((r) => r[0] === label) ?? [];
  const badge = document.querySelector('#about .about-badge')?.textContent.trim() ?? '';
  return { lit: row('Lit % (next 30 days)'), earth: row('Earth contact %'), badge };
});
if (facts.lit.length < 3 || !facts.badge) throw new Error(`Page not as expected: ${JSON.stringify(facts)}`);
const horizonsDiff = facts.badge.match(/[\d.]+\s*°/)?.[0];
if (!horizonsDiff) throw new Error(`No number in the Horizons badge: ${facts.badge}`);

// The overlay: captions, title card, highlight ring and the AI-use label. Theme variables only.
await page.addStyleTag({
  content: `
  #t17-cap { position: fixed; left: 50%; bottom: var(--space-5); transform: translateX(-50%);
    width: min(92vw, 1100px); z-index: 2147483000; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4) var(--space-5);
    font: 600 calc(var(--fs-lg) * 1.15)/1.3 var(--font); text-align: center; opacity: 0;
    transition: opacity .25s; box-shadow: 0 0 0 9999px transparent; }
  #t17-cap.on { opacity: .97; }
  #t17-cap b { color: var(--accent); font-weight: 700; }
  #t17-cap .bad { color: var(--bad); } #t17-cap .ok { color: var(--ok); }
  #t17-card { position: fixed; inset: 0; z-index: 2147483001; background: var(--bg); color: var(--text);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-4);
    font-family: var(--font); text-align: center; transition: opacity .4s; }
  #t17-card.off { opacity: 0; pointer-events: none; }
  #t17-card h1 { margin: 0; font-size: calc(var(--fs-xl) * 2.2); letter-spacing: .12em; }
  #t17-card p { margin: 0; font-size: calc(var(--fs-lg) * 1.1); color: var(--muted); max-width: 900px; }
  #t17-card p.lead { color: var(--text); }
  #t17-card .kicker { font: calc(var(--fs-md) * 1.2) var(--font-num); color: var(--accent);
    letter-spacing: .14em; text-transform: uppercase; }
  .t17-ring { outline: 4px solid var(--accent) !important; outline-offset: 4px; border-radius: var(--radius); }
  #t17-ai { position: fixed; right: var(--space-3); top: calc(var(--space-5) * 2.6); z-index: 2147483002;
    font: var(--fs-sm) var(--font-num); color: var(--muted); background: var(--panel);
    border: 1px solid var(--border); border-radius: 999px; padding: var(--space-1) var(--space-3); }
  `,
});
await page.evaluate(() => {
  const cap = document.createElement('div'); cap.id = 't17-cap'; document.body.append(cap);
  const card = document.createElement('div'); card.id = 't17-card'; card.className = 'off'; document.body.append(card);
  const ai = document.createElement('div'); ai.id = 't17-ai';
  ai.textContent = 'AI-assisted build (Claude Code) · screen recording of the real site';
  document.body.append(ai);
});

const caption = (html) => page.evaluate((h) => {
  const c = document.getElementById('t17-cap');
  if (!h) { c.classList.remove('on'); return; }
  c.innerHTML = h; c.classList.add('on');
}, html);
const card = (html) => page.evaluate((h) => {
  const c = document.getElementById('t17-card');
  if (!h) { c.classList.add('off'); return; }
  c.innerHTML = h; c.classList.remove('off');
}, html);
const ring = (selector) => page.evaluate((s) => {
  document.querySelectorAll('.t17-ring').forEach((e) => e.classList.remove('t17-ring'));
  if (s) document.querySelector(s)?.classList.add('t17-ring');
}, selector);
const scrollTo = (selector, block = 'start') => page.evaluate(([s, b]) =>
  document.querySelector(s)?.scrollIntoView({ behavior: 'smooth', block: b }), [selector, block]);

let shot = 0;
const still = (name) => page.screenshot({ path: join(frames, `${String(++shot).padStart(2, '0')}-${name}.png`) });

// ---- The demo. Times are seconds into the final video (about 28 s in all). ----
await page.evaluate(() => window.scrollTo(0, 0));
// The nudge panel to the top-left corner of the map, so its result has room to show.
await page.evaluate(() => document.querySelector('[aria-label="Move panel to the top left corner"]')?.click());
await card(`<div class="kicker">NASA Space Apps 2026 · Lunar Landing Site Navigator · Team GLYFT</div>
  <h1>DARKSIGHT</h1>
  <p class="lead">When does a landing site on the Moon have sunlight and a line to Earth?</p>`);
await sleep(400);
const demoT0 = Date.now();

// 0 to 3 s: title card.
await sleep(1000); await still('title'); await sleep(2000);

// 3 to 7.5 s: the problem.
await card(`<div class="kicker">The problem</div>
  <p class="lead">A launch slips by a day. Does the landing site still get sunlight for power,<br>and a line to Earth for radio?</p>
  <p>Today that answer takes about an hour across three tools.</p>`);
await sleep(1500); await still('problem'); await sleep(3000);

// 7.5 to 13.5 s: our answer, two scenarios side by side.
await card('');
await page.evaluate(() => {
  const top = document.querySelector('#compare').getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: top - document.querySelector('#about').offsetHeight - 8, behavior: 'smooth' });
});
await caption(`Darksight compares sites in seconds. <b>Shackleton rim</b>: ${facts.lit[1]} lit over 30 days.<br>
  The crater floor next to it: <span class="bad">${facts.lit[2]}</span>.`);
await sleep(800);
await ring('#compare');
await sleep(1700); await still('compare'); await sleep(3500);

// 13.5 to 21 s: the 1 km nudge.
await ring(null);
await caption('Now move the pin just <b>1 km north</b>…');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await ring('#nudge');
// The panel starts folded (issue #126): open it on camera.
await page.evaluate(() => {
  const f = document.querySelector('#nudge .nudge-fold');
  if (f?.getAttribute('aria-expanded') === 'false') f.click();
});
await sleep(1200);
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('#nudge button')].find((x) => x.textContent.trim() === '1.0 km N');
  b?.click();
  return !!b;
});
if (!clicked) throw new Error('No "1.0 km N" button');
// The step moves the live site at once; its result shows when the new skyline is traced.
await page.waitForFunction(() => /days of sunlight in 30 days/.test(document.getElementById('nudge')?.innerText ?? ''),
  null, { timeout: 10_000 }).catch(() => {});
const nudge = await page.evaluate(() => {
  const t = document.getElementById('nudge')?.innerText.replace(/\s+/g, ' ') ?? '';
  const sun = t.match(/[−-][\d.]+ days of sunlight in 30 days/)?.[0] ?? '';
  const earth = /no Earth now in the next 60 days|Earth hidden now|loses Earth/.test(t) ? 'and Earth drops out of sight' : '';
  return { sun, earth, t };
});
if (!nudge.sun) throw new Error(`Nudge result not found: ${nudge.t}`);
await caption(`…and the sunlight collapses: <span class="bad">${nudge.sun.replace('-', '−')}</span>${nudge.earth ? `,<br>${nudge.earth}` : ''}. One kilometre.`);
await sleep(2000); await still('nudge'); await sleep(3900);

// 21 to 24.5 s: the Horizons check. Undo puts the live site back on the rim.
await page.evaluate(() => [...document.querySelectorAll('#nudge button')].find((x) => x.textContent.trim() === 'Undo')?.click());
await ring('#about .about-badge');
await caption(`Real NASA LOLA terrain and JPL ephemeris. Every angle checked against <b>JPL Horizons</b>:<br>largest difference ${horizonsDiff}.`);
await sleep(1300); await still('horizons'); await sleep(2000);

// 24.5 to 28 s: who it's for.
await ring(null);
await caption('');
await card(`<div class="kicker">For mission planners, educators and the curious</div>
  <h1>DARKSIGHT</h1>
  <p class="lead">Free in any browser: <b style="color:var(--accent)">darksight.space</b></p>`);
await sleep(900); await still('end'); await sleep(2100);
const demoT1 = Date.now();

const video = page.video();
await context.close();
await browser.close();
const rawPath = await video.path();

// Cut [demoT0, demoT1] out of the recording; never longer than the limit.
const ss = (demoT0 - videoT0) / 1000;
const dur = Math.min((demoT1 - demoT0) / 1000, LIMIT_S - 0.2);
const final = join(out, 'darksight-demo.webm');
// VP9 where the ffmpeg has it; Playwright's own build has only VP8 (FFMPEG=/usr/bin/ffmpeg for VP9).
const ffmpeg = ffmpegPath();
const vp9 = /libvpx-vp9/.test(execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }));
const codec = vp9 ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1']
  : ['-c:v', 'libvpx', '-b:v', '2M', '-crf', '10'];
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', ss.toFixed(2), '-i', rawPath,
  '-t', dur.toFixed(2), '-an', ...codec, final]);
rmSync(raw, { recursive: true, force: true });
console.log(JSON.stringify({ final, codec: vp9 ? 'VP9' : 'VP8', startS: +ss.toFixed(2), durationS: +dur.toFixed(2), facts, nudge: nudge.sun, earth: nudge.earth }, null, 2));
