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
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
