// Main page and loading screen, after docs/design/hero.png and loading.png (T22).
// A full-screen layer over the site, in this order:
//   1. The main page, as soon as the site opens. Its big logo starts where the loading screen's
//      logo sits, in the middle, and glides out to the right. The data files load behind it.
//      Under its first screen it scrolls to about, team, privacy, licence and a footer (more.ts).
//   2. "Start exploring": the big logo glides back to the middle and the loading screen shows
//      how far the data is. The site's code runs from the click (main.ts's loadSite; main.ts
//      fetches it earlier without running it); its modules are mounted once the loading screen
//      is on screen. Both block the page for a moment, so they run while only the glide or the
//      logo's pulse moves, never while the main page is animating or waiting for a click.
//   3. The site, once its modules are mounted and the Sun and Earth table and the site list have
//      loaded (or failed: the page's status line says which). The height map keeps loading
//      behind it, and the status line shows how far. LOADING_MAX_MS after the loading screen
//      appears it stops waiting for the data, so a stalled download never locks the page: there
//      is no Skip button. It always waits for the modules (the page behind would be empty), so
//      if they are not mounted by then, the site opens the moment they are. If the site's code
//      does not load, main.ts may reload the page to try again (onSiteFailed), and the page
//      then opens straight on the loading screen (startNow); otherwise the loading screen stays
//      and asks for a reload.
// Every animation here moves or fades only (transform, opacity), so the browser keeps playing it
// even while the page is busy.
// Not a slot of contract section 5: main.ts starts it and feeds it the loading progress.
import './intro.css';
import { logo } from './logo';
import { loadFraction, readyToOpen, type LoadProgress } from './model';
import { moreButton, moreSections } from './more';

const GLIDE_MS = 900;
const GLIDE_EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
/**
 * The longest the loading screen waits for the data (it always waits for the site's modules).
 * The modules show "Loading" for a file not yet in.
 */
const LOADING_MAX_MS = 10_000;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A still star field: decorative, placed in percent so it fits any screen. */
function stars(count: number): HTMLElement {
  const field = make('div', 'intro-stars');
  field.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const star = make('span', 'intro-star');
    star.style.left = `${(i * 61.8) % 100}%`;
    star.style.top = `${(i * 37.3 + 11) % 100}%`;
    star.style.opacity = String(0.15 + (i % 3) * 0.1);
    field.append(star);
  }
  return field;
}

/**
 * Jump every animation inside `el` to its end, so the page is in its final state before the next
 * step. A never-ending one (the title's glow, the arrow's nudge) has no end to jump to, and
 * finish() throws for it: those are stopped instead.
 */
function settleAnimations(el: Element): void {
  for (const a of el.getAnimations({ subtree: true })) {
    try {
      if (a.effect?.getComputedTiming().endTime === Infinity) a.cancel();
      else a.finish();
    } catch {
      a.cancel();
    }
  }
}

