import { migrate, postgresStorage } from "../server/storage.js";
if (!process.env.DATABASE_URL) {
  console.error("Задайте DATABASE_URL в защищённых настройках среды.");
  process.exitCode = 1;
} else {
  const db = postgresStorage(process.env.DATABASE_URL);
  try {
    await migrate(db);
    console.log(
      "Схема PostgreSQL подготовлена. Существующие данные сохранены.",
    );
  } catch {
    console.error(
      "Не удалось применить миграции. Проверьте доступность PostgreSQL и строку подключения.",
    );
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
