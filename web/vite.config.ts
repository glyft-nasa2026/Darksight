import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { IndexHtmlTransformContext, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { packHeights, unpackHeights } from './src/core/heightPack.ts';

/**
 * Lists the site's code in index.html as <meta name="site-code" content="file file …">: the
 * chunk of src/site.ts and of Plotly, with the chunks and CSS they need that the page doesn't
 * load by itself. main.ts fetches these without running them while the main page shows, so
 * "Start exploring" doesn't wait for the download, and a deploy that renames them (their names
 * carry a hash of their contents) can't break the click on a page opened before it.
 */
function siteCodeList(): Plugin {
  return {
    name: 'darksight-site-code-list',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html: string, ctx: IndexHtmlTransformContext) {
        const { bundle, chunk: page } = ctx;
        if (!bundle || !page || !ctx.filename.endsWith('index.html')) return;
        // Every file a chunk needs: itself, its CSS, and the chunks it imports, and theirs.
        const needs = (start: string): Set<string> => {
          const out = new Set<string>();
          const visit = (name: string): void => {
            const c = bundle[name];
            if (!c || c.type !== 'chunk' || out.has(name)) return;
            out.add(name);
            for (const css of c.viteMetadata?.importedCss ?? []) out.add(css);
            c.imports.forEach(visit);
          };
          visit(start);
          return out;
        };
        const loaded = needs(page.fileName);
        const roots = Object.values(bundle).filter((c) => c.type === 'chunk' &&
          /\/src\/site\.ts$|\/plotly\.js-basic-dist-min\//.test(c.facadeModuleId ?? ''));
        const files = new Set<string>();
        for (const root of roots) for (const f of needs(root.fileName)) if (!loaded.has(f)) files.add(f);
        return [{ tag: 'meta', attrs: { name: 'site-code', content: [...files].join(' ') }, injectTo: 'head' }];
      },
    },
  };
}

/** The height grids the build packs: the file name and its grid size, read from its .json. */
const HEIGHT_GRIDS: { name: string; grid: (meta: Record<string, unknown>) => unknown[] }[] = [
  { name: 'dem', grid: (m) => [m.size, m.size] },            // the south-pole height map
  { name: 'globe', grid: (m) => [m.width, m.height] },       // the whole Moon
  { name: 'north', grid: (m) => [m.size, m.size] },          // the north cap
];

/**
 * Writes data/dem.pack, data/globe.pack and data/north.pack beside the .bin files in the build:
 * the same heights, packed losslessly (src/core/heightPack.ts) and gzipped, a third to two thirds
 * of the size (contract section 2). The .bin files stay the source files. The dev server has no
 * packed copies, so the site loads the .bin files there.
 */
function packHeightMaps(): Plugin {
  let publicDir = '';
  return {
    name: 'darksight-pack-height-maps',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle() {
      for (const { name, grid } of HEIGHT_GRIDS) {
        const metaFile = join(publicDir, `data/${name}.json`);
        const binFile = join(publicDir, `data/${name}.bin`);
        if (!existsSync(metaFile) || !existsSync(binFile)) continue;   // a data set without this grid
        const [w, h] = grid(JSON.parse(readFileSync(metaFile, 'utf8')) as Record<string, unknown>).map(Number);
        const bin = readFileSync(binFile);
        if (!Number.isInteger(w) || !Number.isInteger(h) || bin.length !== w * h * 2) {
          this.warn(`${name}.bin is ${bin.length} bytes, not ${w} x ${h} heights: no ${name}.pack written`);
          continue;
        }
        const heights = new Int16Array(w * h);
        for (let i = 0; i < heights.length; i++) heights[i] = bin.readInt16LE(i * 2);
        const packed = gzipSync(packHeights(heights, w, h), { level: 9 });
        // Every height must come back exactly before the file ships.
        const back = unpackHeights(gunzipSync(packed), w, h);
        for (let i = 0; i < heights.length; i++) {
          if (back[i] !== heights[i]) this.error(`${name}.pack: cell ${i} unpacks to ${back[i]}, not ${heights[i]}`);
        }
        this.emitFile({ type: 'asset', fileName: `data/${name}.pack`, source: packed });
      }
    },
  };
}

// base './' makes every asset address relative, so the same build works on GitHub Pages under
// any repo name and on the mirror. Data files are loaded with import.meta.env.BASE_URL.
export default defineConfig({
  base: './',
  plugins: [siteCodeList(), packHeightMaps()],
  server: {
    // The dev server may read web/ (as before) and docs/, whose sources and AI-use notes the
    // About panel (T16) collects. Production builds read them from disk and need no setting.
    fs: { allow: ['.', '../docs'] },
  },
  build: {
    // Plotly's basic build is about 1.2 MB; the default 500 kB warning would fire on every build.
    chunkSizeWarningLimit: 2000,
    // Four pages: the site, the mission planner that "Open mission" on the landing scenario
    // card opens, the launch simulation that its "Proceed" opens (T34), and the mission report
    // that its "Generate full launch schedule" opens (T35).
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        mission: fileURLToPath(new URL('./mission.html', import.meta.url)),
        simulation: fileURLToPath(new URL('./simulation.html', import.meta.url)),
        report: fileURLToPath(new URL('./report.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
