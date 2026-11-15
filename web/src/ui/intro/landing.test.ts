import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABOUT, FOOTER_LINKS, LICENSE, PRIVACY, REPO_URL, TEAM } from './landing';

const sections = [ABOUT, PRIVACY, LICENSE];

describe('landing sections', () => {
  it('link only to https addresses', () => {
    const links = [...FOOTER_LINKS, ...sections.flatMap((s) => s.links ?? [])];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.href).toMatch(/^https:\/\//);
  });

  it('link to the repo, which is the one in the About panel', () => {
    const about = readFileSync(new URL('../about/collect.ts', import.meta.url), 'utf8');
    expect(about).toContain(`'${REPO_URL}'`);
    expect(FOOTER_LINKS.map((l) => l.href)).toContain(REPO_URL);
  });

  it('have distinct ids, none of which looks like a page-address setting', () => {
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^landing-[a-z]+$/);
  });

  it('name everyone in the team list of tasks/README.md', () => {
    const board = readFileSync(new URL('../../../../tasks/README.md', import.meta.url), 'utf8');
    const people = board.split('## People')[1].split('##')[0];
    const names = [...people.matchAll(/^\| ([^|]+?) \| [^|]+ \|$/gm)]
      .map((m) => m[1])
      .filter((n) => n !== 'Name' && !n.startsWith('-'));
    expect(TEAM).toEqual(names);
  });

  it('say the licence the LICENSE file has', () => {
    const license = readFileSync(new URL('../../../../LICENSE', import.meta.url), 'utf8');
    expect(license.startsWith('MIT License')).toBe(true);
    expect(LICENSE.paragraphs.join(' ')).toContain('MIT License');
  });
});
