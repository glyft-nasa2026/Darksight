// T29 (spec F16): switching between the 2D map and the 3D view cross-fades. The browser check of
// the task's "Done when", on the built page with the real data. Every frame of a switch is
// recorded in the page: how much of the 3D view shows (the viewport's data-fade, written by
// scene/index.ts), the map's opacity, and where the 3D camera drew from (the canvas's
// data-camera).

import { expect, test, type Page } from '@playwright/test';

// The rim of the mock crater's latitude band: T31's own check clicks (-88, 45) on a map centred here.
const HASH = 'live=-88.4,45,2026-01-01T00:00:00Z';
const R_M = 1737400;

type Frame = { t: number; fade: number; fading: boolean; opacity: number; mapHidden: boolean; canvasShown: boolean; camera: number[] | null };

/** Opens the page at the crater's band, past "Start exploring", once the south polar map is drawn. */
async function open(page: Page): Promise<void> {
  await page.goto(`./#${HASH}`);
  await page.getByRole('button', { name: /Start exploring/ }).click();
  await expect(page.locator('#sky')).not.toBeEmpty({ timeout: 60_000 });
  await expect(page.locator('#status')).not.toContainText('Loading', { timeout: 60_000 });
  await expect(page.locator('.scene-caption')).toContainText('South-pole terrain · polar stereographic', { timeout: 60_000 });
  await expect(page.locator('.scene-viewport')).toHaveAttribute('data-fade', '0.000');
}

/** Starts recording every frame. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: unknown[]; __recording: boolean };
    w.__frames = []; w.__recording = true;
    const viewport = document.querySelector<HTMLElement>('.scene-viewport')!;
    const map = document.querySelector<HTMLElement>('.map')!;
    const canvas = document.querySelector<HTMLCanvasElement>('.scene-canvas')!;
    const tick = (t: number): void => {
      if (!w.__recording) return;
      w.__frames.push({
        t, fade: Number(viewport.dataset.fade), fading: viewport.classList.contains('scene-fading'),
        opacity: Number(getComputedStyle(map).opacity), mapHidden: map.hidden,
        canvasShown: getComputedStyle(canvas).display !== 'none',
        camera: canvas.dataset.camera ? canvas.dataset.camera.split(',').map(Number) : null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stops recording and returns the frames. */
async function frames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __recording: boolean };
    w.__recording = false;
    return w.__frames;
  });
}

/** Waits until no fade runs and the view shows all of one side: 1 for 3D, 0 for the map. */
async function settled(page: Page, fade: 0 | 1): Promise<void> {
  const viewport = page.locator('.scene-viewport');
  await expect(viewport).toHaveAttribute('data-fade', fade.toFixed(3), { timeout: 60_000 });
  await expect(viewport).not.toHaveClass(/scene-fading/);
}

const distance = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The steps of a fade: the frames from its start to its end, with the frame before and after it. */
function fadeSteps(all: Frame[]): { before: Frame; during: Frame[]; after: Frame } {
  const first = all.findIndex((f) => f.fading);
  let last = first;
  while (last + 1 < all.length && all[last + 1].fading) last++;
  expect(first, 'a fade ran').toBeGreaterThan(0);
  expect(last + 1, 'the fade ended').toBeLessThan(all.length);
  return { before: all[first - 1], during: all.slice(first, last + 1), after: all[last + 1] };
}

/** One fade, from one end to the other, smooth and with no jump at either end. */
function expectSmoothFade(all: Frame[], from: 0 | 1, to: 0 | 1): Frame[] {
  const { before, during, after } = fadeSteps(all);
  const values = [before.fade, ...during.map((f) => f.fade), after.fade];
  expect(values[0], 'starts from the old view').toBe(from);
  expect(values.at(-1), 'ends on the new view').toBe(to);
  // Always the same way, and slow at both ends (eased): the first and last steps are small.
  for (let i = 1; i < values.length; i++) expect((values[i] - values[i - 1]) * (to - from)).toBeGreaterThanOrEqual(0);
  expect(Math.abs(values[1] - values[0]), 'no jump at the start').toBeLessThan(0.05);
  expect(Math.abs(values.at(-1)! - values.at(-2)!), 'no jump at the end').toBeLessThan(0.05);
  expect(during.length, 'frames in the fade').toBeGreaterThan(4);
  const steps = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  console.log(`T29 fade ${from} to ${to}: ${during.length} frames over ${Math.round(after.t - before.t)} ms; `
    + `first step ${steps[0].toFixed(4)}, last step ${steps.at(-1)!.toFixed(4)}, largest ${Math.max(...steps).toFixed(4)}`);
  // A cross-fade: the map over the 3D view at 1 - shown, both there throughout.
  for (const f of during) {
    expect(Math.abs(f.opacity - (1 - f.fade))).toBeLessThan(0.01);
    expect(f.canvasShown && !f.mapHidden, 'both views show during the fade').toBe(true);
  }
  return during;
}

