// T19 "Done when" line 2: on the built site, text against its background is 4.5 to 1 or better.
// Checker: this file (WCAG 2 relative luminance and contrast ratio), in headless Chromium.
//
// Three kinds of text:
// - Page text (HTML and Plotly's SVG): its colour against the first opaque background behind it,
//   colours with alpha composited in order.
// - Page text over a picture (the map or 3D canvas): the text is hidden, its box is
//   screenshotted, and every pixel must give 4.5 to 1 against the text colour.
// - Text drawn into a canvas (map labels): each fillText must follow a strokeText of the same
//   text at the same place (an outline at least 2 px wide), and the fill must give 4.5 to 1
//   against the outline. Text straight on the terrain fails: the ground under it changes.
// Placeholders are checked too: `::placeholder` colour against the field's background.

import { expect, test, type Page } from '@playwright/test';

const MIN = 4.5;

type Rgba = [number, number, number, number];

declare global {
  interface Window {
    __canvasText: { text: string; fill: string; stroke: string | null; width: number }[];
  }
}

// Records what each 2D canvas writes, before any module script runs.
function recordCanvasText(): void {
  window.__canvasText = [];
  const proto = CanvasRenderingContext2D.prototype;
  const fillText = proto.fillText;
  const strokeText = proto.strokeText;
  let lastStroke: { text: string; x: number; y: number; style: string; width: number } | null = null;
  proto.strokeText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, max?: number) {
    lastStroke = { text, x, y, style: String(this.strokeStyle), width: this.lineWidth };
    return strokeText.call(this, text, x, y, max);
  };
  proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, max?: number) {
    const halo = lastStroke && lastStroke.text === text && lastStroke.x === x && lastStroke.y === y ? lastStroke : null;
    const list = window.__canvasText;
    if (list.length < 2000) list.push({ text, fill: String(this.fillStyle), stroke: halo?.style ?? null, width: halo?.width ?? 0 });
    lastStroke = null;
    return fillText.call(this, text, x, y, max);
  };
}

/** Runs in the page: every visible text element with its colours, or its box when over a picture. */
function collectText(): {
  pairs: { where: string; text: string; fg: Rgba; bg: Rgba }[];
  overPicture: { where: string; text: string; fg: Rgba }[];
} {
  const parse = (c: string): Rgba => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top: Rgba, under: Rgba): Rgba => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    const mix = (i: number) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
    return [mix(0), mix(1), mix(2), a];
  };
  const label = (el: Element) =>
    el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`;
  const where = (el: Element) => {
    const slot = el.closest('[id]');
    return slot && slot !== el ? `${label(slot)} ${label(el)}` : label(el);
  };
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    if (s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const pictures = 'canvas, img, video';
  const pairs: ReturnType<typeof collectText>['pairs'] = [];
  const overPicture: ReturnType<typeof collectText>['overPicture'] = [];

  const els = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.textContent?.trim() && n.parentElement) els.add(n.parentElement);
  }
  for (const el of els) {
    if (el.closest('script, style, noscript, [hidden], [aria-hidden="true"] svg defs')) continue;
    if (!visible(el) || el.closest('[hidden]')) continue;
    const fg = parse(getComputedStyle(el).color);
    const text = (el.textContent ?? '').trim().slice(0, 40);
    // Backgrounds from the element outward, until one is opaque.
    const layers: Rgba[] = [];
    let pictureBelow = false;
    for (let a: Element | null = el; a; a = a.parentElement) {
      const bg = parse(getComputedStyle(a).backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 1) break;
      // A positioned box over a canvas or image: the picture shows through.
      const pos = getComputedStyle(a).position;
      if ((pos === 'absolute' || pos === 'fixed') && a.parentElement?.querySelector(`:scope > ${pictures}, :scope > * ${pictures}`)) {
        pictureBelow = true;
        break;
      }
    }
    if (pictureBelow && !(layers.length && layers[layers.length - 1][3] >= 1)) {
      el.setAttribute('data-contrast-i', String(overPicture.length));
      overPicture.push({ where: where(el), text, fg });
      continue;
    }
    let bg: Rgba = [255, 255, 255, 1]; // the browser's canvas, if nothing on the page is opaque
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    pairs.push({ where: where(el), text, fg: over(fg, bg), bg });
  }
  // Placeholders of empty fields.
  for (const f of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]')) {
    if (f.value || !visible(f)) continue;
    const ph = parse(getComputedStyle(f, '::placeholder').color);
    let bg: Rgba = [0, 0, 0, 0];
    for (let a: Element | null = f; a && bg[3] < 1; a = a.parentElement) bg = over(bg, parse(getComputedStyle(a).backgroundColor));
    pairs.push({ where: `${where(f)}::placeholder`, text: f.placeholder, fg: over(ph, bg), bg });
  }
  return { pairs, overPicture };
}

function luminance([r, g, b]: Rgba): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function cssColour(c: string): Rgba {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`can't read colour ${c}`);
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/** Every pixel of a screenshot (RGBA, from the PNG decoded in the page). */
async function pixels(page: Page, png: Buffer): Promise<number[]> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(0, 0, c.width, c.height).data];
  }, png.toString('base64'));
}

