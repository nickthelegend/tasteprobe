import { defineConfig, devices } from "@playwright/test";

// Real Google Chrome (channel: "chrome") against the real TasteProbe servers from e2e/stack.sh.
// Nothing is mocked or routed: no provider key exists, so every page shows the honest Setup required
// state, and the audit store starts empty. Two targets x two viewports:
//   desktop / mobile                         -> next dev on 127.0.0.1:3101
//   desktop-standalone / mobile-standalone   -> .next/standalone/server.js via the entrypoint, :3102
const DEV = "http://127.0.0.1:3101";
const STANDALONE = "http://127.0.0.1:3102";
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
    { name: "desktop", use: { ...desktop, baseURL: DEV } },
    { name: "mobile", use: { ...mobile, baseURL: DEV } },
    { name: "desktop-standalone", use: { ...desktop, baseURL: STANDALONE } },
    { name: "mobile-standalone", use: { ...mobile, baseURL: STANDALONE } },
  ],
});