test.describe('T29: the cross-fade between the 2D map and the 3D view', () => {
  test.setTimeout(180_000);

  test('2D to 3D and back fades, with no jump at the start or the end', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (err) => thrown.push(err.message));
    await open(page);

    await record(page);
    await page.getByRole('button', { name: '3D orbit', exact: true }).click();
    await settled(page, 1);
    await page.waitForTimeout(500);
    const to3d = await frames(page);
    const during3d = expectSmoothFade(to3d, 0, 1);
    const after3d = to3d.at(-1)!;
    expect(after3d.mapHidden && after3d.canvasShown, 'after it, the 3D view only').toBe(true);
    // The camera came down from straight above the site to the orbit view, and the frames after
    // the fade draw from where its last frame was heading: no jump at the end.
    const cams = during3d.map((f) => f.camera).filter((c): c is number[] => !!c);
    const steady = after3d.camera!;
    const path = distance(cams[0], steady);
    expect(path, 'the camera moved').toBeGreaterThan(1);
    expect(distance(cams.at(-1)!, steady) / path, 'last fade frame next to the orbit view').toBeLessThan(0.05);
    for (let i = 1; i < cams.length; i++) expect(distance(cams[i], cams[i - 1]) / path).toBeLessThan(0.4);

    // Back to 2D, counting WebGL draws once the map is on its own (T31: none while the map shows).
    await record(page);
    await page.getByRole('button', { name: '2D map', exact: true }).click();
    await settled(page, 0);
    await page.waitForTimeout(300);   // the recorder's frames after the fade's last
    const to2d = await frames(page);
    expectSmoothFade(to2d, 1, 0);
    const after2d = to2d.at(-1)!;
    expect(!after2d.mapHidden && !after2d.canvasShown && after2d.opacity === 1, 'after it, the map only').toBe(true);
    await page.evaluate(() => {
      const w = window as unknown as { __glDraws: number };
      w.__glDraws = 0;
      for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
        for (const name of ['drawArrays', 'drawElements'] as const) {
          const original = C.prototype[name] as (...args: unknown[]) => unknown;
          (C.prototype as unknown as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) { w.__glDraws++; return original.apply(this, args); };
        }
      }
    });
    const box = (await page.locator('.map-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __glDraws: number }).__glDraws), 'WebGL draws after the fade to 2D').toBe(0);
    expect(thrown).toEqual([]);
  });

  test('a second switch during a fade goes back from where it is, with no snap', async ({ page }) => {
    await open(page);
    // The first 3D view builds its meshes once; let that happen before timing the turn.
    await page.getByRole('button', { name: '3D orbit', exact: true }).click();
    await settled(page, 1);
    await page.getByRole('button', { name: '2D map', exact: true }).click();
    await settled(page, 0);

    await record(page);
    await page.getByRole('button', { name: '3D orbit', exact: true }).click();
    // Clicked from inside the page, in the first frame past a third of the way: from outside,
    // the round trip can take longer than what is left of the fade.
    const turnedAt = await page.evaluate(() => new Promise<number>((done) => {
      const viewport = document.querySelector<HTMLElement>('.scene-viewport')!;
      const twoD = document.querySelector<HTMLButtonElement>('[data-mode="2d"]')!;
      const tick = (): void => {
        const shown = Number(viewport.dataset.fade);
        if (shown > 0.3) { twoD.click(); done(shown); } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    await settled(page, 0);
    console.log(`T29 second switch at ${turnedAt.toFixed(3)} of the way to 3D`);
    const all = (await frames(page)).filter((f) => f.fading || f.fade === 0);
    const values = all.map((f) => f.fade);
    const peak = values.indexOf(Math.max(...values));
    expect(values[peak], 'turned round part-way').toBeGreaterThan(0.25);
    expect(values[peak], 'turned round part-way').toBeLessThan(1);
    // Up to the peak it rises, after it falls, and the turn itself is a small step: no snap to
    // either end first.
    for (let i = 1; i <= peak; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    for (let i = peak + 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    expect(values[peak] - values[peak + 1], 'the first step back').toBeLessThan(0.05);
    expect(values.at(-1)).toBe(0);
    expect(values.every((v) => v < 1), 'never reached the 3D view').toBe(true);
  });

  test('a click during a fade is ignored; after a fade, a click lands within one grid cell (T31\'s check)', async ({ page }) => {
    await open(page);
    const dem = await (await page.request.get('./data/dem.json')).json() as { size: number; pixel_m: number };
    const projected = (lat: number, lon: number): [number, number] => {
      const r = 2 * R_M * Math.tan(((90 + lat) / 2) * Math.PI / 180);
      return [r * Math.sin(lon * Math.PI / 180), r * Math.cos(lon * Math.PI / 180)];
    };
    const site = async (): Promise<{ lat: number; lon: number }> => ({
      lat: Number(await page.locator('#scn-lat').inputValue()),
      lon: Number(await page.locator('#scn-lon').inputValue()),
    });
    const map = page.locator('.map-canvas');
    const box = (await map.boundingBox())!;
    /** Where (lat, lon) is on the polar map just after it centred on the site (as browser-check.py's map_point). */
    const mapPoint = (lat: number, lon: number): [number, number] => {
      const spanKm = Math.min(80, Math.max(8, dem.size * dem.pixel_m / 8000));
      const scale = box.height / (2 * spanKm * 1000);
      const [cx, cy] = projected(-88.4, 45), [x, y] = projected(lat, lon);
      return [box.x + box.width / 2 + (x - cx) * scale, box.y + box.height / 2 - (y - cy) * scale];
    };

    // A click in the middle of a fade to 3D, and of the fade back: neither sets a site.
    await page.getByRole('button', { name: '3D orbit', exact: true }).click();
    await expect.poll(async () => Number(await page.locator('.scene-viewport').getAttribute('data-fade')), { timeout: 30_000 }).toBeGreaterThan(0.1);
    await page.mouse.click(...mapPoint(-88.2, 40));
    await settled(page, 1);
    expect(await site()).toEqual({ lat: -88.4, lon: 45 });
    await page.getByRole('button', { name: '2D map', exact: true }).click();
    await expect.poll(async () => Number(await page.locator('.scene-viewport').getAttribute('data-fade')), { timeout: 30_000 }).toBeLessThan(0.9);
    await page.mouse.click(...mapPoint(-88.2, 40));
    await settled(page, 0);
    expect(await site(), 'a click during a fade sets no site').toEqual({ lat: -88.4, lon: 45 });

    // After the fades, T31's check: a click on the crater centre (-88, 45) lands within one cell.
    await page.mouse.click(...mapPoint(-88, 45));
    await expect.poll(async () => (await site()).lat).not.toBe(-88.4);
    const picked = await site();
    const [ax, ay] = projected(picked.lat, picked.lon), [bx, by] = projected(-88, 45);
    const cells = Math.hypot(ax - bx, ay - by) / dem.pixel_m;
    console.log(`T29 click after a fade: ${JSON.stringify(picked)}, ${cells.toFixed(3)} grid cells from (-88, 45)`);
    expect(cells).toBeLessThan(1);
  });

  test('with reduced motion the view jumps, as before', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    for (const [name, end] of [['3D orbit', 1], ['2D map', 0]] as const) {
      await record(page);
      await page.getByRole('button', { name, exact: true }).click();
      await settled(page, end);
      await page.waitForTimeout(300);
      const all = await frames(page);
      expect(all.some((f) => f.fading), `${name}: no fade`).toBe(false);
      expect(all.every((f) => f.fade === 0 || f.fade === 1), `${name}: nothing in between`).toBe(true);
      expect(all.at(-1)!.mapHidden, `${name}: map hidden`).toBe(end === 1);
      expect(all.at(-1)!.canvasShown, `${name}: 3D shown`).toBe(end === 1);
    }
  });
});
