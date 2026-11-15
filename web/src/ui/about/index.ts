// #about (T16): the bar across the top (name, Horizons badge, About button) and the About panel.
// Spec F13. The panel's sources and AI-use lists are collected from docs/ at build time
// (collect.ts) and loaded the first time the panel opens, so they add nothing to the first load.
import './about.css';
import { getState, subscribe } from '../../state';
import { logo } from '../intro/logo';
import {
  byTask, parseAiUse, parseSources, repoPath, toolsNamed, REPO_URL,
  type AiEntry, type Cell, type DocFile, type SourceEntry,
} from './collect';
import { EXPLAIN, EXPLAIN_INTRO, type ExplainPoint } from './explain';
import { badgeSentence, badgeText, formatDeg, readValidation, type HorizonsCheck } from './validation';

// --- The panel's text, in one place: update it here at the freeze ----------------------------

const WHAT_IT_SHOWS = [
  'Darksight compares lunar landing sites and dates side by side: when each one has sunlight ' +
    '(power) and a line of sight to Earth (radio), measured against the real terrain skyline.',
  'Pick a site on the map, from the curated list or by typing its latitude and longitude, pick a ' +
    'time, and pin up to three scenarios to compare. Every number comes from the same calculation ' +
    'in the browser, from a table of Sun and Earth positions and a height map of the south pole.',
];

// "Why the Moon is different" (T39) is in explain.ts, where a test keeps it short.

const NO_REFRACTION =
  'The Moon has no atmosphere, so nothing bends the light: the Sun and Earth are exactly where ' +
  'the geometry puts them. Darksight applies no refraction, unlike sunrise tables on Earth.';

const LIBRATION = [
  'The Moon keeps the same face towards Earth, but not exactly. It rocks a little as it goes ' +
    'round (libration), and its distance from Earth changes through the month. So from a site on ' +
    'the near side, Earth doesn\'t stand still in the sky: over a month it traces a small loop ' +
    'round one spot. Near the edge of the near side, which includes the south pole, the loop dips ' +
    'below the horizon, so Earth rises and sets there.',
  'Darksight includes both. Every Sun and Earth position comes from NASA JPL\'s DE440 ephemeris, ' +
    'with the Moon turned by its own measured orientation (NAIF\'s moon_pa_de440 file), so the ' +
    'rocking and the changing distance are in every number on the page. The sky panorama draws ' +
    'Earth\'s loop over the next 30 days.',
];

const KNOWN_LIMITS = [
  // SPEC.md section 8, plus where the terrain applies (section 6).
  'Real terrain applies everywhere, looking out to 150 km. South of 85° S it comes from the LOLA ' +
    'south-pole height map, 240 m per cell. Anywhere else it comes from LOLA\'s whole-Moon height ' +
    'map, 3.8 km per cell: crater walls and massifs show, a ridge under a few km across doesn\'t. ' +
    'The page says which applies, and treats the Moon as smooth while a height map is loading.',
  'The height map is 240 m per cell near the south pole. Rocks and small craters near the lander aren\'t seen.',
  'The skyline looks out to 150 km. A very tall peak further away is missed.',
  'The Sun\'s visible fraction is by height of the disc, not by area.',
  'Earth is treated as a point for "visible or hidden".',
  'The table covers 1900-2100, one row every 3 hours, with straight-line steps between rows. ' +
    '"Permanently shadowed" means no sunlight from the chosen time to the end of 2100.',
];

const AI_INTRO =
  'The team built Darksight with AI coding assistants. Each task keeps a record of what the AI ' +
  'generated and what a person checked; every row of those records is below, by task.';

// ---------------------------------------------------------------------------------------------

