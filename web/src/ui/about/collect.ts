// Collects docs/sources/*.md and docs/ai-use/*.md for the About panel (T16). Pure functions, no
// DOM: index.ts loads the files and draws the result, about.test.ts checks it against the real
// files. Nothing is dropped silently:
// - every row of a source or AI-use table is kept, including rows without a link and blocks of
//   rows that carry on after a blank line without repeating the header (docs/ai-use/T19.md);
// - every link anywhere in a sources file (other tables, bullet lists, prose) is kept too, as a
//   "note" entry, so the panel shows every link the file has;
// - links relative to the repo become GitHub links, so they open from the site.
// Other tables in an AI-use file (design choices, limits, results) are not AI-use rows; the panel
// links to the full file for those.

export const REPO_URL = 'https://github.com/glyft-nasa2026/Darksight';
const BLOB = `${REPO_URL}/blob/main/`;

/** A run of text, or a link. */
export type Seg = { text: string; href?: string };
export type Cell = Seg[];

export type SourceEntry = {
  what: Cell;
  usedFor: Cell;
  link: Cell;
  licence: Cell;
  /** From a bullet, a prose line or another table, not a source table row. */
  note: boolean;
};

export type AiEntry = { when: string; who: string; tool: string; did: Cell; checked: Cell };

export type DocFile<E> = {
  id: string;        // file name without .md: "T07", "issue-58"
  path: string;      // repo path: "docs/sources/T07.md"
  url: string;       // the file on GitHub
  entries: E[];
};

// --- Markdown pieces ------------------------------------------------------------------------

/** Splits one table row on |, but not on \| or a | inside `code`. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** The |---|---| line under a header: every cell is dashes, with optional colons. */
const isSeparator = (line: string): boolean => {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
};

/** Resolves a link written in a file under docs/<dir>/ to an address that opens from the site. */
export function resolveHref(href: string, fileDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;           // https:, mailto: ...
  if (href.startsWith('#')) return href;
  const [pathPart, frag] = href.split('#', 2);
  const parts = (pathPart.startsWith('/') ? pathPart.slice(1) : `${fileDir}/${pathPart}`).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  return BLOB + out.join('/') + (frag ? `#${frag}` : '');
}

