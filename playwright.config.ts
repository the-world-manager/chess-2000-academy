import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  timeout: 45000,
  testDir: "tests",
  testMatch: "*.spec.ts",
  testIgnore: "**/live/**",
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
    command: `DATABASE_PATH=/tmp/chess-academy-e2e-${process.pid}.sqlite PORT=3100 node --import tsx tests/helpers/e2e-server.ts`,
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: process.env.E2E_DATABASE_URL
      ? {
          DATABASE_URL: process.env.E2E_DATABASE_URL,
          PG_TEST_ALLOW_INSECURE_LOCAL: "true",
          OWNER_LOGIN: "",
          OWNER_PASSWORD: "",
        }
      : {
          DATABASE_URL: "",
          ALLOW_LOCAL_SQLITE: "true",
          OWNER_LOGIN: "",
          OWNER_PASSWORD: "",
        },
  },
  projects: [
    { name: "компьютер", use: { ...devices["Desktop Chrome"] } },
    {
      name: "телефон",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
