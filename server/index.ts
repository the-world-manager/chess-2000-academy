import { resolve } from "node:path";
import express from "express";
import { createApplication } from "./app.js";
import { postgresStorage } from "./storage.js";

const port = Number(process.env.PORT || 3000);
const render = process.env.RENDER === "true";
const host = process.env.HOST || (render ? "0.0.0.0" : "127.0.0.1");
const production = process.env.NODE_ENV === "production";
if (
  (render || production) &&
  !process.env.DATABASE_URL &&
  !(
    process.env.ALLOW_LOCAL_SQLITE === "true" &&
    !render &&
    host === "127.0.0.1"
  )
) {
  console.error(
    "Для публикации требуется DATABASE_URL PostgreSQL. На Render файловая SQLite не используется.",
  );
  process.exit(1);
}
let application: Awaited<ReturnType<typeof createApplication>>;
try {
  const database = process.env.DATABASE_URL
    ? postgresStorage(
        process.env.DATABASE_URL,
        process.env.PG_TEST_ALLOW_INSECURE_LOCAL === "true" && !render,
      )
    : resolve(process.env.DATABASE_PATH || "data/academy.sqlite");
  application = await createApplication(database, {
    secureCookies: render || process.env.COOKIE_SECURE === "true",
    publicDeployment: render,
    ownerLogin: process.env.OWNER_LOGIN || undefined,
    ownerPassword: process.env.OWNER_PASSWORD || undefined,
  });
} catch {
  console.error(
    "Не удалось подготовить базу данных. Проверьте DATABASE_URL, доступность PostgreSQL и начальные настройки владельца.",
  );
  process.exit(1);
}
const { app, close } = application;
if (production) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, host, () =>
  console.log(`Шахматная академия запущена, порт ${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close(() => {
      void close().then(() => process.exit(0));
    });
  });
