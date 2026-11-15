// T32 (issue #32, rows 3 and 1): on first open the crater-floor column (A) in Compare says it is
// still checking to 2100 while the later decades download and the scan back from 2100 runs, then
// "Permanently shadowed (until 2100)", never plain "No sunrise in the next 60 days" in between.
// The decades after the current one are held and then let through, so the order is the same on
// every machine; the Fast 4G runs on the pull request's preview are in docs/ai-use/T32.md.

import { expect, test, type Route } from '@playwright/test';

const CHECKING = 'No sunrise in the next 60 days · checking to 2100…';
const PLAIN = 'No sunrise in the next 60 days';
const SHADOW = 'Permanently shadowed (until 2100)';

type Watched = Window & { floorTexts?: string[] };

test('the floor column says checking to 2100, then permanently shadowed, with nothing between', async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (err) => thrown.push(err.message));
  // Hold every decade after the one holding today (the file is asked for with ?v=<hash>).
  const home = Math.floor(new Date().getUTCFullYear() / 10) * 10;
  const held: Route[] = [];
  let holding = true;
  await page.route('**/data/ephemeris/*.bin*', (route) => {
    const year = Number(/(\d{4})\.bin/.exec(route.request().url())?.[1]);
    if (holding && year > home) held.push(route);
    else void route.continue();
  });

  // Every text column A's Sun countdown ("Sunset in" row) shows, as the page changes it.
  await page.addInitScript(() => {
    const w = window as Watched;
    w.floorTexts = [];
    const read = (): string | null => {
      const table = document.querySelector('#compare table.cmp-table');
      if (!table) return null;
      const col = [...table.querySelectorAll('thead th')]
        .findIndex((th) => th.querySelector('.cmp-label')?.textContent === 'A');
      const row = [...table.querySelectorAll('tbody tr')]
        .find((tr) => tr.querySelector('th')?.textContent === 'Sunset in');
      const td = col > 0 ? row?.children[col] : undefined;
      return td ? (td.firstChild?.nodeValue ?? null) : null;   // a hidden " (best)" may follow
    };
    new MutationObserver(() => {
      const text = read();
      const seen = w.floorTexts as string[];
      if (text !== null && seen[seen.length - 1] !== text) seen.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

  await page.goto('./');   // the plain address: the first-open example pins the floor as A
  await page.getByRole('button', { name: /Start exploring/ }).click();
  const texts = (): Promise<string[]> => page.evaluate(() => (window as Watched).floorTexts ?? []);
  const last = async (): Promise<string | undefined> => (await texts()).at(-1);

  await expect.poll(last, { timeout: 60_000 }).toBe(CHECKING);
  // The draw that says "checking" is the one that asks for the decades: wait for the requests.
  await expect.poll(() => held.length, { message: 'decades held back' }).toBeGreaterThan(0);
  holding = false;
  for (const route of held.splice(0)) await route.continue();

  // The scan back from 2100 ends with no other change of state: Compare must still redraw.
  await expect.poll(last, { timeout: 30_000 }).toBe(SHADOW);
  const seen = await texts();
  const between = seen.slice(seen.indexOf(CHECKING), seen.indexOf(SHADOW));
  expect(between, 'texts from "checking" to "Permanently shadowed"').not.toContain(PLAIN);
  expect(thrown, 'uncaught exceptions').toEqual([]);
});
