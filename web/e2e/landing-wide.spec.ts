// Issue #178: on a wide screen the landing page's big logo stays beside the title, not at the
// window's far right edge. Measured with reduced motion, so the logo is already in place (no glide).
// Up to the first screen's column width (intro.css, --hero-col) the layout is as before #178.

import { expect, test } from '@playwright/test';

/** The title's and the big logo's boxes on the landing page, at a window of w x h. */
async function boxes(page: import('@playwright/test').Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.getByRole('button', { name: /Start exploring/ }).waitFor();
  return page.evaluate(() => {
    const box = (s: string) => {
      const b = document.querySelector(s)!.getBoundingClientRect();
      return { left: b.left, right: b.right, width: b.width };
    };
    return { title: box('.intro-title'), logo: box('.intro-logo-big'), page: document.documentElement.clientWidth };
  });
}

for (const [w, h] of [[2560, 1080], [3440, 1440]] as const) {
  test(`at ${w} x ${h} the big logo sits beside the title, inside the window`, async ({ page }) => {
    const { title, logo, page: width } = await boxes(page, w, h);
    const gap = logo.left - title.right;
    // Before #178: 1199 px at 2560 x 1080 and 1842 px at 3440 x 1440, the logo cut off at the edge.
    expect(gap, 'space between the title and the logo').toBeGreaterThanOrEqual(0);
    expect(gap, 'space between the title and the logo').toBeLessThan(title.width / 2);
    expect(logo.right, "the logo's right edge").toBeLessThanOrEqual(width);
  });
}

test('at 1440 x 900 the landing page is as before #178', async ({ page }) => {
  const { title, logo } = await boxes(page, 1440, 900);
  // 48 px padding; 78vmin logo, 12vmin past the right edge (vmin = 9 px here).
  expect(Math.round(title.left)).toBe(48);
  expect(Math.round(logo.width)).toBe(702);
  expect(Math.round(logo.right)).toBe(1440 + 108);
});
