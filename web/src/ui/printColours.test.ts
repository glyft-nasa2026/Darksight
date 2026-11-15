// T35: theme.css gives the colour names light values for paper twice, under @media print and on
// :root.print-colours (for the report's chart picture). The two must stay the same.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

function values(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe('print colours', () => {
  const print = css.match(/@media print\s*\{\s*:root\s*\{([^}]*)\}/);
  const cls = css.match(/:root\.print-colours\s*\{([^}]*)\}/);

  it('are in both blocks, with the same values', () => {
    expect(print).not.toBeNull();
    expect(cls).not.toBeNull();
    expect(values(cls![1])).toEqual(values(print![1]));
    expect(Object.keys(values(print![1])).length).toBeGreaterThan(8);
  });

  it('only use names the screen theme already has', () => {
    const screen = values(css.match(/:root\s*\{([^}]*)\}/)![1]);
    for (const name of Object.keys(values(print![1]))) expect(screen).toHaveProperty(name);
  });
});
