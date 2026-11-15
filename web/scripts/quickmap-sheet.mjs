// T36 step 5: the QuickMap contact sheet. For every planned site in public/data/sites.json (or
// the ids given), opens LROC QuickMap in headless Chromium, switches to a projection that shows
// the site without foreshortening, types "lat,lon" into QuickMap's search box and picks "Create
// Point at ...", which drops a pin and centres the map on it. Saves two screenshots per site
// (200 and 50 m per pixel) and one HTML page of them all into data-prep/raw/quickmap/
// (git-ignored).
//
//   cd web && node scripts/quickmap-sheet.mjs [site-id ...]
//
// It never guesses. It stops with a message, and writes no sheet, when the search box or the
// "Create Point" choice isn't found, when the projection doesn't switch, when the map doesn't
// move (QuickMap's prjExtent in the address stays the same), or when QuickMap's own LAT/LON
// readout at the map's centre isn't the site. A person then looks at the sheet and confirms each
// pin is on its named feature (features.json); F12 needs a person's check, not a model's.
// QuickMap is a public website, so run this by hand, not in CI.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES = join(HERE, '..', 'public', 'data', 'sites.json');
const FEATURES = join(HERE, '..', 'src', 'core', '__fixtures__', 'features.json');
const OUT = join(HERE, '..', '..', 'data-prep', 'raw', 'quickmap');
const QUICKMAP = 'https://quickmap.lroc.im-ldi.com/';   // quickmap.lroc.asu.edu redirects here
const SEARCH = 'Type a lat,lon(,height) or search...';
const R_M = 1_737_400;
const VIEW = { width: 1280, height: 900 };

/**
 * QuickMap's own name for the projection that shows a site best: a polar view near a pole, the
 * far-side view near 180 degrees (QuickMap's cylindrical map ends there, cutting a feature in
 * half), and the cylindrical map elsewhere.
 */
function projectionFor(lat, lon) {
  if (lat <= -75) return 'Stereographic (South Pole)';
  if (lat >= 75) return 'Stereographic (North Pole)';
  if (Math.abs(lon) >= 135) return 'Orthographic (Farside)';
  return 'Equidistant Cylindrical (< 75 deg.)';
}

class Stop extends Error {}

/** Closes QuickMap's "what's new" dialog when it is showing; it can appear a few seconds late. */
async function closeDialog(page, waitMs) {
  const dialog = page.getByRole('dialog');
  try {
    await dialog.waitFor({ state: 'visible', timeout: waitMs });
  } catch {
    return;
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
}

/** QuickMap's LAT, LON and RES readout for the mouse at the centre of the map canvas. */
async function readoutAtCentre(page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Stop('the map canvas was not found');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 30, cy - 30);
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(/LAT\s*\n\s*(-?[\d.]+)\s*\n\s*LON\s*\n\s*(-?[\d.]+)\s*\n\s*RES\s*\n\s*([\d.]+)\s*m\/px/);
  if (!m) throw new Stop('QuickMap\'s LAT/LON readout did not show a position at the map centre');
  return { lat: Number(m[1]), lon: Number(m[2]), resM: Number(m[3]) };
}

/** Throws unless QuickMap's readout at the centre is the site, to within two pixels. */
function checkReadout(site, r, when) {
  const tolLat = (2 * r.resM / R_M) * (180 / Math.PI);
  const tolLon = tolLat / Math.max(Math.cos(site.lat * Math.PI / 180), 1e-3);
  const dLon = ((r.lon - site.lon + 540) % 360) - 180;
  if (Math.abs(r.lat - site.lat) > tolLat || Math.abs(dLon) > tolLon) {
    throw new Stop(`${site.id}: ${when}, QuickMap reads ${r.lat}, ${r.lon} at the map centre, not the site's ` +
      `${site.lat}, ${site.lon}`);
  }
}

