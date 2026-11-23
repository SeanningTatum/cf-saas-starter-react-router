import { defineConfig, devices } from "@playwright/test";

// Vite auto-bumps to the next free port when 5173 is taken (e.g. another
// project's dev server), which silently points e2e at the wrong app. Pin the
// port explicitly and allow overriding via E2E_PORT when 5173 is occupied.
const PORT = process.env.E2E_PORT ?? "5173";
// E2E_VIDEO=1 records every test at a size a PR reviewer can read, slowed so a viewer can follow.
// scripts/e2e-videos.ts sets it and collects the @golden and @error videos.
const VIDEO = !!process.env.E2E_VIDEO;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries, in CI or locally: a test that passes only on a second try is a bug, and a retry
  // would turn it green and hide it (issue #175). The trace keeps the failing run itself.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: VIDEO ? { mode: "on", size: { width: 1280, height: 720 } } : "off",
    launchOptions: { slowMo: VIDEO ? 250 : 0 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `bun run db:migrate:local && react-router dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
