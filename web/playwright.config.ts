import { defineConfig, devices } from '@playwright/test';

// T30: one smoke test of the built page (`npm run build` first), served by `vite preview`, in
// headless Chromium only. `npm test` stays vitest, with no browser (vite.config.ts includes
// src/ only).
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: { baseURL: `http://localhost:${PORT}/` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
