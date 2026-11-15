// T30: opens the built page once and fails if a module broke while the page loaded.
// The slots are docs/data-contract.md section 5; "failed to start" is what main.ts writes when
// a module throws in mount(el); #status is where main.ts says which data files are missing.

import { expect, test } from '@playwright/test';

const SLOTS = [
  'scene',
  'scenarios',
  'readout',
  'compare',
  'timeline',
  'sky',
  'nudge',
  'about',
  'panel',
] as const;

test('the page loads, every slot is filled and the data arrives', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page threw: ${err.message}`));

  await page.goto('./');
  await page.getByRole('button', { name: /Start exploring/ }).click();

  // The data files have arrived once #status no longer says "Loading" (main.ts clears it).
  const status = page.locator('#status');
  await expect(status, '#status should stop saying "Loading"').not.toContainText('Loading', {
    timeout: 60_000,
  });
  expect(await status.textContent(), '#status after the data loaded').not.toContain('Data not loaded');

  // main.ts mounts the slots behind the loading screen; wait for the last one in site.ts.
  // #mission is not on this page: it has its own, mission.html (T34-f), tested below.
  await expect(page.locator('#sky')).not.toBeEmpty({ timeout: 30_000 });

  for (const id of SLOTS) {
    const slot = page.locator(`#${id}`);
    await expect(slot, `#${id} is missing from the page`).toHaveCount(1);
    const text = (await slot.textContent()) ?? '';
    const children = await slot.evaluate((el) => el.childElementCount);
    expect(text.trim().length + children, `#${id} is empty`).toBeGreaterThan(0);
    expect(text, `#${id} failed to start`).not.toContain('failed to start');
  }

  expect(problems, 'console errors and uncaught exceptions').toEqual([]);
});

// T34-f: the mission card's own page, opened by "Open mission" with the site's address. A landing
// point in the address, so the card plans a mission rather than asking for one.
test('the mission page loads and draws the mission to the landing point', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page threw: ${err.message}`));

  await page.goto('./mission.html#live=-89.6866,-162.81,2026-11-15T05:00:00Z&land=-89.6866,-162.81,2026-11-15T05:00:00Z');
  const status = page.locator('#mp-status');
  await expect(status, '#mp-status should stop saying "Loading"').not.toContainText('Loading', { timeout: 60_000 });
  expect(await status.textContent(), '#mp-status after the data loaded').not.toContain('Data not loaded');

  const mission = page.locator('#mission');
  await expect(mission).toHaveCount(1);
  await expect(mission.locator('h2')).toContainText('Mission simulation ·', { timeout: 30_000 });
  await expect(mission.getByRole('button', { name: /Proceed/ })).toBeVisible();
  expect(await mission.textContent(), '#mission failed to start').not.toContain('failed to start');
  expect(problems, 'console errors and uncaught exceptions').toEqual([]);
});

// T35: the mission report's own page, opened by "Generate full launch schedule" with the mission's
// address. It builds the whole report, and its print and download buttons switch on.
test('the report page builds the report of the mission to the landing point', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page threw: ${err.message}`));

  await page.goto('./report.html#live=-89.6866,-162.81,2026-11-15T05:00:00Z&land=-89.6866,-162.81,2026-11-15T05:00:00Z');
  const report = page.locator('#report');
  await expect(report.locator('h1')).toContainText('Mission report ·', { timeout: 60_000 });
  await expect(report.locator('h2')).toHaveCount(9);
  await expect(report.locator('.rp-schedule tbody tr')).toHaveCount(10);
  for (const id of ['#rpp-print', '#rpp-json', '#rpp-csv']) await expect(page.locator(id)).toBeEnabled();
  expect(await report.textContent(), '#report failed to start').not.toContain('failed to start');
  expect(problems, 'console errors and uncaught exceptions').toEqual([]);
});
