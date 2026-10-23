import express from "express";
import { resolve } from "node:path";
import { createApplication } from "../../server/app.js";
import { postgresStorage } from "../../server/storage.js";
import { fixtureFetch } from "./chess-fixture.js";
import { readFileSync } from "node:fs";
const capture = process.env.LIVE_CHESS_REPORT
  ? JSON.parse(readFileSync(process.env.LIVE_CHESS_REPORT, "utf8"))
  : null;
const remote = capture
  ? async (path: string) =>
      path.endsWith("/stats")
        ? capture.stats
        : path.endsWith("/games/archives")
          ? {
              archives: [
                `https://api.chess.com/pub/player/alexander_gusev/games/${capture.archiveMonth}`,
              ],
            }
          : path.includes("/games/")
            ? { games: [capture.rawGame] }
            : capture.profile
  : fixtureFetch;
// Отдельная точка входа только для тестов. Production server/index.ts не включает подмену API.
const database = process.env.DATABASE_URL
  ? postgresStorage(process.env.DATABASE_URL, true)
  : process.env.DATABASE_PATH!;
const { app, close } = await createApplication(database, {
  chessFetcher: remote,
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(Number(process.env.PORT || 3100), "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    server.close(() => {
      void close().then(() => process.exit(0));
    }),
  );
