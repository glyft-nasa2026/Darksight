import { fileURLToPath } from 'node:url';
import type { IndexHtmlTransformContext, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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

// base './' makes every asset address relative, so the same build works on GitHub Pages under
// any repo name and on the mirror. Data files are loaded with import.meta.env.BASE_URL.
export default defineConfig({
  base: './',
  plugins: [siteCodeList()],
  server: {
    // The dev server may read web/ (as before) and docs/, whose sources and AI-use notes the
    // About panel (T16) collects. Production builds read them from disk and need no setting.
    fs: { allow: ['.', '../docs'] },
  },
  build: {
    // Plotly's basic build is about 1.2 MB; the default 500 kB warning would fire on every build.
    chunkSizeWarningLimit: 2000,
    // Three pages: the site, the mission planner that "Open mission" on the landing scenario
    // card opens, and the launch simulation that its "Proceed" opens (T34).
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        mission: fileURLToPath(new URL('./mission.html', import.meta.url)),
        simulation: fileURLToPath(new URL('./simulation.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