async function check(page: Page, hash: string, before?: (page: Page) => Promise<void>): Promise<string[]> {
  await page.addInitScript(recordCanvasText);
  await page.goto(`./${hash}`);
  await page.getByRole('button', { name: /Start exploring/ }).click();
  await expect(page.locator('#status')).not.toContainText('Loading', { timeout: 60_000 });
  await expect(page.locator('#mission')).not.toBeEmpty({ timeout: 30_000 });
  await before?.(page);
  await page.waitForTimeout(1500); // let the map and charts finish drawing

  const fails: string[] = [];
  const { pairs, overPicture } = await page.evaluate(collectText);
  for (const p of pairs) {
    const r = ratio(p.fg, p.bg);
    if (r < MIN) fails.push(`${p.where} "${p.text}": ${r.toFixed(2)} to 1`);
  }
  for (const [i, t] of overPicture.entries()) {
    // Hide the text, photograph what is behind it, then compare every pixel with its colour.
    const el = page.locator(`[data-contrast-i="${i}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.evaluate((e) => (e as HTMLElement).style.setProperty('color', 'transparent', 'important'));
    const box = await el.boundingBox();
    const png = box ? await page.screenshot({ clip: box }) : null;
    await el.evaluate((e) => (e as HTMLElement).style.removeProperty('color'));
    if (!png) continue;
    const px = await pixels(page, png);
    let low = 0;
    let worst = Infinity;
    for (let i = 0; i < px.length; i += 4) {
      const r = ratio(t.fg, [px[i], px[i + 1], px[i + 2], 1]);
      worst = Math.min(worst, r);
      if (r < MIN) low++;
    }
    if (low > 0) {
      fails.push(`${t.where} "${t.text}" over the picture: ${((100 * low) / (px.length / 4)).toFixed(0)} % of pixels under ${MIN}, worst ${worst.toFixed(2)} to 1`);
    }
  }
  const seen = new Set<string>();
  for (const c of await page.evaluate(() => window.__canvasText)) {
    if (seen.has(c.text)) continue;
    seen.add(c.text);
    if (!c.stroke || c.width < 2) {
      fails.push(`canvas text "${c.text}": drawn straight on the picture, no outline`);
      continue;
    }
    const r = ratio(cssColour(c.fill), cssColour(c.stroke));
    if (r < MIN) fails.push(`canvas text "${c.text}": ${r.toFixed(2)} to 1 against its outline`);
  }
  console.log(`checked ${pairs.length} page texts, ${overPicture.length} over a picture, ${seen.size} canvas texts`);
  return fails;
}

// The south pole site (polar map), a site off the height map (whole-Moon map with the "Sun
// overhead" and "Earth overhead" markers), a time outside the Sun and Earth table (the message
// over the map), the 3D view, a phone, and the time box emptied (its placeholder shows).
const CASES: { name: string; hash: string; width: number; height: number; before?: (page: Page) => Promise<void> }[] = [
  { name: 'polar map, desktop', hash: '', width: 1280, height: 900 },
  { name: 'whole-Moon map, desktop', hash: '#live=0,0,2026-11-14T10:00:00Z', width: 1280, height: 900 },
  { name: 'outside the table', hash: '#live=-89.5,0,2150-01-01T00:00:00Z', width: 1280, height: 900 },
  { name: '3D orbit, desktop', hash: '#mode=3d', width: 1280, height: 900 },
  { name: 'polar map, phone', hash: '', width: 390, height: 844 },
  {
    name: 'empty time box (its placeholder)', hash: '', width: 1280, height: 900,
    before: (page) => page.locator('#scenarios input[placeholder]').first().fill(''),
  },
];

for (const c of CASES) {
  test(`text contrast: ${c.name}`, async ({ page }) => {
    await page.setViewportSize({ width: c.width, height: c.height });
    const fails = await check(page, c.hash, c.before);
    expect(fails, `text under ${MIN} to 1`).toEqual([]);
  });
}
