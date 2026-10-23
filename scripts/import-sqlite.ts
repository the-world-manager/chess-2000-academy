import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import {
  migrate,
  postgresStorage,
  type Row,
  type Storage,
  type Value,
} from "../server/storage.js";

const columns = {
  users: [
    "id",
    "login",
    "salt",
    "password_hash",
    "chess_username",
    "start_rating",
    "target_rating",
    "created_at",
  ],
  board_states: ["user_id", "pgn", "fen", "notes", "revision", "updated_at"],
  sessions: ["token_hash", "user_id", "expires_at"],
} as const;
export async function importSqlite(source: string, target: Storage) {
  if (target.kind !== "postgres")
    throw new Error("Целевая база должна быть PostgreSQL.");
  const db = new DatabaseSync(source, { readOnly: true });
  const snapshot: Record<string, Row[]> = {};
  try {
    db.exec("BEGIN");
    for (const [table, fields] of Object.entries(columns))
      snapshot[table] = db
        .prepare(`SELECT ${fields.join(",")} FROM ${table}`)
        .all() as Row[];
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  if (
    snapshot.users.length === 0 &&
    snapshot.board_states.length === 0 &&
    snapshot.sessions.length === 0
  )
    return { users: 0, boards: 0, sessions: 0, verified: true };
  if (
    snapshot.users.length !== 1 ||
    snapshot.board_states.length !== 1 ||
    snapshot.board_states[0].user_id !== snapshot.users[0].id
  )
    throw new Error(
      "Источник должен содержать одного владельца и его доску. Исходная база не изменена.",
    );
  if (
    Object.values(snapshot)
      .flat()
      .some((row) =>
        Object.values(row).some(
          (value) => typeof value === "string" && value.includes("\0"),
        ),
      )
  )
    throw new Error(
      "Источник содержит нулевой символ, который PostgreSQL не поддерживает. Перенос остановлен без потери данных.",
    );
  const chess = new Chess();
  if (snapshot.board_states[0].pgn)
    chess.loadPgn(String(snapshot.board_states[0].pgn));
  if (chess.fen() !== snapshot.board_states[0].fen)
    throw new Error("Позиция не соответствует PGN. Перенос остановлен.");
  if (snapshot.sessions.some((row) => row.user_id !== snapshot.users[0].id))
    throw new Error("Нарушена связь сеансов с владельцем. Перенос остановлен.");
  await target.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(20001437)");
    for (const table of Object.keys(columns))
      if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).rows.length)
        throw new Error(
          "Целевая база уже содержит данные. Автоматическая перезапись запрещена.",
        );
    for (const [table, fields] of Object.entries(columns)) {
      for (const row of snapshot[table])
        await tx.query(
          `INSERT INTO ${table}(${fields.join(",")}) VALUES(${fields.map((_, i) => `$${i + 1}`).join(",")})`,
          fields.map((field) => row[field] as Value),
        );
      const { rows } = await tx.query(
        `SELECT ${fields.join(",")} FROM ${table}`,
      );
      const canonical = (records: Row[]) =>
        records
          .map((row) => fields.map((field) => String(row[field])))
          .map((row) => JSON.stringify(row))
          .sort();
      if (
        JSON.stringify(canonical(rows)) !==
        JSON.stringify(canonical(snapshot[table]))
      )
        throw new Error(
          "Проверка перенесённых данных не прошла. Транзакция отменена.",
        );
    }
  });
  return {
    users: snapshot.users.length,
    boards: snapshot.board_states.length,
    sessions: snapshot.sessions.length,
    verified: true,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let target: Storage | undefined;
  try {
    const { values } = parseArgs({ options: { source: { type: "string" } } });
    if (!values.source)
      throw new Error("Укажите --source с путём к исходной SQLite.");
    if (!process.env.DATABASE_URL)
      throw new Error(
        "Задайте DATABASE_URL в защищённых настройках среды, не передавайте пароль в командной строке.",
      );
    target = postgresStorage(process.env.DATABASE_URL);
    await migrate(target);
    const result = await importSqlite(resolve(values.source), target);
    console.log(
      `Перенос проверен: владельцев — ${result.users}, досок — ${result.boards}, сеансов — ${result.sessions}. Исходная SQLite сохранена.`,
    );
  } catch (error) {
    // Подробности PostgreSQL могут содержать секреты или личные данные.
    const known =
      error instanceof Error &&
      [
        "Целевая база",
        "Источник содержит",
        "Источник должен",
        "Позиция не",
        "Нарушена связь",
        "Укажите --source",
        "Задайте DATABASE_URL",
        "Проверка перенесённых",
      ].some((prefix) => error.message.startsWith(prefix));
    console.error(
      known
        ? (error as Error).message
        : "Перенос не выполнен. Проверьте доступ к базам данных. Исходная SQLite не удалялась.",
    );
    process.exitCode = 1;
  } finally {
    await target?.close();
  }
}
