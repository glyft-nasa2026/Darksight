// T17: records the 30-second demo video from the deployed site (second version: the feature tour
// in pitch/video-script.md).
//
//   node pitch/tools/record-demo.mjs [site-url]      (from the repo root, after `npm ci` in web/)
//
// Uses web/'s @playwright/test and its bundled Chromium. Writes pitch/demo/darksight-demo.webm
// (1280 x 720, silent, English captions burned in) and a still every 3 s in pitch/demo/frames/.
// The one number in a caption (the Horizons difference) is read from the page while it records
// (CLAUDE.md: numbers come from core/, through the page, never typed in here).
//
// Two recordings: the site itself, and the launch simulation page in a second browser context.
// The script notes when each scene starts and ends, and ffmpeg cuts the scenes out and joins them,
// so loading never counts against the 30-second limit. ffmpeg: $FFMPEG, else `ffmpeg` on the
// PATH, else Playwright's own build (VP8 only).

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
// A fixed hour, so the pictures don't change with the day it is recorded. Live starts on the
// connecting ridge; the "famous sites" scene picks Shackleton rim from the list. A: the floor.
const T = '2026-11-15T03:00:00Z';
const HASH = `#live=-89.4398,-137.17,${T}&a=-89.67,129.78,${T}`;
const SIM_HASH = `#live=-89.6866,-162.81,${T}&a=-89.67,129.78,${T}&land=-89.6866,-162.81,${T}`;
const W = 1280;
const H = 720;
const LIMIT_S = 30;
const out = join(repo, 'pitch/demo');
const raw = join(out, 'raw');
const frames = join(out, 'frames');

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch { /* not on PATH */ }
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
mkdirSync(join(raw, 'site'), { recursive: true });
mkdirSync(join(raw, 'sim'), { recursive: true });
mkdirSync(frames, { recursive: true });

// The overlay: captions, cards and the highlight ring. Theme variables only. No AI-use label: the
// video is a screen recording, not AI-generated footage (the guide's watermark rule), and the
// submission text describes the AI help.
const OVERLAY_CSS = `
  #t17-cap { position: fixed; left: 50%; bottom: var(--space-5); transform: translateX(-50%);
    width: min(92vw, 1100px); z-index: 2147483000; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4) var(--space-5);
    font: 600 calc(var(--fs-lg) * 1.15)/1.3 var(--font); text-align: center; opacity: 0; transition: opacity .25s; }
  #t17-cap.on { opacity: .97; }
  #t17-cap.high { bottom: auto; top: calc(var(--space-5) * 13); }
  #t17-cap.low { bottom: auto; top: calc(var(--space-5) * 15.6); }
  #t17-cap b { color: var(--accent); font-weight: 700; }
  #t17-card { position: fixed; inset: 0; z-index: 2147483001; background: var(--bg); color: var(--text);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-4);
    font-family: var(--font); text-align: center; transition: opacity .4s; }
  #t17-card.off { opacity: 0; pointer-events: none; }
  #t17-card h1 { margin: 0; font-size: calc(var(--fs-xl) * 2.2); letter-spacing: .12em; }
  #t17-card p { margin: 0; font-size: calc(var(--fs-lg) * 1.1); color: var(--muted); max-width: 900px; }
  #t17-card p.lead { color: var(--text); font-size: calc(var(--fs-lg) * 1.4); line-height: 1.3; }
  #t17-card .kicker { font: calc(var(--fs-md) * 1.2) var(--font-num); color: var(--accent);
    letter-spacing: .14em; text-transform: uppercase; }
  .t17-ring { outline: 4px solid var(--accent) !important; outline-offset: 4px; border-radius: var(--radius); }
`;

