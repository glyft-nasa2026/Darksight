import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// base './' makes every asset address relative, so the same build works on GitHub Pages under
// any repo name and on the mirror. Data files are loaded with import.meta.env.BASE_URL.
export default defineConfig({
  base: './',
  server: {
    // The dev server may read web/ (as before) and docs/, whose sources and AI-use notes the
    // About panel (T16) collects. Production builds read them from disk and need no setting.
    fs: { allow: ['.', '../docs'] },
  },
  build: {
    // Plotly alone is about 4.5 MB; the default 500 kB warning would fire on every build.
    chunkSizeWarningLimit: 6000,
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