/** Hides the search list and the inspector panel so the screenshot shows the map. */
async function clearView(page) {
  await page.keyboard.press('Escape');
  await page.getByPlaceholder(SEARCH).blur();
  const inspector = page.getByText('Object Inspector', { exact: true });
  if (await inspector.isVisible()) {
    const close = inspector.locator('xpath=..').getByRole('button').first();
    await close.click();
    await inspector.waitFor({ state: 'hidden', timeout: 5000 });
  }
  await page.mouse.move(VIEW.width - 5, VIEW.height / 2);
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

async function shoot(browser, site) {
  const page = await browser.newPage({ viewport: VIEW });
  try {
    await page.goto(QUICKMAP, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const search = page.getByPlaceholder(SEARCH);
    try {
      await search.waitFor({ timeout: 60000 });
    } catch {
      throw new Stop(`QuickMap's search box (placeholder "${SEARCH}") was not found`);
    }
    await closeDialog(page, 15000);

    const projection = projectionFor(site.lat, site.lon);
    const projButton = page.locator('button[aria-label^="Projection:"]');
    if ((await projButton.getAttribute('aria-label')) !== `Projection: ${projection}`) {
      await projButton.click();
      await page.getByText(projection, { exact: true }).click();
      try {
        await page.waitForFunction((want) => document.querySelector('button[aria-label^="Projection:"]')
          ?.getAttribute('aria-label') === want, `Projection: ${projection}`, { timeout: 20000 });
      } catch {
        throw new Stop(`${site.id}: QuickMap did not switch to ${projection}`);
      }
      await settle(page);
    }
    await closeDialog(page, 1000);

    const before = new URL(page.url()).searchParams.get('prjExtent');
    await search.click();
    await page.keyboard.type(`${site.lat},${site.lon}`, { delay: 30 });
    const create = page.locator('[cmdk-item]').filter({ hasText: 'Create Point at' }).first();
    try {
      await create.waitFor({ timeout: 15000 });
    } catch {
      throw new Stop(`${site.id}: QuickMap offered no "Create Point at" for "${site.lat},${site.lon}"`);
    }
    const offered = (await create.innerText()).match(/(-?[\d.]+)° LAT, (-?[\d.]+)° LON/);
    if (!offered || Number(offered[1]) !== site.lat || Number(offered[2]) !== site.lon) {
      throw new Stop(`${site.id}: QuickMap read the search as "${await create.innerText()}"`);
    }
    await create.click();
    try {
      await page.waitForFunction((b) => new URL(location.href).searchParams.get('prjExtent') !== b, before,
        { timeout: 30000 });
    } catch {
      throw new Stop(`${site.id}: the map did not move (prjExtent stayed ${before})`);
    }
    await settle(page);

    const wide = await readoutAtCentre(page);
    checkReadout(site, wide, 'after "Create Point"');
    const link = page.url();
    await clearView(page);
    await settle(page);
    await page.screenshot({ path: join(OUT, `${site.id}-wide.png`) });

    const zoomIn = page.getByRole('button', { name: /zoom in/i }).or(page.locator('button', { hasText: /^\+$/ })).first();
    for (let i = 0; i < 2; i++) {
      await zoomIn.click();
      await page.waitForTimeout(800);
    }
    await settle(page);
    const close = await readoutAtCentre(page);
    checkReadout(site, close, 'after zooming in');
    if (!(close.resM < wide.resM)) throw new Stop(`${site.id}: zooming in left the map at ${close.resM} m/px`);
    await page.mouse.move(VIEW.width - 5, VIEW.height / 2);
    await settle(page);
    await page.screenshot({ path: join(OUT, `${site.id}-close.png`) });
    return { site, projection, link, wide, close };
  } finally {
    await page.close();
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sheet(rows, features, made) {
  const cards = rows.map(({ site, projection, link, wide, close }) => {
    const f = features.sites[site.id];
    const feature = !f ? 'not in features.json'
      : f.feature === null ? `no named feature (${esc(f.reason)})`
        : `${esc(f.feature)} (gazetteer <a href="${esc(f.page)}">${f.gazetteer_id}</a>, ${esc(f.type)}, `
          + `${f.diameter_km.toFixed(1)} km across, centre ${f.lat}, ${f.lon})`
          + (f.margin_km ? `; margin ${f.margin_km} km: ${esc(f.margin_reason)}` : '');
    return `<section>
  <h2>${esc(site.name)} <code>${esc(site.id)}</code></h2>
  <p>Pin at <b>${site.lat}, ${site.lon}</b> (${esc(site.agency)}, ${site.year}). ${esc(site.note)}<br>
  Should be on: <b>${feature}</b><br>
  Source: <a href="${esc(site.source)}">${esc(site.source)}</a><br>
  QuickMap, ${esc(projection)}: <a href="${esc(link)}">open this view</a> (the view only: QuickMap keeps a
  created point in the browser that made it, so type ${site.lat},${site.lon} into its search box and pick
  "Create Point at" to see the pin there).
  QuickMap's readout at the pin: ${wide.lat}, ${wide.lon} (${wide.resM} m/px) and ${close.lat}, ${close.lon} (${close.resM} m/px).</p>
  <figure><img src="${esc(site.id)}-wide.png" alt="${esc(site.name)} at ${wide.resM} m per pixel"><figcaption>${wide.resM} m per pixel, the pin is the blue dot at the centre</figcaption></figure>
  <figure><img src="${esc(site.id)}-close.png" alt="${esc(site.name)} at ${close.resM} m per pixel"><figcaption>${close.resM} m per pixel</figcaption></figure>
</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>T36 QuickMap contact sheet</title>
<style>
body { font-family: system-ui, sans-serif; margin: 1rem; max-width: 80rem; }
section { border-top: 1px solid #888; padding: 1rem 0; }
figure { display: inline-block; margin: 0 1rem 1rem 0; max-width: 48%; }
img { width: 100%; height: auto; }
@media (max-width: 800px) { figure { max-width: 100%; } }
</style></head><body>
<h1>T36 QuickMap contact sheet</h1>
<p>Made ${esc(made)} by <code>web/scripts/quickmap-sheet.mjs</code> from LROC QuickMap (${esc(QUICKMAP)}),
for the planned sites in <code>web/public/data/sites.json</code>. Gazetteer file of ${esc(features.file_date)}.</p>
<p><b>For the person checking:</b> for each site, confirm the blue pin sits on the feature named under
"Should be on" (open the QuickMap link to pan and zoom). Then write your name, the date and the result
for each site in <code>docs/sources/T36.md</code>. A model looking at these pictures doesn't count (F12).</p>
${cards}
</body></html>
`;
}

async function main() {
  const all = JSON.parse(readFileSync(SITES, 'utf8'));
  const features = JSON.parse(readFileSync(FEATURES, 'utf8'));
  const wanted = process.argv.slice(2);
  const sites = all.filter((s) => (wanted.length ? wanted.includes(s.id) : s.status === 'planned'));
  const unknown = wanted.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) throw new Stop(`not in sites.json: ${unknown.join(', ')}`);
  if (sites.length === 0) throw new Stop('no planned site in sites.json');

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const rows = [];
  try {
    for (const site of sites) {
      console.log(`${site.id}: ${site.lat}, ${site.lon} ...`);
      const row = await shoot(browser, site);
      console.log(`  ok: ${row.projection}; readout ${row.wide.lat}, ${row.wide.lon} at ${row.wide.resM} m/px, `
        + `${row.close.lat}, ${row.close.lon} at ${row.close.resM} m/px`);
      rows.push(row);
    }
  } finally {
    await browser.close();
  }
  const page = join(OUT, 'index.html');
  writeFileSync(page, sheet(rows, features, new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'));
  console.log(`contact sheet: ${page}`);
}

main().catch((err) => {
  console.error(err instanceof Stop ? `STOPPED: ${err.message}` : err);
  process.exit(1);
});
