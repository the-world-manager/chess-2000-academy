import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { resolve } from "node:path";
export default defineConfig({
  ...base,
  testMatch: "**/live/*.spec.ts",
  testIgnore: [],
  timeout: 90000,
  webServer: {
    ...(base.webServer as any),
    env: {
      ...(base.webServer as any).env,
      LIVE_CHESS_REPORT: resolve(".verification/real-chesscom.json"),
    },
  },
});
