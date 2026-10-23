import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sqliteStorage } from "../server/storage.js";
import { createApplication } from "../server/app.js";
import {
  chessFetch,
  startSync,
  stepSync,
  saveRemoteGame,
} from "../server/chesscom.js";
import { replay } from "../shared/analysis.js";

// Только реальные ответы публичного API. Нет запасных демонстрационных данных.
const root = mkdtempSync(join(tmpdir(), "academy-live-"));
const db = sqliteStorage(join(root, "live.sqlite"));
let close: (() => Promise<void>) | undefined;
try {
  const app = await createApplication(db, {
    ownerLogin: "live_verification",
    ownerPassword: "ephemeral-live-verification-password",
  });
  close = app.close;
  let job = await startSync(db, 1, "rapid");
  while (!job.done) {
    job = await stepSync(db, 1, job.id);
    if (
      (
        await db.query("SELECT id FROM games WHERE time_class=$1 LIMIT 1", [
          "rapid",
        ])
      ).rows.length
    )
      break;
  }
  const games = (
    await db.query(
      "SELECT * FROM games WHERE time_class=$1 ORDER BY ended_at DESC",
      ["rapid"],
    )
  ).rows;
  if (!games.length)
    throw new Error("В доступных архивах профиля не найдено Rapid-партий.");
  const game = games[0];
  const { moves } = replay(String(game.pgn));
  if (!moves.length) throw new Error("В импортированной партии нет ходов.");
  const month = new Date(Number(game.ended_at) * 1000);
  const archiveMonth = `${month.getUTCFullYear()}/${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const archive = await chessFetch(
    `/pub/player/alexander_gusev/games/${archiveMonth}`,
  );
  const before = Number(
    (await db.query("SELECT COUNT(*) AS n FROM games")).rows[0].n,
  );
  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const raw of archive.games)
      inserted += (await saveRemoteGame(tx, 1, "alexander_gusev", "rapid", raw))
        .added;
  });
  const after = Number(
    (await db.query("SELECT COUNT(*) AS n FROM games")).rows[0].n,
  );
  if (inserted || after !== before)
    throw new Error("Повторный импорт изменил количество партий.");
  const account = (
    await db.query("SELECT * FROM chess_accounts WHERE user_id=1")
  ).rows[0];
  mkdirSync(".verification", { recursive: true });
  writeFileSync(
    ".verification/real-chesscom.json",
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: "https://api.chess.com/pub/player/alexander_gusev",
        profile: JSON.parse(String(account.profile_json)),
        stats: JSON.parse(String(account.stats_json)),
        game,
        rawGame: archive.games.find((raw: any) => raw.url === game.source_url),
        archiveMonth,
        imported: games.length,
        duplicateInsertions: inserted,
        plies: moves.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `Реальные Rapid-партии загружены: ${games.length}. Повторных вставок: ${inserted}. PGN воспроизведён: ${moves.length} полуходов. Отчёт: .verification/real-chesscom.json.`,
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Проверка настоящего Chess.com не выполнена.",
  );
  process.exitCode = 1;
} finally {
  await close?.();
  rmSync(root, { recursive: true, force: true });
}
