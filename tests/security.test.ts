import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Server } from "node:http";
import { createApplication } from "../server/app.js";
import { sqliteStorage, type Storage } from "../server/storage.js";
const owner = { login: "owner", password: "long-secure-initial-password" };
async function serve(file = ":memory:", publicDeployment = false) {
  const db =
    process.env.TEST_BACKEND === "postgres"
      ? await (await import("./helpers/postgres.js")).testPostgres(file)
      : sqliteStorage(file);
  const application = await createApplication(db, {
    publicDeployment,
    secureCookies: publicDeployment,
    ownerLogin: owner.login,
    ownerPassword: owner.password,
  });
  const server: Server = await new Promise((resolve) => {
    const socket = application.app.listen(0, "127.0.0.1", () =>
      resolve(socket),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = "";
  const request = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Cookie: cookie,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const session = response.headers.get("set-cookie");
    if (session) cookie = session.split(";")[0];
    return { status: response.status, data: await response.json(), session };
  };
  return {
    db,
    base,
    request,
    setCookie: (value: string) => {
      cookie = value;
    },
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await application.close();
    },
  };
}
test("Render: безопасное создание владельца из переменных, HTTPS-cookie и закрытая публичная регистрация", async () => {
  const app = await serve(":memory:", true);
  try {
    assert.equal((await app.request("auth")).data.initialized, true);
    assert.equal((await app.request("setup", owner)).status, 403);
    const login = await app.request("login", owner, {
      "X-Forwarded-Proto": "https",
      Origin: app.base.replace("http:", "https:"),
    });
    assert.equal(login.status, 200);
    assert.match(login.session!, /Secure/);
    assert.match(login.session!, /HttpOnly/);
    assert.equal((await app.request("profile")).data.login, owner.login);
  } finally {
    await app.stop();
  }
});
test("Health Render не будит PostgreSQL, готовность проверяется отдельно", async () => {
  const app = await serve();
  const query = app.db.query;
  let count = 0;
  app.db.query = ((...args: Parameters<Storage["query"]>) => {
    count++;
    return query(...args);
  }) as Storage["query"];
  try {
    assert.equal((await app.request("health")).status, 200);
    assert.equal(count, 0);
    assert.equal((await app.request("ready")).status, 200);
    assert.equal(count, 1);
  } finally {
    await app.stop();
  }
});
test("Ограничение входа и сеанс переживают перезапуск приложения", async () => {
  const root = mkdtempSync(join(tmpdir(), "academy-auth-"));
  const file = join(root, "auth.sqlite");
  let app = await serve(file);
  try {
    const login = await app.request("login", owner);
    const cookie = login.session!.split(";")[0];
    for (let i = 0; i < 14; i++)
      assert.equal(
        (await app.request("login", { ...owner, password: "wrong" })).status,
        401,
      );
    assert.equal((await app.request("login", owner)).status, 429);
    await app.stop();
    app = await serve(file);
    app.setCookie(cookie);
    assert.equal((await app.request("login", owner)).status, 429);
    assert.equal((await app.request("board")).status, 200);
    await app.db.query("UPDATE sessions SET expires_at=0");
    assert.equal((await app.request("board")).status, 401);
    await app.db.query("UPDATE auth_attempts SET expires_at=0");
    assert.equal((await app.request("login", owner)).status, 200);
  } finally {
    await app.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
test("Конкурирующие обновления доски не перезаписывают друг друга", async () => {
  const app = await serve();
  try {
    await app.request("login", owner);
    const results = await Promise.all([
      app.request("board", {
        action: "move",
        revision: 0,
        from: "e2",
        to: "e4",
      }),
      app.request("board", {
        action: "move",
        revision: 0,
        from: "d2",
        to: "d4",
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(
      (await app.request("board")).data,
      results.find((r) => r.status === 200)!.data,
    );
    assert.equal(
      (
        await app.request("board", {
          action: "notes",
          revision: 1,
          notes: "недопустимый\0символ",
        })
      ).status,
      400,
    );
  } finally {
    await app.stop();
  }
});

test("Render не запускается с незарегистрированным владельцем без защищённой начальной настройки", async () => {
  const database =
    process.env.TEST_BACKEND === "postgres"
      ? await (await import("./helpers/postgres.js")).testPostgres()
      : ":memory:";
  await assert.rejects(
    () => createApplication(database, { publicDeployment: true }),
    /начальные настройки владельца/,
  );
});