const clean = (t: string): string => t.replace(/\*\*|__/g, '').replace(/`/g, '');

/**
 * Text with links: [label](url), <url> and bare https:// addresses. Trailing punctuation after a
 * bare address is not part of it.
 */
export function segments(text: string, fileDir: string): Cell {
  const re = /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s|<>()\]]+(?:\([^\s)]*\))?)/g;
  const out: Seg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string): void => { const c = clean(t); if (c) out.push({ text: c }); };
  while ((m = re.exec(text))) {
    let raw = m[0];
    let label: string;
    let href: string;
    if (m[1] !== undefined) { label = clean(m[1]); href = m[2]; }
    else if (m[3] !== undefined) { label = m[3]; href = m[3]; }
    else {
      href = m[4];
      const trail = /[.,;:!?'"]+$/.exec(href);
      if (trail) { href = href.slice(0, -trail[0].length); raw = raw.slice(0, -trail[0].length); }
      label = href;
    }
    pushText(text.slice(last, m.index));
    out.push({ text: label, href: resolveHref(href, fileDir) });
    last = m.index + raw.length;
    re.lastIndex = last;
  }
  pushText(text.slice(last));
  return out;
}

/** Every link address in a piece of Markdown, resolved the same way. */
export function linksIn(text: string, fileDir: string): string[] {
  return segments(text, fileDir).filter((s) => s.href).map((s) => s.href as string);
}

type Block = { header: string[] | null; rows: string[][]; lines: string[] };

/** Groups the file into tables (runs of | lines) and other lines. */
function scan(md: string): { blocks: Block[]; prose: string[] } {
  const blocks: Block[] = [];
  const prose: string[] = [];
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; ) {
    if (lines[i].trim().startsWith('|')) {
      const run: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) run.push(lines[i++]);
      const hasHeader = run.length >= 2 && isSeparator(run[1]);
      blocks.push({
        header: hasHeader ? splitRow(run[0]) : null,
        rows: (hasHeader ? run.slice(2) : run).filter((l) => !isSeparator(l)).map(splitRow),
        lines: run,
      });
    } else {
      prose.push(lines[i++]);
    }
  }
  return { blocks, prose };
}

const findCol = (header: string[], re: RegExp): number => header.findIndex((h) => re.test(clean(h).trim()));
const fileId = (path: string): string => path.split('/').pop()!.replace(/\.md$/, '');
const hasContent = (row: string[]): boolean => row.some((c) => c.trim() !== '');

// --- Sources --------------------------------------------------------------------------------

/** One docs/sources/*.md file. `path` is the repo path, e.g. "docs/sources/T07.md". */
export function parseSources(path: string, md: string): DocFile<SourceEntry> {
  const dir = path.split('/').slice(0, -1).join('/');
  const entries: SourceEntry[] = [];
  const { blocks, prose } = scan(md);
  let header: string[] | null = null;   // the last source-table header, for header-less blocks

  for (const b of blocks) {
    const h: string[] | null = b.header ?? (header && b.rows[0]?.length === header.length ? header : null);
    const what = h ? findCol(h, /^(what|source)$/i) : -1;
    if (h && what >= 0) {
      header = h;
      const usedFor = findCol(h, /^(used for|use)$/i);
      const link = findCol(h, /^links?$/i);
      const licence = findCol(h, /licen[cs]e|terms/i);
      for (const row of b.rows.filter(hasContent)) {
        const cell = (i: number): Cell => (i >= 0 && row[i] !== undefined ? segments(row[i], dir) : []);
        // Columns the header doesn't name (a different layout) go into "used for", not lost.
        const named = new Set([what, usedFor, link, licence]);
        const rest = row.filter((_, i) => !named.has(i) && row[i].trim() !== '').join(' · ');
        const used = cell(usedFor);
        entries.push({
          what: cell(what),
          usedFor: rest ? [...used, ...(used.length ? [{ text: ' · ' }] : []), ...segments(rest, dir)] : used,
          link: cell(link),
          licence: cell(licence),
          note: false,
        });
      }
    } else {
      // Another table: keep any row that has a link, as a note.
      for (const row of b.rows.filter(hasContent)) {
        const line = row.filter((c) => c.trim() !== '').join(' · ');
        if (linksIn(line, dir).length) entries.push(note(line, dir));
      }
    }
  }
  // Bullets and prose with a link (docs/sources/issue-58.md is a list, not a table).
  for (const line of prose) {
    const t = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim();
    if (t && !t.startsWith('#') && linksIn(t, dir).length) entries.push(note(t, dir));
  }
  return { id: fileId(path), path, url: BLOB + path, entries };
}

function note(line: string, dir: string): SourceEntry {
  return { what: segments(line, dir), usedFor: [], link: [], licence: [], note: true };
}

// --- AI use ---------------------------------------------------------------------------------

/** One docs/ai-use/*.md file. AI-use rows are the rows of tables with a "Tool" column. */
export function parseAiUse(path: string, md: string): DocFile<AiEntry> {
  const dir = path.split('/').slice(0, -1).join('/');
  const entries: AiEntry[] = [];
  let header: string[] | null = null;

  for (const b of scan(md).blocks) {
    // A header-less block carries on the last AI-use table when it has the same number of cells.
    const h: string[] | null = b.header ?? (header && b.rows[0]?.length === header.length ? header : null);
    if (!h || findCol(h, /^tool$/i) < 0) continue;
    header = h;
    const col = {
      when: findCol(h, /^when$/i),
      who: findCol(h, /^who$/i),
      tool: findCol(h, /^tool$/i),
      did: findCol(h, /what the ai did|what it generated|^what$/i),
      checked: findCol(h, /checked|human check/i),
    };
    for (const row of b.rows.filter(hasContent)) {
      const text = (i: number): string => (i >= 0 && row[i] !== undefined ? clean(row[i]) : '');
      const cell = (i: number): Cell => (i >= 0 && row[i] !== undefined ? segments(row[i], dir) : []);
      entries.push({
        when: text(col.when), who: text(col.who), tool: text(col.tool),
        did: cell(col.did), checked: cell(col.checked),
      });
    }
  }
  return { id: fileId(path), path, url: BLOB + path, entries };
}

// --- Order and summary ----------------------------------------------------------------------

/** Task files first in number order (T00, T01 ... T31), then the others by name. */
export function byTask<E>(files: DocFile<E>[]): DocFile<E>[] {
  const key = (id: string): [number, string] => {
    const m = /^T(\d+)$/.exec(id);
    return m ? [Number(m[1]), ''] : [Infinity, id];
  };
  return [...files].sort((a, b) => {
    const [na, sa] = key(a.id);
    const [nb, sb] = key(b.id);
    return na - nb || sa.localeCompare(sb);
  });
}

/** Distinct tool names across the AI-use rows, most used first. */
export function toolsNamed(files: DocFile<AiEntry>[]): string[] {
  const n = new Map<string, number>();
  for (const f of files) for (const e of f.entries) if (e.tool) n.set(e.tool, (n.get(e.tool) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Every link address a collected sources file shows, for the coverage test. */
export function collectedLinks(f: DocFile<SourceEntry>): Set<string> {
  const out = new Set<string>();
  for (const e of f.entries) {
    for (const c of [e.what, e.usedFor, e.link, e.licence]) for (const s of c) if (s.href) out.add(s.href);
  }
  return out;
}

/** "docs/sources/T07.md" from a Vite glob key like "../../../../docs/sources/T07.md". */
export const repoPath = (globKey: string): string => globKey.replace(/^(\.\.?\/)+/, '');
