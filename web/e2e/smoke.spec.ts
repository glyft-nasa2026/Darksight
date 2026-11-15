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
  'mission',
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
  await expect(page.locator('#mission')).not.toBeEmpty({ timeout: 30_000 });

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
