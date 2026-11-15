// The built site downloads the packed height grids (dem.pack, globe.pack, north.pack: contract
// section 2), never the .bin files they are made from. The loaders fall back to a .bin file when
// a packed copy is missing or broken, so every other test would still pass if the packing broke;
// this one fails instead.

import { expect, test } from '@playwright/test';

// A site north of 85 S: its skyline needs globe.pack, and the readout says when it is in.
const HASH = 'live=0,0,2026-11-15T05:00:00Z';

test('the built site loads the packed height grids, not the .bin files', async ({ page }) => {
  const data: string[] = [];
  const warnings: string[] = [];
  page.on('request', (req) => {
    const name = /\/data\/([^/?#]+)$/.exec(req.url())?.[1];
    if (name) data.push(name);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text());
  });

  const northPack = page.waitForResponse((res) => res.url().endsWith('/data/north.pack'), { timeout: 90_000 });
  await page.goto(`./#${HASH}`);
  await page.getByRole('button', { name: /Start exploring/ }).click();
  await expect(page.locator('#status')).not.toContainText('Loading', { timeout: 60_000 });
  // "Smooth Moon until the whole-Moon height map loads" until globe.pack is unpacked and in use.
  await expect(page.locator('#readout')).toContainText('Coarse terrain: LOLA whole-Moon height map', { timeout: 60_000 });
  // north.pack (0.3 MB) comes after globe.pack. It unpacks in a few ms; a second is plenty to see
  // a fallback to north.bin, and a slower machine could only miss one, never fail a good build.
  await northPack;
  await page.waitForTimeout(1000);

  for (const name of ['dem', 'globe', 'north']) {
    expect(data, `${name}.pack downloaded`).toContain(`${name}.pack`);
    expect(data, `${name}.bin not downloaded`).not.toContain(`${name}.bin`);
  }
  expect(warnings.filter((w) => /\.pack not loaded/.test(w)), 'a packed copy failed').toEqual([]);
});