/** Adds the overlay to a page and returns the helpers that drive it. */
async function overlay(page) {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    const cap = document.createElement('div'); cap.id = 't17-cap'; document.body.append(cap);
    const card = document.createElement('div'); card.id = 't17-card'; card.className = 'off'; document.body.append(card);
  });
  return {
    caption: (html, where = '') => page.evaluate(([h, w]) => {
      const c = document.getElementById('t17-cap');
      c.classList.toggle('high', w === 'high');
      c.classList.toggle('low', w === 'low');
      if (!h) { c.classList.remove('on'); return; }
      c.innerHTML = h; c.classList.add('on');
    }, [html, where]),
    card: (html) => page.evaluate((h) => {
      const c = document.getElementById('t17-card');
      if (!h) { c.classList.add('off'); return; }
      c.innerHTML = h; c.classList.remove('off');
    }, html),
    ring: (selector) => page.evaluate((s) => {
      document.querySelectorAll('.t17-ring').forEach((e) => e.classList.remove('t17-ring'));
      if (s) document.querySelector(s)?.classList.add('t17-ring');
    }, selector),
    scrollTo: (selector, offset) => page.evaluate(([s, o]) => {
      const top = document.querySelector(s).getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - o, behavior: 'instant' });
    }, [selector, offset]),
  };
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// ================= Recording 1: the site =================
const siteCtx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 1,
  recordVideo: { dir: join(raw, 'site'), size: { width: W, height: H } },
});
const page = await siteCtx.newPage();
const siteT0 = Date.now();
await page.goto(SITE + HASH, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Start exploring' }).click();
await page.waitForFunction(() => !document.body.classList.contains('intro-open')
  && /Lit %/.test(document.querySelector('#compare')?.textContent ?? '')
  && /\d/.test(document.querySelector('#about')?.textContent ?? ''), null, { timeout: 120_000 });
await sleep(2500); // the map tiles and the strips settle

const badge = await page.evaluate(() => document.querySelector('#about .about-badge')?.textContent.trim() ?? '');
const horizonsDiff = badge.match(/[\d.]+\s*°/)?.[0];
if (!horizonsDiff) throw new Error(`No number in the Horizons badge: ${badge}`);

const s = await overlay(page);
await page.evaluate(() => window.scrollTo(0, 0));
await s.card(`<div class="kicker">Introducing</div>
  <h1>DARKSIGHT</h1>
  <p class="lead">A Lunar Landing Site Navigator, built for NASA Space Apps Challenge 2026</p>
  <p>Team GLYFT</p>`);
await sleep(500);

const cuts = []; // [source, startMs, endMs] in order
// Each scene ends at a fixed time after `mark`, so a slow step (the site recomputing after a pick,
// the chart redrawing during the drag) shortens the wait after it instead of the next scene.
let mark = Date.now();
const until = async (s) => { const ms = mark + s * 1000 - Date.now(); if (ms > 0) await sleep(ms); };

// 0 to 3.3 s: title card.
await until(3.3);

// 3.3 to 8.3 s: the question (the team's own words).
await s.card(`<div class="kicker">For mission planners and curious minds</div>
  <p class="lead">Does our lunar lander get enough solar power,<br>and still talk to Earth?</p>`);
await until(8.3);

// 8.3 to 11.3 s: famous sites, then the skyline in the sky panorama.
await s.card('');
await s.ring('#scenarios select');
await s.caption('Look up <b>famous landing sites</b>, with their real terrain skyline.');
await until(8.8);
const picked = await page.locator('#scenarios select').first().selectOption('shackleton-rim');
if (!picked.includes('shackleton-rim')) throw new Error('Could not pick Shackleton rim');
await until(9.9);
await s.ring(null);
await s.scrollTo('#sky', 80);
await s.caption('Look up <b>famous landing sites</b>, with their real terrain skyline.', 'high');
await until(11.3);

// 11.3 to 13.3 s: the solar panel card.
await s.scrollTo('#panel', 90);
await s.ring('#panel');
await s.caption('Know your <b>solar panels</b>.');
await until(13.3);

// 13.3 to 16.3 s: the compare table.
await s.ring(null);
await s.scrollTo('#compare', 80);
await s.ring('#compare');
await s.caption('<b>Compare sites</b> to find the best one.');
await until(16.3);

// 16.3 to 19.3 s: drag across the timeline.
await s.ring(null);
await s.scrollTo('#timeline', 80);
await s.caption('Scrub the <b>timeline</b> to find your perfect landing time.', 'high');
await until(16.8);
const chart = await page.locator('#timeline [aria-label^="Timeline chart"]').boundingBox();
if (!chart) throw new Error('No timeline chart');
const y = chart.y + chart.height * 0.4;
const x0 = chart.x + chart.width * 0.1;
const x1 = chart.x + chart.width * 0.85;
await page.mouse.move(x0, y);
await page.mouse.down();
const dragA = Date.now();
for (;;) { // by the clock: the drag reaches the right edge at 18.9 s however slow the chart is
  const f = Math.min(1, (Date.now() - dragA) / 1900);
  await page.mouse.move(x0 + (x1 - x0) * f, y);
  if (f >= 1) break;
  await sleep(40);
}
await page.mouse.up();
await until(19.3);
cuts.push(['site', mark, Date.now()]);

// ================= Recording 2: the launch simulation =================
const simCtx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 1,
  recordVideo: { dir: join(raw, 'sim'), size: { width: W, height: H } },
});
const sim = await simCtx.newPage();
const simT0 = Date.now();
await sim.goto(new URL('simulation.html', SITE).href + SIM_HASH, { waitUntil: 'domcontentloaded' });
await sim.waitForFunction(() => /Touchdown/.test(document.body.innerText)
  && document.querySelector('input.sim-scrub'), null, { timeout: 120_000 });
