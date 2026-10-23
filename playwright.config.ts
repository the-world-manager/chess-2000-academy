import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
  },
  webServer: {
    command: `DATABASE_PATH=/tmp/chess-academy-e2e-${process.pid}.sqlite PORT=3100 npm run start`,
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
  },
  projects: [
    { name: "компьютер", use: { ...devices["Desktop Chrome"] } },
    {
      name: "телефон",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
