// T16: the Horizons badge and the collection of docs/sources and docs/ai-use for the About
// panel. The dialog itself (open, close, Escape, outside click, focus) is checked in a browser:
// the tests run in node, with no DOM.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  byTask, collectedLinks, linksIn, parseAiUse, parseSources, repoPath, resolveHref, segments,
  splitRow, toolsNamed, REPO_URL,
} from './collect';
import { badgeSentence, badgeText, formatDeg, readValidation } from './validation';

const repo = (rel: string): string => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const docs = (dir: 'sources' | 'ai-use'): { path: string; md: string }[] =>
  readdirSync(repo(`docs/${dir}`)).filter((f) => f.endsWith('.md')).sort()
    .map((f) => ({ path: `docs/${dir}/${f}`, md: readFileSync(repo(`docs/${dir}/${f}`), 'utf8') }));

describe('Horizons badge', () => {
  const file = JSON.parse(readFileSync(repo('web/public/data/validation.json'), 'utf8'));

  it('real data: shows the number in validation.json, written out in full', () => {
    const c = readValidation(file);
    if (file.checked_at === null) return; // the file is T20's mock: the pending test covers it
    expect(c.state).toBe('real');
    const text = badgeText(c);
    console.log(`badge on the real file: "${text}" (max_diff_deg in the file: ${file.max_diff_deg})`);
    const shown = /· ([0-9.]+)°$/.exec(text)?.[1];
    expect(shown).toBeDefined();
    expect(Number(shown)).toBe(file.max_diff_deg);
    expect(text).not.toMatch(/e-/);
    expect(badgeSentence(c)).toBe(
      `Checked against JPL Horizons: largest difference ${shown} degrees.`,
    );
  });

  it('pending: mock data (checked_at null) says so', () => {
    const mock = { checked_at: null, tolerance_deg: 0.1, max_diff_deg: 0.0, cases: [] };
    expect(readValidation(mock)).toEqual({ state: 'pending' });
    expect(badgeText(readValidation(mock))).toBe('Horizons check pending');
  });

  it('unavailable: a missing, broken or incomplete file never crashes', () => {
    for (const bad of [null, undefined, 'text', 42, {}, { checked_at: 5 },
      { checked_at: '2026-11-14T00:00:00Z' }, { checked_at: '2026-11-14T00:00:00Z', max_diff_deg: 'x' },
      { checked_at: '2026-11-14T00:00:00Z', max_diff_deg: -1 }]) {
      const c = readValidation(bad);
      expect(c.state, JSON.stringify(bad)).toBe('unavailable');
      expect(badgeText(c)).toBe('Horizons check unavailable');
    }
  });

  it('writes small and plain numbers without an exponent', () => {
    expect(formatDeg(1e-6)).toBe('0.000001');
    expect(formatDeg(0.004)).toBe('0.004');
    expect(formatDeg(0)).toBe('0');
    expect(formatDeg(0.123456)).toBe('0.123456');
    for (const x of [1e-6, 2.5e-5, 0.000123, 0.0999]) expect(Number(formatDeg(x))).toBe(x);
  });
});

describe('Markdown pieces', () => {
  it('splits a row, keeping | inside code and \\|', () => {
    expect(splitRow('| a | `x | y` | b \\| c |')).toEqual(['a', '`x | y`', 'b | c']);
    expect(splitRow('| | Altitude | Azimuth |')).toEqual(['', 'Altitude', 'Azimuth']);
  });

  it('turns links relative to the repo into GitHub links', () => {
    expect(resolveHref('../data-contract.md', 'docs/sources')).toBe(`${REPO_URL}/blob/main/docs/data-contract.md`);
    expect(resolveHref('../../tasks/T12-scene.md#goal', 'docs/sources'))
      .toBe(`${REPO_URL}/blob/main/tasks/T12-scene.md#goal`);
    expect(resolveHref('https://example.org/a', 'docs/sources')).toBe('https://example.org/a');
  });

  it('finds Markdown links, <links> and bare addresses, without trailing punctuation', () => {
    const s = segments('See [the map](https://a.org/x), <https://b.org/y> and https://c.org/z.', 'docs/sources');
    expect(s.filter((x) => x.href).map((x) => [x.text, x.href])).toEqual([
      ['the map', 'https://a.org/x'], ['https://b.org/y', 'https://b.org/y'], ['https://c.org/z', 'https://c.org/z'],
    ]);
    expect(s.map((x) => x.text).join('')).toBe('See the map, https://b.org/y and https://c.org/z.');
    expect(linksIn('https://en.wikipedia.org/wiki/Shioli_(crater)', 'docs/sources'))
      .toEqual(['https://en.wikipedia.org/wiki/Shioli_(crater)']);
  });

  it('keeps a source row with no link, and a header-less block that carries on a table', () => {
    const md = [
      '| What | Used for | Link | Licence or terms |', '|---|---|---|---|',
      '| Our own contract | Formulas | (this repository) | Project file |',
      '', '| A paper | Check | https://doi.org/10.1/x | Journal |',
    ].join('\n');
    const f = parseSources('docs/sources/TX.md', md);
    expect(f.entries).toHaveLength(2);
    expect(f.entries[0].link.map((s) => s.text).join('')).toBe('(this repository)');
    expect(f.entries[1].link[0].href).toBe('https://doi.org/10.1/x');
  });
});

