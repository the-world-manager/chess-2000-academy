import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createApplication, passwordHash } from "../../server/app.js";
import {
  sqliteStorage,
  migrate,
  postgresConfig,
} from "../../server/storage.js";
import { testPostgres } from "../helpers/postgres.js";
import { importSqlite } from "../../scripts/import-sqlite.js";
import { Chess } from "chess.js";

const owner = { login: "alexander", password: "correct-secure-chess-password" };
test("SQLite → PostgreSQL: профиль, пароль, PGN/FEN, заметки и сеансы переносятся без изменения источника", async () => {
  const root = mkdtempSync(join(tmpdir(), "academy-migration-"));
  const source = join(root, "old.sqlite");
  const old = sqliteStorage(source);
  await migrate(old);
  const salt = randomBytes(16).toString("hex");
  const chess = new Chess();
  chess.move("e4");
  chess.move("e5");
  const now = new Date().toISOString();
  const notes =
    "План: развитие, рокировка. '); DELETE FROM users; --\nШахматы ♞ без потерь";
  await old.query(
    "INSERT INTO users(id,login,salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5)",
    [
      37,
      owner.login,
      salt,
      passwordHash(owner.password, salt).toString("hex"),
      now,
    ],
  );
  await old.query(
    "INSERT INTO board_states(user_id,pgn,fen,notes,revision,updated_at) VALUES($1,$2,$3,$4,$5,$6)",
    [37, chess.pgn(), chess.fen(), notes, 9, now],
  );
  await old.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    ["old-token-hash", 37, Date.now() + 60000],
  );
  await old.query(
    "INSERT INTO games(id,user_id,source_key,source_url,ended_at,opponent,color,result,time_class,time_control,pgn,imported_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
      "migrated-game",
      37,
      "migration-test",
      "https://www.chess.com/game/live/1",
      1792713600,
      "Контроль миграции",
      "w",
      "draw",
      "rapid",
      "900+10",
      chess.pgn(),
      now,
    ],
  );
  await old.close();
  const before = readFileSync(source);
  const target = await testPostgres();
  await migrate(target);
  try {
    assert.deepEqual(await importSqlite(source, target), {
      users: 1,
      boards: 1,
      sessions: 1,
      verified: true,
    });
    assert.deepEqual(readFileSync(source), before);
    assert.equal(
      (await target.query("SELECT notes FROM board_states")).rows[0].notes,
      notes,
    );
    assert.equal(
      (await target.query("SELECT fen FROM board_states")).rows[0].fen,
      chess.fen(),
    );
    assert.equal(
      (
        await target.query("SELECT pgn FROM games WHERE id=$1", [
          "migrated-game",
        ])
      ).rows[0].pgn,
      chess.pgn(),
    );
    const application = await createApplication(target);
    const server = createServer(application.app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(owner),
      });
      assert.equal(response.status, 200);
      const board = await fetch(`http://127.0.0.1:${port}/api/board`, {
        headers: { Cookie: response.headers.get("set-cookie")!.split(";")[0] },
      });
      assert.equal((await board.json()).notes, notes);
      await assert.rejects(
        () => importSqlite(source, target),
        /уже содержит данные/,
      );
      assert.equal(
        (await target.query("SELECT COUNT(*) AS n FROM users")).rows[0].n,
        "1",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await target.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("PostgreSQL: миграции повторяемы, транзакция откатывает неполную запись", async () => {
  const db = await testPostgres();
  try {
    await migrate(db);
    await migrate(db);
    assert.equal(
      (await db.query("SELECT COUNT(*) AS n FROM schema_migrations")).rows[0].n,
      "2",
    );
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO users(id,login,salt,password_hash,created_at) VALUES(1,$1,$2,$3,$4)",
          ["test", "salt", "hash", new Date().toISOString()],
        );
        await tx.query(
          "INSERT INTO board_states(user_id,fen,updated_at) VALUES(999,$1,$2)",
          [new Chess().fen(), new Date().toISOString()],
        );
      }),
    );
    assert.equal(
      (await db.query("SELECT COUNT(*) AS n FROM users")).rows[0].n,
      "0",
    );
  } finally {
    await db.close();
  }
});
test("Neon: TLS всегда проверяет сертификат, pool ограничен и не держит простаивающие соединения", () => {
  const config = postgresConfig(
    "postgresql://user:password@example.neon.tech/database?sslmode=require",
  );
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.max, 2);
  assert.equal(config.min, 0);
  assert.equal(config.idleTimeoutMillis, 10000);
  assert.ok(!config.connectionString!.includes("sslmode="));
  assert.deepEqual(
    postgresConfig(
      "postgresql://user:password@example.neon.tech/database?sslmode=disable",
      true,
    ).ssl,
    { rejectUnauthorized: true },
  );
  assert.equal(
    postgresConfig("postgresql://user:password@127.0.0.1/database", true).ssl,
    false,
  );
});

test("Neon: параметры строки подключения не отключают обязательную проверку TLS", () => {
  const config = postgresConfig(
    "postgresql://user:password@example.neon.tech/database?ssl=0&sslmode=disable",
  );
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.ok(!new URL(config.connectionString!).searchParams.has("ssl"));
});
