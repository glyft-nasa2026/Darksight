// T39 tests for the "Why the Moon is different" text: short points, and places that still exist.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPLAIN, sentenceCount } from './explain';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('sentenceCount', () => {
  it('counts full stops, ? and ! before a space or the end, not decimal points', () => {
    expect(sentenceCount('About 29.5 days. Two weeks of dark.')).toBe(2);
    expect(sentenceCount('Is it lit? Yes!')).toBe(2);
    expect(sentenceCount('No full stop')).toBe(0);
  });
});

describe('Why the Moon is different (T39)', () => {
  it('has the five points of the ticket', () => {
    expect(EXPLAIN.map((p) => p.lead)).toEqual([
      'A day lasts a month:', 'No air:', 'The Sun stays low at the poles:', 'Earth hardly moves:',
      'Small moves, big changes:',
    ]);
  });

  it('keeps every point to two sentences or fewer, lead included', () => {
    for (const p of EXPLAIN) {
      expect(p.lead.endsWith(':'), p.lead).toBe(true);
      expect(sentenceCount(`${p.lead} ${p.text}`), p.lead).toBeLessThanOrEqual(2);
    }
  });

  it('points only at places that are on the page', () => {
    // The slots are in index.html; #nudge and the layer controls are in the scene's own markup.
    const page = read('../../../index.html') + read('../../scene/index.ts');
    for (const p of EXPLAIN) {
      expect(p.targets.length, p.lead).toBeGreaterThan(0);
      for (const t of p.targets) {
        const found = t.startsWith('#') ? page.includes(`id="${t.slice(1)}"`) : page.includes(`class="${t.slice(1)}"`);
        expect(found, `${p.lead} → ${t}`).toBe(true);
      }
    }
  });

  it('focuses controls that the layers and nudge modules still make', () => {
    expect(EXPLAIN.map((p) => p.focus).filter(Boolean)).toEqual(['#ly-psr', '.nudge-fold']);
    // The layer boxes are `ly-<key>` (ui/layers/index.ts); "Never lit" is the key psr.
    expect(read('../layers/index.ts')).toContain('`ly-${key}`');
    expect(read('../layers/model.ts')).toMatch(/LAYER_KEYS[^\n]*'psr'/);
    expect(read('../nudge/index.ts')).toContain("'btn nudge-fold'");
  });
});
