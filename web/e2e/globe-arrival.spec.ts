// T37: globe.bin (the coarse terrain for sites north of 85 S) arrives after the height map, with
// no other change of state. Every card that names the terrain or shows a number from the skyline
// must follow it. The Compare card, the timeline and the report page once kept the smooth-Moon
// answer and its label until the next click; the readout and the sky panorama did not.
// globe.bin is held and then let through, so the order is the same on every machine. The built
// site downloads it as globe.pack (contract section 2), the dev server as globe.bin: both are held.

import { expect, test, type Page, type Route } from '@playwright/test';

const SMOOTH = 'Smooth Moon until the whole-Moon height map loads';
const COARSE = 'Coarse terrain: LOLA whole-Moon height map, 3.8 km cells';
// Apollo 15: Hadley Delta stands 11 degrees above the site, so the coarse skyline changes the numbers.
const SITE = '26.13239,3.6333,2026-11-20T00:00:00Z';

/** Holds globe.bin or globe.pack (asked for with or without ?v=<hash>) until release() is called. */
async function holdGlobe(page: Page): Promise<{ held: Route[]; release: () => Promise<void> }> {
  const held: Route[] = [];
  let holding = true;
  await page.route('**/data/globe.{bin,pack}*', (route) => {
    if (holding) held.push(route);
    else void route.continue();
  });
  return {
    held,
    release: async () => {
      holding = false;
      for (const route of held.splice(0)) await route.continue();
    },
  };
}

test('Compare and the timeline follow the coarse terrain when globe.bin arrives', async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (err) => thrown.push(err.message));
  const globe = await holdGlobe(page);
  await page.goto(`./#live=${SITE}`);
  await page.getByRole('button', { name: /Start exploring/ }).click();

  const tag = page.locator('#compare .cmp-ground');
  await expect(tag).toHaveText(SMOOTH, { timeout: 60_000 });
  await expect(page.locator('#readout')).toContainText(SMOOTH);
  const litCell = page.locator('#compare table.cmp-table tbody tr', { hasText: 'Lit % (next 30 days)' }).locator('td').first();
  await expect(litCell).toContainText('%');
  const litBefore = await litCell.textContent();
  // The first value of every line on the timeline, once Plotly has drawn it.
  const firstValues = (): Promise<number[] | null> => page.evaluate(() => {
    const plot = document.querySelector('#timeline .js-plotly-plot') as (Element & { data?: { y?: unknown[] }[] }) | null;
    if (!plot?.data) return null;
    return plot.data.map((t) => t.y?.[0]).filter((v): v is number => typeof v === 'number');
  });
  await expect.poll(async () => (await firstValues())?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const lineBefore = await firstValues();

  await expect.poll(() => globe.held.length, { message: 'globe.bin held back' }).toBeGreaterThan(0);
  await globe.release();

  // Nothing else changes: each card must redraw from the arrival alone.
  await expect(page.locator('#readout')).toContainText(COARSE, { timeout: 30_000 });
  await expect(tag).toHaveText(COARSE);
  await expect(litCell).not.toHaveText(litBefore ?? '');
  await expect.poll(firstValues, { message: 'the timeline\'s lines' }).not.toEqual(lineBefore);
  expect(thrown, 'uncaught exceptions').toEqual([]);
});

test('the report page names the coarse terrain once globe.bin arrives', async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (err) => thrown.push(err.message));
  const globe = await holdGlobe(page);
  await page.goto(`./report.html#live=${SITE}&land=${SITE}`);

  await expect(page.getByText(SMOOTH).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => globe.held.length, { message: 'globe.bin held back' }).toBeGreaterThan(0);
  await globe.release();

  await expect(page.getByText(COARSE).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(SMOOTH)).toHaveCount(0);
  expect(thrown, 'uncaught exceptions').toEqual([]);
});