describe('Collecting docs/sources (every file on disk)', () => {
  const files = docs('sources');

  it('shows every link in every file', () => {
    let total = 0;
    for (const { path, md } of files) {
      const got = collectedLinks(parseSources(path, md));
      const want = new Set(linksIn(md, 'docs/sources'));
      total += want.size;
      for (const href of want) expect(got.has(href), `${path}: ${href}`).toBe(true);
    }
    console.log(`docs/sources: ${files.length} files, ${total} distinct links per file, all collected`);
    expect(total).toBeGreaterThan(50);
  });

  it('shows every web address and relative link, found by a plain search independent of the parser', () => {
    let web = 0, rel = 0;
    for (const { path, md } of files) {
      const got = [...collectedLinks(parseSources(path, md))];
      for (const m of md.matchAll(/https?:\/\/[^\s)|>\]`"]+/g)) {
        const url = m[0].replace(/[.,;:!?']+$/, '');
        web++;
        expect(got.some((h) => h === url || h.startsWith(url)), `${path}: ${url}`).toBe(true);
      }
      for (const m of md.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g)) {
        rel++;
        expect(got, `${path}: ${m[1]}`).toContain(resolveHref(m[1], 'docs/sources'));
      }
    }
    console.log(`plain search: ${web} web addresses and ${rel} relative links in docs/sources, all shown`);
  });

  it('keeps every source-table row, with or without a link', () => {
    // T02 lists 8 sources and only 1 has a web address.
    const t02 = files.find((f) => f.path.endsWith('/T02.md'))!;
    const e = parseSources(t02.path, t02.md).entries.filter((x) => !x.note);
    expect(e).toHaveLength(8);
    expect(e.filter((x) => collectedLinks({ ...parseSources(t02.path, t02.md), entries: [x] }).size === 0).length)
      .toBeGreaterThan(0);
  });

  it('reads the unusual files: a bullet list, other columns and relative links', () => {
    const get = (id: string) => {
      const f = files.find((x) => x.path.endsWith(`/${id}.md`))!;
      return parseSources(f.path, f.md);
    };
    const i58 = get('issue-58');
    expect(i58.entries.length).toBe(2);
    expect(i58.entries.every((x) => x.note)).toBe(true);
    const tc = get('task-coordination');
    expect(tc.entries.filter((x) => !x.note)).toHaveLength(3);
    expect([...collectedLinks(tc)].every((h) => h.startsWith('http'))).toBe(true);
    expect([...collectedLinks(get('T12'))].some((h) => h.startsWith(`${REPO_URL}/blob/main/`))).toBe(true);
  });

  it('collects nothing from an empty template', () => {
    const empty = '# Sources: T99\n\n| What | Used for | Link | Licence or terms |\n|---|---|---|---|\n';
    expect(parseSources('docs/sources/T99.md', empty).entries).toEqual([]);
  });
});

describe('Collecting docs/ai-use (every file on disk)', () => {
  const files = docs('ai-use');

  it('keeps every AI-use row, counted independently of the parser', () => {
    let total = 0;
    for (const { path, md } of files) {
      const lines = md.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
      const header = lines.find((l) => /\|\s*Tool\s*\|/i.test(l));
      if (!header) { expect(parseAiUse(path, md).entries, path).toHaveLength(0); continue; }
      const width = splitRow(header).length;
      // Rows with the AI table's width, minus its header and |---| lines; other tables in these
      // files have three columns, so they don't count.
      const expected = lines.filter((l) => splitRow(l).length === width && l !== header
        && !splitRow(l).every((c) => /^:?-+:?$/.test(c)) && splitRow(l).some((c) => c !== '')).length;
      const got = parseAiUse(path, md).entries.length;
      expect(got, path).toBe(expected);
      total += got;
    }
    console.log(`docs/ai-use: ${files.length} files, ${total} AI-use rows collected`);
    expect(total).toBeGreaterThan(100);
  });

  it('carries a table on after a blank line (T19) and reads other columns (task-coordination)', () => {
    const t19 = files.find((f) => f.path.endsWith('/T19.md'))!;
    // T19's table is split by a blank line and a note, and gains a row with each pass, so the
    // dated rows are counted from the file rather than fixed.
    const lines = t19.md.split(/\r?\n/);
    const dated = (l: string): boolean => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l);
    const blank = lines.findIndex((l, i) => i > lines.findIndex(dated) && l.trim() === '');
    expect(lines.slice(blank).some(dated)).toBe(true);
    expect(parseAiUse(t19.path, t19.md).entries).toHaveLength(lines.filter(dated).length);
    const tc = files.find((f) => f.path.endsWith('/task-coordination.md'))!;
    const e = parseAiUse(tc.path, tc.md).entries;
    expect(e).toHaveLength(1);
    expect(e[0].tool).toMatch(/Codex/);
    expect(e[0].did.length).toBeGreaterThan(0);
    expect(e[0].checked.length).toBeGreaterThan(0);
  });

  it('skips tables that are not AI-use rows (T24 results)', () => {
    const t24 = files.find((f) => f.path.endsWith('/T24.md'))!;
    const e = parseAiUse(t24.path, t24.md).entries;
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.tool !== '' && !/^Check$/.test(x.tool))).toBe(true);
  });

  it('names the tools and orders files by task number', () => {
    const parsed = files.map((f) => parseAiUse(f.path, f.md));
    expect(toolsNamed(parsed).some((t) => /Claude/.test(t))).toBe(true);
    const ids = byTask(parsed).map((f) => f.id);
    expect(ids.indexOf('T02')).toBeLessThan(ids.indexOf('T10'));
    expect(ids.indexOf('T31')).toBeLessThan(ids.indexOf('intro'));
  });

  it('maps a Vite glob key to the repo path', () => {
    expect(repoPath('../../../../docs/ai-use/T07.md')).toBe('docs/ai-use/T07.md');
  });
});
