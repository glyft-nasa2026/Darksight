// T33 (issue #32, row 4): a decade of the Sun and Earth table that fails to download says so, is
// tried again, and its numbers come back without a reload. The browser check of the task's
// "Done when", run on the built page: the request for ephemeris/2050.bin is made to fail, as
// DevTools request blocking does, with the live time in 2055.

import { expect, test, type Page } from '@playwright/test';

const FAILED = 'The Sun and Earth table for the 2050s did not download. Trying again…';
const STATUS = 'Sun and Earth table for the 2050s (trying again)';
const DECADE = '**/data/ephemeris/2050.bin*';   // the file is asked for with ?v=<hash>
const AT_2055 = '-89.5,0,2055-06-01T00:00:00Z';
const AT_2026 = '-89.5,0,2026-11-15T00:00:00Z';

/** Opens the page at a link, past "Start exploring", once every slot is mounted. */
async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`./#${hash}`);
  await page.getByRole('button', { name: /Start exploring/ }).click();
  await expect(page.locator('#mission')).not.toBeEmpty({ timeout: 60_000 });
}

/** Every place that says why there are no numbers, in the failed decade's words. */
async function expectFailedWords(page: Page): Promise<void> {
  await expect(page.locator('#readout')).toContainText(FAILED, { timeout: 30_000 });
  await expect(page.locator('#panel')).toContainText(FAILED);
  await expect(page.locator('#nudge')).toContainText(FAILED);
  await expect(page.locator('#sky')).toContainText(FAILED);
  await expect(page.locator('#timeline')).toContainText(FAILED);
  await expect(page.locator('#status')).toContainText(STATUS);
  for (const id of ['readout', 'panel', 'nudge', 'sky', 'timeline', 'scene']) {
    await expect(page.locator(`#${id}`), `#${id} says "outside"`).not.toContainText('outside the');
  }
}

/** The readout shows the Sun's numbers again and nothing says the decade failed. */
async function expectNumbers(page: Page, timeout: number): Promise<void> {
  await expect(page.locator('#readout')).toContainText('Altitude', { timeout });
  await expect(page.locator('#readout')).not.toContainText(FAILED);
  await expect(page.locator('#status')).not.toContainText(STATUS);
  await expect(page.locator('.scene-message')).toBeHidden();   // the Sun is lit again
}

test('a decade that did not download says so, shows no Sun in 3D, and comes back when unblocked', async ({ page }, info) => {
  const thrown: string[] = [];
  page.on('pageerror', (err) => thrown.push(err.message));
  let blocked = 0;
  await page.route(DECADE, (route) => { blocked++; return route.abort('failed'); });

  await open(page, `live=${AT_2055}&mode=3d`);
  await expectFailedWords(page);
  expect(blocked).toBeGreaterThan(0);

  // The 3D view: no Sun. Its message is shown exactly when the scene has turned the Sun and its
  // disc off (scene/index.ts, `tabled`); the screenshot is kept with the test's results.
  const message = page.locator('.scene-message');
  await expect(message).toBeVisible();
  await expect(message).toHaveText(FAILED);
  const failedShot = info.outputPath('3d-view-2050s-failed.png');
  await page.locator('.scene-viewport').screenshot({ path: failedShot });
  await info.attach('3d view, 2050s failed', { path: failedShot, contentType: 'image/png' });

  // Unblock and wait: the retry, 10 s after the failure, brings the numbers back. No reload.
  await page.evaluate(() => { (window as unknown as { stillHere: boolean }).stillHere = true; });
  await page.unroute(DECADE);
  await expectNumbers(page, 45_000);
  expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere)).toBe(true);
  const backShot = info.outputPath('3d-view-2050s-back.png');
  await page.locator('.scene-viewport').screenshot({ path: backShot });
  await info.attach('3d view, 2050s back', { path: backShot, contentType: 'image/png' });

  expect(thrown, 'uncaught exceptions').toEqual([]);
});

test('back online, a failed decade is tried again at once', async ({ page, context }) => {
  await open(page, `live=${AT_2026}`);
  await expect(page.locator('#readout')).toContainText('Altitude', { timeout: 30_000 });
  await expect(page.locator('#status')).not.toContainText('Loading', { timeout: 60_000 });

  await context.setOffline(true);
  await page.evaluate((at) => { location.hash = `live=${at}`; }, AT_2055);
  await expectFailedWords(page);

  // Well inside the 10 s wait: only the browser's "online" event can bring it back this soon.
  await context.setOffline(false);
  await expectNumbers(page, 5_000);
});