// Collected at build time from docs/ (vite.config.ts lets the dev server read docs/ too).
const sourceFiles = import.meta.glob('../../../../docs/sources/*.md', { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;
const aiFiles = import.meta.glob('../../../../docs/ai-use/*.md', { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;

async function loadAll<E>(
  files: Record<string, () => Promise<string>>, parse: (path: string, md: string) => DocFile<E>,
): Promise<DocFile<E>[]> {
  const list = await Promise.all(
    Object.entries(files).map(async ([key, load]) => parse(repoPath(key), await load())),
  );
  return byTask(list);
}

// --- Small DOM helpers ------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.append(...kids);
  return el;
}

function link(text: string, href: string): HTMLAnchorElement {
  const a = h('a', undefined, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** A collected cell: text, with its links as links. Never innerHTML. */
function cell(c: Cell): Node[] {
  return c.map((s) => (s.href ? link(s.text, s.href) : document.createTextNode(s.text)));
}

const label = (id: string): string => id.replace(/^issue-(\d+)$/, 'Issue #$1');

// --- The module -------------------------------------------------------------------------------

export function mount(el: HTMLElement): void {
  // The Darksight mark beside the name, as in docs/design/desktop.png (T22).
  const brand = h('strong', 'about-brand', logo('about-logo'), 'Darksight');

  const badge = h('span', 'badge about-badge', 'Horizons check: loading');
  const button = h('button', 'btn about-open', 'About');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  const right = h('div', 'about-right', badge, button);

  const dialog = buildDialog();
  el.replaceChildren(brand, right, dialog.el);

  const showCheck = (c: HorizonsCheck): void => {
    badge.textContent = badgeText(c);
    badge.title = badgeSentence(c);
    badge.setAttribute('aria-label', badgeSentence(c));
    badge.dataset.state = c.state;
    dialog.setCheck(c);
  };
  void fetch(import.meta.env.BASE_URL + 'data/validation.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json: unknown) => showCheck(readValidation(json)))
    .catch((err: unknown) => showCheck({ state: 'unavailable', reason: String((err as Error).message ?? err) }));

  button.addEventListener('click', () => dialog.open());
  // Back to the button that opened it, however it was closed.
  dialog.el.addEventListener('close', () => button.focus());

  const renderData = (): void => dialog.setData();
  subscribe(renderData);
  renderData();
}

type Panel = {
  el: HTMLDialogElement;
  open(): void;
  setCheck(c: HorizonsCheck): void;
  setData(): void;
};

function buildDialog(): Panel {
  const dialog = h('dialog', 'about-dialog card');
  dialog.setAttribute('aria-labelledby', 'about-title');
  const body = h('div', 'about-body');
  dialog.append(body);

  const close = h('button', 'btn about-close', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  const head = h('div', 'about-head', h('h2', 'about-title', 'About Darksight'), close);
  head.querySelector('h2')!.id = 'about-title';

  const checkP = h('p', undefined, 'Loading the Horizons check…');
  const dataP = h('p', 'muted', 'Loading');
  const sourcesBox = h('div', 'about-list', h('p', 'muted', 'Loading sources…'));
  const aiBox = h('div', 'about-list', h('p', 'muted', 'Loading the AI-use notes…'));

  body.append(
    head,
    section('What it shows', ...WHAT_IT_SHOWS.map((t) => h('p', undefined, t))),
    section('Why the Moon is different', h('p', undefined, EXPLAIN_INTRO), h('ul', 'about-explain',
      ...EXPLAIN.map((p) => h('li', undefined, h('strong', undefined, p.lead), ` ${p.text} `,
        jumpButton(dialog, p))))),
    section('Checked against JPL Horizons', checkP, dataP),
    section('Known limits', h('ul', undefined, ...KNOWN_LIMITS.map((t) => h('li', undefined, t)))),
    section('Why there is no refraction', h('p', undefined, NO_REFRACTION)),
    section('Libration and the Moon\'s orbit', ...LIBRATION.map((t) => h('p', undefined, t))),
    section('Data sources', sourcesBox),
    section('How AI was used', h('p', undefined, AI_INTRO), aiBox),
  );

  // A click on the backdrop lands on the <dialog> itself (the body fills its inside). Both the
  // press and the release must be outside, so selecting text and letting go outside keeps it open.
  let downOutside = false;
  dialog.addEventListener('pointerdown', (e) => { downOutside = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (downOutside && e.target === dialog) dialog.close();
    downOutside = false;
  });

  let loaded = false;
  const loadLists = (): void => {
    if (loaded) return;
    loaded = true;
    loadAll(sourceFiles, parseSources).then((files) => sourcesBox.replaceChildren(...sourcesList(files)))
      .catch(() => { loaded = false; sourcesBox.replaceChildren(h('p', 'muted', 'The sources could not be loaded.')); });
    loadAll(aiFiles, parseAiUse).then((files) => aiBox.replaceChildren(...aiList(files)))
      .catch(() => { loaded = false; aiBox.replaceChildren(h('p', 'muted', 'The AI-use notes could not be loaded.')); });
  };

  return {
    el: dialog,
    open() {
      if (!dialog.open) dialog.showModal();
      loadLists();
    },
    setCheck(c) {
      if (c.state === 'real') {
        const passed = !(c.maxDiffDeg > c.toleranceDeg);
        // The figure in validation.json is the data pipeline's (contract section 2: `ours` is the
        // Python calculation). The page's own code is held to PAGE_VS_HORIZONS_DEG on the same
        // cases by core/horizons.test.ts: keep the two in step.
        checkP.textContent = `${badgeSentence(c)} That is our data pipeline (Skyfield with JPL's DE440 ` +
          `file) compared with NASA JPL's Horizons system for ${c.cases} cases (Sun and Earth, several ` +
          `sites and times), ` +
          `${Number.isFinite(c.toleranceDeg) ? `against a tolerance of ${formatDeg(c.toleranceDeg)} degrees` : ''}` +
          `${passed ? '' : ' — over the tolerance'}. Checked ${c.checkedAt.replace('T', ' ').replace(/:\d\dZ$/, ' UTC')}. ` +
          'The code in this page matches Horizons on the same cases to within 0.001 degrees, and a ' +
          'test checks that on every change.';
      } else {
        checkP.textContent = badgeSentence(c);
      }
    },
    setData() {
      const s = getState();
      dataP.textContent = s.eph
        ? `Sun and Earth table: ${s.eph.meta.source}. Height map: ${s.dem ? s.dem.meta.source : 'loading'}. ` +
          `${s.sites.length} curated sites.`
        : 'Loading';
    },
  };
}

/**
 * A link-like button that closes the panel and brings a part of the page into view: the first of
 * `targets` that is on screen (the map layers are hidden in 3D, so the map itself stands in).
 * The panel's own close handler puts focus back on the About button first; this then scrolls and
 * moves focus to the point's own control there, or else the first one, if there is one.
 */
function jumpButton(dialog: HTMLDialogElement, p: ExplainPoint): HTMLButtonElement {
  const b = h('button', 'about-jump', p.jump);
  b.type = 'button';
  b.addEventListener('click', () => {
    const target = p.targets
      .map((t) => document.querySelector<HTMLElement>(t))
      .find((el): el is HTMLElement => !!el && el.getClientRects().length > 0);
    if (target) {
      dialog.addEventListener('close', () => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        const control = (p.focus ? target.querySelector<HTMLElement>(p.focus) : null) ??
          target.querySelector<HTMLElement>('button, input, select, a[href]');
        control?.focus({ preventScroll: true });
      }, { once: true });
    }
    dialog.close();
  });
  return b;
}

function section(title: string, ...kids: Node[]): HTMLElement {
  return h('section', 'about-section', h('h3', undefined, title), ...kids);
}

function sourcesList(files: DocFile<SourceEntry>[]): Node[] {
  const withEntries = files.filter((f) => f.entries.length > 0);
  const empty = files.filter((f) => f.entries.length === 0).map((f) => label(f.id));
  const count = withEntries.reduce((n, f) => n + f.entries.length, 0);
  const out: Node[] = [
    h('p', undefined, `${count} sources from ${withEntries.length} task notes. Each task lists every ` +
      'dataset, paper, library and page it used; the full notes are on ', link('GitHub', `${REPO_URL}/tree/main/docs/sources`), '.'),
  ];
  for (const f of withEntries) {
    const items = f.entries.map((e) => {
      const li = h('li', e.note ? 'about-note' : undefined, h('span', 'about-what', ...cell(e.what)));
      if (e.usedFor.length) li.append(h('span', 'muted', ' — ', ...cell(e.usedFor)));
      if (!e.note) {
        li.append(' ', e.link.length ? h('span', 'about-link', ...cell(e.link)) : h('span', 'muted', '(no link given)'));
      }
      if (e.licence.length) li.append(h('span', 'muted', ' · ', ...cell(e.licence)));
      return li;
    });
    out.push(details(`${label(f.id)} · ${f.entries.length}`, f.url, h('ul', undefined, ...items)));
  }
  if (empty.length) out.push(h('p', 'muted', `No sources recorded yet: ${empty.join(', ')}.`));
  return out;
}

function aiList(files: DocFile<AiEntry>[]): Node[] {
  const withEntries = files.filter((f) => f.entries.length > 0);
  const empty = files.filter((f) => f.entries.length === 0).map((f) => label(f.id));
  const rows = withEntries.reduce((n, f) => n + f.entries.length, 0);
  const out: Node[] = [
    h('p', undefined, `${rows} records from ${withEntries.length} task notes. Tools named: ` +
      `${toolsNamed(withEntries).join('; ')}.`),
  ];
  for (const f of withEntries) {
    const items = f.entries.map((e) => h('li', undefined,
      h('span', 'about-what', [e.when, e.who, e.tool].filter(Boolean).join(' · ')),
      h('div', undefined, ...cell(e.did)),
      ...(e.checked.length ? [h('div', 'muted', 'Checked: ', ...cell(e.checked))] : []),
    ));
    out.push(details(`${label(f.id)} · ${f.entries.length}`, f.url, h('ul', 'about-ai', ...items)));
  }
  if (empty.length) out.push(h('p', 'muted', `No AI use recorded yet: ${empty.join(', ')}.`));
  return out;
}

function details(summary: string, url: string, content: Node): HTMLDetailsElement {
  return h('details', 'about-details', h('summary', undefined, summary), content,
    h('p', 'muted', link('Full notes on GitHub', url)));
}
