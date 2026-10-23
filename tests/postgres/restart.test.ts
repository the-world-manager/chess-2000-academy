import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { testPostgres } from "../helpers/postgres.js";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test("PostgreSQL: отдельный production-процесс после перезапуска восстанавливает данные и вход", async () => {
  const marker = `process-${Date.now()}`;
  const store = await testPostgres(marker);
  await store.close();
  // Та же функция вычисления схемы используется для обоих запусков приложения.
  const { createHash } = await import("node:crypto");
  const schema =
    "academy_" + createHash("sha256").update(marker).digest("hex").slice(0, 20);
  const dbUrl = new URL(process.env.TEST_DATABASE_URL!);
  dbUrl.searchParams.set("options", `-c search_path=${schema}`);
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        RENDER: "false",
        PORT: String(port),
        HOST: "127.0.0.1",
        DATABASE_URL: dbUrl.toString(),
        PG_TEST_ALLOW_INSECURE_LOCAL: "true",
        COOKIE_SECURE: "false",
        OWNER_LOGIN: "",
        OWNER_PASSWORD: "",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null)
        throw new Error(
          "Тестовый процесс приложения остановился до готовности.",
        );
      try {
        if ((await fetch(base + "/api/health")).ok) return;
      } catch {}
      await pause(50);
    }
    throw new Error("Приложение не стало доступным за время проверки.");
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const current = child;
      await new Promise<void>((resolve) => {
        current.once("exit", () => resolve());
        current.kill("SIGTERM");
      });
    }
  }
  let cookie = "";
  async function request(path: string, body?: unknown) {
    const response = await fetch(base + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const session = response.headers.get("set-cookie");
    if (session) cookie = session.split(";")[0];
    assert.ok(response.ok);
    return response.json();
  }
  try {
    await start();
    const owner = { login: "owner", password: "long-process-restart-password" };
    await request("setup", owner);
    await request("board", {
      action: "move",
      revision: 0,
      from: "e2",
      to: "e4",
    });
    await request("board", {
      action: "notes",
      revision: 1,
      notes: "Данные переживают остановку сервера.",
    });
    const before = await request("board");
    await stop();
    await start();
    assert.deepEqual(await request("board"), before);
    await request("logout", {});
    await request("login", owner);
    assert.deepEqual(await request("board"), before);
    assert.equal((await request("profile")).login, "owner");
  } finally {
    await stop();
  }
});
