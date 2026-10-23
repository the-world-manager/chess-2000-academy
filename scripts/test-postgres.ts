import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { postgresStorage } from "../server/storage.js";

const root = mkdtempSync(join(tmpdir(), "academy-postgres-"));
const reservation = createServer();
await new Promise<void>((resolve) =>
  reservation.listen(0, "127.0.0.1", resolve),
);
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const password = randomBytes(24).toString("hex");
const pg = new EmbeddedPostgres({
  databaseDir: join(root, "db"),
  port,
  user: "academy_test",
  password,
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--locale=C", "--encoding=UTF8"],
  postgresFlags: ["-h", "127.0.0.1", "-k", root],
  onLog: () => {},
  onError: () => {},
});
const run = (args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<number>((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env });
    const terminate = () => child.kill("SIGTERM");
    process.once("SIGTERM", terminate);
    process.once("SIGINT", terminate);
    child.on("exit", (code) => {
      process.removeListener("SIGTERM", terminate);
      process.removeListener("SIGINT", terminate);
      resolve(code ?? 1);
    });
    child.on("error", () => resolve(1));
  });
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("academy");
  const url = `postgresql://academy_test:${password}@127.0.0.1:${port}/academy`;
  console.log(
    "Тестовая PostgreSQL запущена локально. Платные ресурсы не используются.",
  );
  const env = {
    ...process.env,
    TEST_DATABASE_URL: url,
    TEST_BACKEND: "postgres",
  };
  let status = await run(
    [
      "--import",
      "tsx",
      "--test",
      "tests/api.test.ts",
      "tests/security.test.ts",
      "tests/postgres/*.test.ts",
    ],
    env,
  );
  if (status === 0) {
    const admin = postgresStorage(url, true);
    try {
      await admin.query("CREATE SCHEMA browser_tests");
    } finally {
      await admin.close();
    }
    const browserUrl = new URL(url);
    browserUrl.searchParams.set("options", "-c search_path=browser_tests");
    status = await run(["node_modules/@playwright/test/cli.js", "test"], {
      ...env,
      E2E_DATABASE_URL: browserUrl.toString(),
    });
  }
  process.exitCode = status;
} catch {
  console.error(
    "Не удалось выполнить проверки локальной PostgreSQL. Облачные базы не создавались.",
  );
  process.exitCode = 1;
} finally {
  await pg.stop().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
