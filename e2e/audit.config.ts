import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './audit',
  testMatch: 'surface.spec.ts',
  globalSetup: './global-setup.ts',
  outputDir: './.audit-work/results',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { channel: 'chrome', headless: true },
});
