import { createHash, randomUUID } from "node:crypto";
import { postgresStorage, type Storage } from "../../server/storage.js";
export async function testPostgres(file = ":memory:"): Promise<Storage> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base)
    throw new Error("Запускайте тесты PostgreSQL через npm run test:postgres.");
  const schema =
    "academy_" +
    createHash("sha256")
      .update(file === ":memory:" ? randomUUID() : file)
      .digest("hex")
      .slice(0, 20);
  const admin = postgresStorage(base, true);
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    await admin.close();
  }
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return postgresStorage(url.toString(), true);
}
