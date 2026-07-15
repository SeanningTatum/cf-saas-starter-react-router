import { defineConfig, devices } from "@playwright/test";

// Vite auto-bumps to the next free port when 5173 is taken (e.g. another
// project's dev server), which silently points e2e at the wrong app. Pin the
// port explicitly and allow overriding via E2E_PORT when 5173 is occupied.
const PORT = process.env.E2E_PORT ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
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