await sim.getByRole('button', { name: /Pause/ }).click().catch(() => {});
const scrubTo = (v) => sim.evaluate((x) => {
  const r = document.querySelector('input.sim-scrub');
  r.value = String(x); r.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
await scrubTo(0);
await sleep(2500); // the globe and its textures settle
const m = await overlay(sim);
await m.caption('Then <b>simulate the launch</b>, all the way to touchdown.', 'low');
await sleep(300);

// 19.3 to 24.3 s: launch, transfer, lunar orbit, descent. Slider 0..1000 over the whole mission,
// moved by the clock.
mark = Date.now();
const path = [[0, 0], [1300, 8], [2600, 700], [3900, 985], [5000, 1000]]; // [ms, slider]
for (;;) {
  const t = Math.min(5000, Date.now() - mark);
  const k = Math.max(1, path.findIndex(([ms]) => ms >= t));
  const [ta, va] = path[k - 1];
  const [tb, vb] = path[k];
  const f = (t - ta) / (tb - ta);
  await scrubTo(Math.round(va + (vb - va) * f * f * (3 - 2 * f)));
  if (t >= 5000) break;
  await sleep(40);
}
cuts.push(['sim', mark, Date.now()]);
const simVideo = sim.video();
await simCtx.close();

// ================= Back to the site: the Horizons check and the end card =================
await page.evaluate(() => window.scrollTo(0, 0));
await s.caption('');
await sleep(800);
mark = Date.now();
// 24.3 to 27.3 s: the badge.
await s.ring('#about .about-badge');
await s.caption(`Every angle is checked against <b>NASA JPL Horizons</b>: largest difference ${horizonsDiff}.`);
await until(3);

// 27.3 to 29.8 s: end card.
await s.ring(null);
await s.caption('');
await s.card(`<h1>DARKSIGHT</h1>
  <p class="lead">Sunlight and Earth contact, in a single website.</p>
  <p><b style="color:var(--accent)">darksight.space</b></p>`);
await until(5.4);
cuts.push(['site', mark, Date.now()]);

const siteVideo = page.video();
await siteCtx.close();
await browser.close();
const paths = { site: await siteVideo.path(), sim: await simVideo.path() };
const t0s = { site: siteT0, sim: simT0 };

// Cut each scene out of its recording and join them, never longer than the limit.
const total = cuts.reduce((a, [, a0, a1]) => a + (a1 - a0) / 1000, 0);
const scale = Math.min(1, (LIMIT_S - 0.2) / total); // a slow run plays a little faster, nothing cut
const args = ['-y', '-loglevel', 'error'];
cuts.forEach(([src, a0, a1]) => {
  args.push('-ss', ((a0 - t0s[src]) / 1000).toFixed(2), '-t', ((a1 - a0) / 1000).toFixed(2), '-i', paths[src]);
});
const filter = cuts.map((_, i) => `[${i}:v]setpts=(PTS-STARTPTS)*${scale.toFixed(4)},fps=25[v${i}]`).join(';')
  + ';' + cuts.map((_, i) => `[v${i}]`).join('') + `concat=n=${cuts.length}:v=1:a=0[out]`;
const ffmpeg = ffmpegPath();
const vp9 = /libvpx-vp9/.test(execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }));
const codec = vp9 ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1']
  : ['-c:v', 'libvpx', '-b:v', '2M', '-crf', '10'];
const final = join(out, 'darksight-demo.webm');
execFileSync(ffmpeg, [...args, '-filter_complex', filter, '-map', '[out]', '-an', ...codec, final]);
// One still every 3 s, from the finished video.
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', final, '-vf', 'fps=1/3', join(frames, 'still-%02d.png')]);
rmSync(raw, { recursive: true, force: true });
console.log(JSON.stringify({
  final, codec: vp9 ? 'VP9' : 'VP8', scenesS: cuts.map(([src, a0, a1]) => [src, +((a1 - a0) / 1000).toFixed(2)]),
  totalS: +(total * scale).toFixed(2), horizonsDiff,
}, null, 2));