/** The transform that puts `from`'s box exactly on `to`'s box (both measured on screen). */
function boxToBox(from: DOMRect, to: DOMRect): string {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const s = to.width / from.width;
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

export interface Intro {
  /** Called by main.ts whenever a data file makes progress, loads or fails. */
  update(progress: LoadProgress): void;
}

export interface IntroOptions {
  /** Loads the site's code and resolves to the function that mounts its modules. Called once. */
  loadSite: () => Promise<() => void>;
  /** Open straight on the loading screen, as if "Start exploring" had been pressed. */
  startNow?: boolean;
  /**
   * Called when the site's code did not load. True means the page is reloading itself to try
   * again: the loading screen then says so instead of asking for a reload.
   */
  onSiteFailed?: () => boolean;
}

/** Runs `fn` after the browser has drawn the current page at least once more. */
function afterPaint(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function startIntro(options: IntroOptions): Intro {
  const root = make('div', 'intro');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Darksight: Lunar Landing Site Navigator');

  // 2. The loading screen. Built now: its logo's place is where the big logo glides from and to.
  const loading = make('div', 'intro-loading');
  const smallLogo = logo('intro-logo-pulse');
  const bar = make('div', 'intro-bar');
  const fill = make('span');
  bar.append(fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-label', 'Lunar data loaded');
  bar.tabIndex = -1; // focus moves here from the button, so screen readers follow the progress
  const caption = make('p', 'intro-caption', 'INITIALISING LUNAR DATA…');
  caption.setAttribute('aria-live', 'polite');
  loading.append(smallLogo, bar, caption);

  // 1. The main page.
  const page = make('section', 'intro-hero');
  const glow = make('div', 'intro-glow');
  glow.setAttribute('aria-hidden', 'true');
  const bigLogo = logo('intro-logo-big');
  const mark = make('div', 'intro-mark');
  const word = make('span', 'intro-wordmark');
  word.append('DARK', make('br'), 'SIGHT');
  mark.append(logo('intro-logo-sm'), word);
  // The title's letters and the subtitle's lines are separate boxes, so each can rise in on its
  // own (intro.css). Screen readers get the plain words from aria-label.
  const title = make('h1', 'intro-title');
  title.setAttribute('aria-label', 'DARKSIGHT');
  [...'DARKSIGHT'].forEach((ch, i) => {
    const letter = make('span', 'intro-ch', ch);
    letter.setAttribute('aria-hidden', 'true');
    letter.style.setProperty('--i', String(i));
    title.append(letter);
  });
  const sub = make('p', 'intro-sub');
  sub.append(make('span', 'intro-line', 'Lunar Landing'), make('span', 'intro-line', 'Site Navigator'));
  const start = make('button', 'btn intro-start', 'Start exploring ');
  const arrow = make('span', 'intro-arrow', '→');
  arrow.setAttribute('aria-hidden', 'true');
  start.append(arrow);
  start.type = 'button';
  const text = make('div', 'intro-text');
  text.append(title, sub, start);
  const more = moreButton();
  const first = make('div', 'intro-first');
  first.append(glow, bigLogo, mark, text, more);
  const below = moreSections();
  page.append(first, below);

  let latest: LoadProgress | null = null;
  let started = false;
  let closed = false;
  let siteReady = false;
  let siteFailed = false;
  let reloading = false;
  let waitedMax = false; // LOADING_MAX_MS has passed since the loading screen appeared
  let siteCode: Promise<() => void> | null = null;

  /** Starts downloading and running the site's code, once. */
  function loadSiteCode(): Promise<() => void> {
    siteCode ??= options.loadSite();
    return siteCode;
  }

  /** Where the loading screen's logo sits on this screen, measured without showing it. */
  function smallLogoBox(): DOMRect {
    loading.classList.add('intro-measure');
    root.append(loading);
    const box = smallLogo.getBoundingClientRect();
    loading.remove();
    loading.classList.remove('intro-measure');
    return box;
  }

  function drawProgress(): void {
    const fraction = latest ? loadFraction(latest) : 0;
    const pct = Math.round(fraction * 100);
    fill.style.transform = `scaleX(${fraction})`;
    bar.setAttribute('aria-valuenow', String(pct));
    if (reloading) caption.textContent = 'LOADING THE LATEST VERSION OF THE SITE…';
    else if (siteFailed) caption.textContent = 'THE SITE DID NOT LOAD. PLEASE RELOAD THE PAGE.';
    else if (dataDone()) caption.textContent = 'PREPARING THE SITE…';
    else caption.textContent = `INITIALISING LUNAR DATA… ${pct}%`;
  }

  /** True once the loading screen has nothing left to wait for in the data. */
  function dataDone(): boolean {
    return waitedMax || (latest !== null && readyToOpen(latest));
  }

  /**
   * Leaves for the site once its modules are mounted and the data is done. Never before the
   * modules are mounted: the page behind the layer would be empty.
   */
  function maybeClose(): void {
    if (siteReady && dataDone()) close();
  }

  // 3. The site.
  function close(): void {
    if (closed) return;
    closed = true;
    root.classList.add('intro-closing');
    document.body.classList.remove('intro-open');
    const remove = (): void => root.remove();
    // The fade lasts as long as intro.css says; under reduced motion there is none.
    if (reducedMotion()) remove();
    else {
      // Only the layer's own fade: the loading bar's shorter width transition bubbles up too.
      root.addEventListener('transitionend', (e) => {
        if (e.target === root) remove();
      });
      setTimeout(remove, 1000); // in case the transition never fires
    }
  }

  function showLoading(): void {
    // Once only: after a failed glide both the click handler's catch and the glide's end call it.
    if (closed || loading.isConnected) return;
    drawProgress();
    page.replaceWith(loading);
    bar.focus();
    setTimeout(() => {
      waitedMax = true;
      drawProgress();
      maybeClose();
    }, LOADING_MAX_MS);
    // Once the loading screen is drawn and its pulse is running, mount the site.
    afterPaint(() => {
      loadSiteCode()
        .then((mountSite) => mountSite())
        .then(
          () => {
            siteReady = true;
            drawProgress();
            maybeClose();
          },
          (err: unknown) => {
            console.error('The site did not load', err);
            siteFailed = true;
            reloading = options.onSiteFailed?.() ?? false;
            drawProgress();
          },
        );
    });
  }

  start.addEventListener('click', () => {
    if (started) return;
    started = true;
    // From here on a failure must not leave the button dead (it already counts as pressed):
    // anything that throws skips the glide and goes straight to the loading screen.
    try {
      page.scrollTop = 0; // the glide starts from the big logo on the first screen
      settleAnimations(page);
      // The code downloads during the glide; the glide only moves and fades, so it stays smooth
      // even while the code starts up.
      afterPaint(() => void loadSiteCode().catch(() => undefined));
      if (reducedMotion()) {
        showLoading();
        return;
      }
      // The big logo glides back to the middle and shrinks to the loading screen's logo.
      const to = smallLogoBox();
      const from = bigLogo.getBoundingClientRect();
      const fade = { duration: GLIDE_MS / 2, easing: 'ease-out', fill: 'forwards' } as const;
      for (const el of [text, mark, glow, more, below]) el.animate([{ opacity: 1 }, { opacity: 0 }], fade);
      bigLogo.animate(
        [{ transform: 'none', opacity: getComputedStyle(bigLogo).opacity }, { transform: boxToBox(from, to), opacity: 1 }],
        { duration: GLIDE_MS, easing: GLIDE_EASE, fill: 'forwards' },
      ).finished.then(showLoading, showLoading);
    } catch (err) {
      console.error('Intro: the glide failed, showing the loading screen', err);
      showLoading();
    }
  });

  root.append(stars(60), page);
  document.body.append(root);
  document.body.classList.add('intro-open');
  start.focus();

  if (options.startNow) {
    // Straight on the loading screen, with no glide.
    started = true;
    showLoading();
  } else if (!reducedMotion()) {
    // The big logo starts as the loading screen's logo, in the middle, and glides to the right.
    const from = smallLogoBox();
    const to = bigLogo.getBoundingClientRect();
    bigLogo.animate(
      [{ transform: boxToBox(to, from), opacity: 1 }, { transform: 'none', opacity: getComputedStyle(bigLogo).opacity }],
      { duration: GLIDE_MS, easing: GLIDE_EASE },
    );
    // The corner mark and the glow fade in; the text has its own entrance in intro.css.
    const appear = { duration: GLIDE_MS / 2, delay: GLIDE_MS / 2, easing: 'ease-out', fill: 'backwards' } as const;
    for (const el of [mark, glow]) el.animate([{ opacity: 0 }, { opacity: getComputedStyle(el).opacity }], appear);
  }

  return {
    update(progress: LoadProgress): void {
      latest = progress;
      if (closed || !started || !loading.isConnected) return;
      drawProgress();
      maybeClose();
    },
  };
}
