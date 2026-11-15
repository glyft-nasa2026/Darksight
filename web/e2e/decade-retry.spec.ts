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
  // #sky is the last slot site.ts mounts on this page (#mission has its own page, T34-f).
  await expect(page.locator('#sky')).not.toBeEmpty({ timeout: 60_000 });
}

/**
 * Every place that says why there are no numbers, in the failed decade's words. Read all at the
 * same moment, and again until they agree: while a retry downloads they all say "Loading".
 */
async function expectFailedWords(page: Page): Promise<void> {
  await expect(async () => {
    const text = await page.evaluate((ids) =>
      Object.fromEntries(ids.map((id) => [id, document.getElementById(id)?.textContent ?? ''])),
    ['readout', 'panel', 'nudge', 'sky', 'timeline', 'scene', 'status']);
    for (const id of ['readout', 'panel', 'nudge', 'sky', 'timeline', 'scene']) {
      expect(text[id], `#${id}`).toContain(FAILED);
      expect(text[id], `#${id} says "outside"`).not.toContain('outside the');
    }
    expect(text.status, '#status').toContain(STATUS);
  }).toPass({ timeout: 40_000 });
}

/** The readout shows the Sun's numbers again and nothing says the decade failed. */
async function expectNumbers(page: Page, timeout: number): Promise<void> {
  await expect(page.locator('#readout')).toContainText('Altitude', { timeout });
  await expect(page.locator('#readout')).not.toContainText(FAILED);
  await expect(page.locator('#status')).not.toContainText(STATUS);
  await expect(page.locator('.scene-message')).toBeHidden();   // the Sun is lit again
}

test('a decade that did not download says so, shows no Sun in 3D, and comes back when unblocked', async ({ page }, info) => {
  test.setTimeout(180_000);
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
  await expect(message).toHaveText(FAILED, { timeout: 15_000 });
  const failedShot = info.outputPath('3d-view-2050s-failed.png');
  await page.locator('.scene-viewport').screenshot({ path: failedShot });
  await info.attach('3d view, 2050s failed', { path: failedShot, contentType: 'image/png' });

  // Unblock and wait: the next retry brings the numbers back, no reload. It comes 10 s after
  // the first failure, then 20 s, 40 s and at most 60 s after the next ones (state.ts).
  await page.evaluate(() => { (window as unknown as { stillHere: boolean }).stillHere = true; });
  await page.unroute(DECADE);
  await expectNumbers(page, 75_000);
  expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere)).toBe(true);
  const backShot = info.outputPath('3d-view-2050s-back.png');
  await page.locator('.scene-viewport').screenshot({ path: backShot });
  await info.attach('3d view, 2050s back', { path: backShot, contentType: 'image/png' });

  expect(thrown, 'uncaught exceptions').toEqual([]);
});

// T33: the mission page (T34-f) plans from the same table; it said the landing time was "too
// near the edge of the table" for a decade that did not download.
const LANDING = '-89.6866,-162.81,2055-06-01T05:00:00Z';

test('the mission page says which decade did not download, then plans the mission when it arrives', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route(DECADE, (route) => route.abort('failed'));
  await page.goto(`./mission.html#live=${LANDING}&land=${LANDING}`);
  const mission = page.locator('#mission');
  await expect(async () => {
    const card = (await mission.textContent()) ?? '';
    expect(card).toContain(FAILED);
    expect(card).not.toContain('too near the edge');
    expect(await page.locator('#mp-status').textContent()).toContain(STATUS);
  }).toPass({ timeout: 60_000 });

  await page.unroute(DECADE);
  await expect(mission.locator('.ms-table')).toBeVisible({ timeout: 75_000 });   // the flight table: a plan
  await expect(mission).not.toContainText(FAILED);
  await expect(page.locator('#mp-status')).not.toContainText(STATUS);
});

test('the launch simulation page says which decade did not download', async ({ page }) => {
  await page.route(DECADE, (route) => route.abort('failed'));
  await page.goto(`./simulation.html#live=${LANDING}&land=${LANDING}`);
  await expect(page.locator('#sim')).toContainText(FAILED, { timeout: 30_000 });
  await expect(page.locator('#sim')).not.toContainText('too near the edge');
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
