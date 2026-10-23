import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";

export type Row = Record<string, unknown>;
export type Value = string | number | null;
export interface Query {
  <T extends Row = Row>(
    sql: string,
    params?: Value[],
  ): Promise<{ rows: T[]; changes: number }>;
}
export interface Transaction {
  query: Query;
}
export interface Storage extends Transaction {
  kind: "sqlite" | "postgres";
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function sqliteStorage(filename: string): Storage {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const execute: Query = async <T extends Row>(
    sql: string,
    params: Value[] = [],
  ) => {
    const ordered: Value[] = [];
    const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
      ordered.push(params[Number(index) - 1]);
      return "?";
    });
    const stmt = db.prepare(sqliteSql);
    if (stmt.columns().length) {
      const rows = stmt.all(...ordered) as T[];
      return { rows, changes: rows.length };
    }
    return { rows: [], changes: Number(stmt.run(...ordered).changes) };
  };
  return {
    kind: "sqlite",
    query: (sql, params) => serial(() => execute(sql, params)),
    transaction: (fn) =>
      serial(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn({ query: execute });
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }),
    close: () => serial(() => db.close()),
  };
}
export function postgresConfig(
  connectionString: string,
  allowInsecureLocal = false,
): PoolConfig {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Нужна строка подключения PostgreSQL.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // pg не должен переопределять проверку сертификата параметром sslmode=require.
  // Для Neon используем системные доверенные CA и обязательную проверку имени сервера.
  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: allowInsecureLocal && local ? false : { rejectUnauthorized: true },
    max: 2,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
    application_name: "chess-2000-academy",
  };
}
export function postgresStorage(
  connectionString: string,
  allowInsecureLocal = false,
): Storage {
  const pool = new Pool(postgresConfig(connectionString, allowInsecureLocal));
  pool.on("error", () =>
    console.error(
      "Соединение с базой данных прервано. Следующий запрос откроет новое соединение.",
    ),
  );
  const queryFor =
    (target: Pool | PoolClient): Query =>
    async <T extends Row>(sql: string, params: Value[] = []) => {
      const result = await target.query<T & QueryResultRow>(sql, params);
      return { rows: result.rows, changes: result.rowCount ?? 0 };
    };
  return {
    kind: "postgres",
    query: queryFor(pool),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: queryFor(client) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function migrate(storage: Storage) {
  const schema = readFileSync(
    new URL("../migrations/001_foundation.sql", import.meta.url),
    "utf8",
  );
  await storage.transaction(async (tx) => {
    if (storage.kind === "postgres")
      await tx.query("SELECT pg_advisory_xact_lock(20001437)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const { rows } = await tx.query(
      "SELECT version FROM schema_migrations WHERE version=$1",
      [1],
    );
    if (!rows.length) {
      for (const statement of schema
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query(
        "INSERT INTO schema_migrations(version,applied_at) VALUES($1,$2)",
        [1, new Date().toISOString()],
      );
    }
  });
}
