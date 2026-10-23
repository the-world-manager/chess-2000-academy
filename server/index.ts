import { resolve } from "node:path";
import express from "express";
import { createApplication } from "./app.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const { app, close } = createApplication(
  resolve(process.env.DATABASE_PATH || "data/academy.sqlite"),
  process.env.COOKIE_SECURE === "true",
);
if (process.env.NODE_ENV === "production") {
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
      close();
      process.exit(0);
    });
  });
