// The main page's lower sections (issue #117): about, team, privacy, licence and a footer.
// They sit under the first screen; the main page scrolls to them. The words are in landing.ts.
// The footer's section links scroll with buttons, not "#id" links: the page address hash holds
// the site's state (state.ts), and changing it would change the view.
import './more.css';
import { logo } from './logo';
import {
  ABOUT, COPYRIGHT, FOOTER_LINKS, LICENSE, PRIVACY, TEAM, type Link, type Section,
} from './landing';

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function outLink(l: Link, className = ''): HTMLAnchorElement {
  const a = make('a', className, l.label);
  a.href = l.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function scrollTo(id: string): void {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

function jump(label: string, id: string, className = 'landing-jump'): HTMLButtonElement {
  const b = make('button', className, label);
  b.type = 'button';
  b.addEventListener('click', () => scrollTo(id));
  return b;
}

function section(s: Section, extra?: HTMLElement): HTMLElement {
  const el = make('section', 'card landing-section');
  el.id = s.id;
  el.setAttribute('aria-labelledby', `${s.id}-h`);
  const h = make('h2', 'landing-h', s.heading);
  h.id = `${s.id}-h`;
  el.append(h);
  for (const p of s.paragraphs) el.append(make('p', 'landing-p', p));
  if (extra) el.append(extra);
  if (s.links?.length) {
    const list = make('ul', 'landing-links');
    for (const l of s.links) {
      const li = make('li');
      li.append(outLink(l));
      list.append(li);
    }
    el.append(list);
  }
  return el;
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
}

function team(): HTMLElement {
  const el = make('section', 'card landing-section');
  el.id = 'landing-team';
  el.setAttribute('aria-labelledby', 'landing-team-h');
  const h = make('h2', 'landing-h', 'Meet the team');
  h.id = 'landing-team-h';
  const list = make('ul', 'landing-team');
  for (const name of TEAM) {
    const li = make('li', 'landing-member');
    const badge = make('span', 'landing-avatar', initials(name));
    badge.setAttribute('aria-hidden', 'true');
    li.append(badge, make('span', 'landing-name', name));
    list.append(li);
  }
  el.append(h, make('p', 'landing-p', 'Team GLYFT, Kuala Lumpur.'), list);
  return el;
}

function footer(): HTMLElement {
  const el = make('footer', 'landing-footer');
  const brand = make('div', 'landing-brand');
  brand.append(logo('landing-logo'), make('span', 'landing-brand-name', 'Darksight'));
  const nav = make('nav', 'landing-nav');
  nav.setAttribute('aria-label', 'Main page');
  nav.append(
    jump('About', ABOUT.id),
    jump('Team', 'landing-team'),
    jump('Privacy', PRIVACY.id),
    jump('Licence', LICENSE.id),
    ...FOOTER_LINKS.map((l) => outLink(l, 'landing-jump')),
  );
  el.append(brand, nav, make('p', 'landing-copy muted', COPYRIGHT));
  return el;
}

/** The "more below" button for the first screen. */
export function moreButton(): HTMLButtonElement {
  const b = jump('More about Darksight', ABOUT.id, 'landing-more');
  const arrow = make('span', 'landing-more-arrow', '↓');
  arrow.setAttribute('aria-hidden', 'true');
  b.append(' ', arrow);
  return b;
}

/** Everything under the first screen. */
export function moreSections(): HTMLElement {
  const el = make('div', 'landing');
  const grid = make('div', 'landing-grid');
  grid.append(section(ABOUT), team(), section(PRIVACY), section(LICENSE));
  el.append(grid, footer());
  return el;
}
