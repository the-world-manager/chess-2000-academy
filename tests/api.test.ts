import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../server/app.js";
import type { Server } from "node:http";

async function start(file = ":memory:") {
  const database =
    process.env.TEST_BACKEND === "postgres"
      ? await (await import("./helpers/postgres.js")).testPostgres(file)
      : file;
  const application = await createApplication(database);
  const server: Server = await new Promise((resolve) => {
    const s = application.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  async function request(
    path: string,
    body?: unknown,
    withAuth = true,
    headers: Record<string, string> = {},
  ) {
    const res = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(withAuth && cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const session = res.headers.get("set-cookie");
    if (session) cookie = session.split(";")[0];
    return { status: res.status, data: await res.json(), session };
  }
  return {
    request,
    setCookie: (value: string) => {
      cookie = value;
    },
    stop: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await application.close();
    },
  };
}
const owner = { login: "alexander", password: "correct-horse-russian-chess" };
test("Личный API: авторизация, защита запросов, валидация ходов, конфликты и выход", async () => {
  const instance = await start();
  const { request } = instance;
  try {
    assert.equal((await request("board")).status, 401);
    assert.equal(
      (await request("setup", owner, false, { Origin: "null" })).status,
      403,
    );
    assert.equal(
      (await request("setup", owner, false, { Origin: "https://evil.invalid" }))
        .status,
      403,
    );
    assert.equal(
      (await request("setup", { ...owner, password: "short" })).status,
      400,
    );
    const created = await request("setup", owner);
    assert.equal(created.status, 201);
    assert.match(created.session!, /HttpOnly/);
    assert.match(created.session!, /SameSite=Strict/);
    assert.equal((await request("setup", owner)).status, 409);
    assert.equal((await request("profile", undefined, false)).status, 401);
    assert.equal(
      (await request("profile")).data.chess_username,
      "alexander_gusev",
    );
    const board = (await request("board")).data;
    assert.equal(
      (
        await request("board", {
          action: "move",
          revision: 0,
          from: "e2",
          to: "e5",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("board", {
          action: "move",
          revision: 0,
          from: "e7",
          to: "e5",
        })
      ).status,
      400,
    );
    const moved = await request("board", {
      action: "move",
      revision: 0,
      from: "e2",
      to: "e4",
    });
    assert.equal(moved.status, 200);
    assert.match(moved.data.pgn, /1\. e4/);
    assert.notEqual(moved.data.fen, board.fen);
    assert.equal(
      (await request("board", { action: "reset", revision: 0 })).status,
      409,
    );
    assert.equal(
      (await request("board", { action: "undo", revision: 1 })).data.fen,
      board.fen,
    );
    assert.equal(
      (
        await request("board", {
          action: "notes",
          revision: 2,
          notes: "Проверить центр и безопасность короля",
        })
      ).status,
      200,
    );
    const reset = await request("board", { action: "reset", revision: 3 });
    assert.equal(reset.data.notes, "Проверить центр и безопасность короля");
    assert.equal(reset.data.pgn, "");
    assert.equal((await request("logout", {})).status, 200);
    assert.equal((await request("board")).status, 401);
    assert.equal(
      (await request("login", { ...owner, password: "wrong" })).status,
      401,
    );
    assert.equal((await request("login", owner)).status, 200);
    assert.equal(
      (await request("board")).data.notes,
      "Проверить центр и безопасность короля",
    );
  } finally {
    await instance.stop();
  }
});
test(`${process.env.TEST_BACKEND === "postgres" ? "PostgreSQL" : "SQLite"} сохраняет позицию, заметку, профиль и сеанс после закрытия и повторного открытия сервера`, async () => {
  const folder = mkdtempSync(join(tmpdir(), "academy-"));
  const file = join(folder, "data.sqlite");
  let instance = await start(file);
  try {
    const setup = await instance.request("setup", owner);
    const cookie = setup.session!.split(";")[0];
    await instance.request("board", {
      action: "move",
      revision: 0,
      from: "d2",
      to: "d4",
    });
    await instance.request("board", {
      action: "notes",
      revision: 1,
      notes: "Контроль центра",
    });
    const saved = (await instance.request("board")).data;
    await instance.stop();
    instance = await start(file);
    instance.setCookie(cookie);
    assert.deepEqual((await instance.request("board")).data, saved);
    assert.equal((await instance.request("profile")).data.login, owner.login);
    await instance.request("logout", {});
    await instance.request("login", owner);
    assert.deepEqual((await instance.request("board")).data, saved);
  } finally {
    await instance.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});
test("API применяет рокировку и взятие на проходе по правилам chess.js", async () => {
  const instance = await start();
  try {
    await instance.request("setup", owner);
    let revision = 0;
    for (const [from, to] of [
      ["e2", "e4"],
      ["e7", "e5"],
      ["g1", "f3"],
      ["b8", "c6"],
      ["f1", "c4"],
      ["f8", "c5"],
      ["e1", "g1"],
    ]) {
      const move = await instance.request("board", {
        action: "move",
        revision: revision++,
        from,
        to,
      });
      assert.equal(move.status, 200);
    }
    assert.match((await instance.request("board")).data.pgn, /O-O/);
    await instance.request("board", { action: "reset", revision: revision++ });
    for (const [from, to] of [
      ["e2", "e4"],
      ["a7", "a6"],
      ["e4", "e5"],
      ["d7", "d5"],
      ["e5", "d6"],
    ]) {
      assert.equal(
        (
          await instance.request("board", {
            action: "move",
            revision: revision++,
            from,
            to,
          })
        ).status,
        200,
      );
    }
    assert.match(
      (await instance.request("board")).data.fen,
      /rnbqkbnr\/1pp1pppp\/p2P4\/8/,
    );
  } finally {
    await instance.stop();
  }
});

test("API сохраняет каждый вариант превращения и отклоняет ход после мата", async () => {
  const instance = await start();
  try {
    await instance.request("setup", owner);
    let revision = 0;
    for (const promotion of ["q", "r", "b", "n"]) {
      if (revision)
        await instance.request("board", {
          action: "reset",
          revision: revision++,
        });
      for (const [from, to] of [
        ["a2", "a4"],
        ["h7", "h5"],
        ["a4", "a5"],
        ["h5", "h4"],
        ["a5", "a6"],
        ["h4", "h3"],
        ["a6", "b7"],
        ["h3", "g2"],
      ]) {
        assert.equal(
          (
            await instance.request("board", {
              action: "move",
              revision: revision++,
              from,
              to,
            })
          ).status,
          200,
        );
      }
      assert.equal(
        (
          await instance.request("board", {
            action: "move",
            revision,
            from: "b7",
            to: "a8",
          })
        ).status,
        400,
      );
      const result = await instance.request("board", {
        action: "move",
        revision: revision++,
        from: "b7",
        to: "a8",
        promotion,
      });
      assert.equal(result.status, 200);
      assert.ok(result.data.fen.startsWith(promotion.toUpperCase()));
    }
    await instance.request("board", { action: "reset", revision: revision++ });
    for (const [from, to] of [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ]) {
      assert.equal(
        (
          await instance.request("board", {
            action: "move",
            revision: revision++,
            from,
            to,
          })
        ).status,
        200,
      );
    }
    assert.equal(
      (
        await instance.request("board", {
          action: "move",
          revision,
          from: "a2",
          to: "a3",
        })
      ).status,
      400,
    );
  } finally {
    await instance.stop();
  }
});
