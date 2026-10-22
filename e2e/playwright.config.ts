import { defineConfig, devices } from "@playwright/test";

// Real Google Chrome (channel: "chrome") against the real TasteProbe servers from e2e/stack.sh.
// No provider key exists, so every page shows the honest Setup required state. Nothing is mocked:
// one public-demo test delays the app's own GET /api/audits/<id> (page.route + continue, the real
// server still answers) to check that a slow answer cannot replace a later choice.
//   desktop / mobile                         -> next dev on 127.0.0.1:3101, empty store
//   desktop-standalone / mobile-standalone   -> .next/standalone/server.js via the entrypoint, :3102, empty store
//   public-desktop / public-mobile           -> the standalone build as a public demo on :3103: run
//                                               token, 24-persona cap, featured audit, store seeded
//                                               from the SYNTHETIC fixture (e2e/seed.mjs)
const port = (name: string, fallback: number) => process.env[`TASTEPROBE_E2E_PORT_${name}`] || String(fallback);
export const DEV = `http://127.0.0.1:${port("DEV", 3101)}`;
export const STANDALONE = `http://127.0.0.1:${port("STANDALONE", 3102)}`;
export const PUBLIC = `http://127.0.0.1:${port("PUBLIC", 3103)}`;
const desktop = { viewport: { width: 1280, height: 800 } };
const mobile = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent };

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["json", { outputFile: "test-results.json" }]],
  use: { channel: "chrome", headless: true, video: "on", trace: "on", screenshot: "on" },
  projects: [
    { name: "desktop", testIgnore: /public\.spec/, use: { ...desktop, baseURL: DEV } },
    { name: "mobile", testIgnore: /public\.spec/, use: { ...mobile, baseURL: DEV } },
    { name: "desktop-standalone", testIgnore: /public\.spec/, use: { ...desktop, baseURL: STANDALONE } },
    { name: "mobile-standalone", testIgnore: /public\.spec/, use: { ...mobile, baseURL: STANDALONE } },
    { name: "public-desktop", testMatch: /public\.spec/, use: { ...desktop, baseURL: PUBLIC } },
    { name: "public-mobile", testMatch: /public\.spec/, use: { ...mobile, baseURL: PUBLIC } },
  ],
});
