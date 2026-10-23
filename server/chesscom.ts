import { Chess } from "chess.js";
import { randomUUID } from "node:crypto";
import type { Storage, Transaction } from "./storage.js";
export class ChessApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export type ChessFetcher = (path: string) => Promise<any>;
export const chessFetch: ChessFetcher = async (path) => {
  if (
    !/^\/pub\/player\/[a-z0-9_-]+(?:\/stats|\/games\/archives|\/games\/\d{4}\/\d{2})?$/.test(
      path,
    )
  )
    throw new ChessApiError(400, "Недопустимый адрес Chess.com.");
  let response: Response;
  try {
    response = await fetch(`https://api.chess.com${path}`, {
      headers: {
        "User-Agent":
          "Chess2000Academy/0.2 (personal training; github.com/the-world-manager/chess-2000-academy)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch {
    throw new ChessApiError(
      502,
      "Chess.com недоступен. Уже сохранённые партии не изменены. Повторите синхронизацию позже.",
    );
  }
  if (response.status === 429) {
    const raw = response.headers.get("retry-after");
    const seconds =
      raw && /^\d+$/.test(raw)
        ? Number(raw)
        : raw
          ? Math.ceil((Date.parse(raw) - Date.now()) / 1000)
          : 60;
    throw new ChessApiError(
      429,
      "Chess.com ограничил частоту запросов. Подождите перед повтором.",
      Math.max(30, Math.min(3600, Number.isFinite(seconds) ? seconds : 60)),
    );
  }
  if (response.status === 404)
    throw new ChessApiError(404, "Профиль или архив Chess.com не найден.");
  if (!response.ok)
    throw new ChessApiError(
      502,
      "Chess.com вернул ошибку. Сохранённые партии остаются доступны.",
    );
  const text = await response.text();
  if (Buffer.byteLength(text) > 12 * 1024 * 1024)
    throw new ChessApiError(
      502,
      "Архив Chess.com превышает допустимый размер.",
    );
  try {
    return JSON.parse(text);
  } catch {
    throw new ChessApiError(502, "Chess.com вернул некорректный ответ.");
  }
};
type Job = {
  user_id: number;
  job_id: string;
  time_class: string;
  queue_json: string;
  cursor: number;
  total: number;
  imported: number;
  skipped: number;
  lease_until: number;
  state: string;
};
export function publicJob(job: Job) {
  return {
    id: job.job_id,
    control: job.time_class,
    processed: job.cursor,
    total: job.total,
    imported: job.imported,
    skipped: job.skipped,
    done: job.state === "complete",
  };
}
async function account(db: Storage, userId: number) {
  await db.query(
    "INSERT INTO chess_accounts(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",
    [userId],
  );
  return (
    await db.query<{ next_retry_at: number }>(
      "SELECT next_retry_at FROM chess_accounts WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
}
async function username(db: Storage, userId: number) {
  const name = (
    await db.query<{ chess_username: string }>(
      "SELECT chess_username FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0].chess_username.toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(name))
    throw new ChessApiError(400, "Некорректное имя профиля Chess.com.");
  return name;
}
async function handleError(db: Storage, userId: number, error: unknown) {
  if (error instanceof ChessApiError && error.retryAfter)
    await db.query(
      "UPDATE chess_accounts SET next_retry_at=$1 WHERE user_id=$2",
      [Date.now() + error.retryAfter * 1000, userId],
    );
}
export async function startSync(
  db: Storage,
  userId: number,
  control: string,
  remote: ChessFetcher = chessFetch,
) {
  if (!["rapid", "blitz"].includes(control))
    throw new ChessApiError(400, "Выберите Rapid или Blitz.");
  const meta = await account(db, userId);
  if (Number(meta.next_retry_at) > Date.now())
    throw new ChessApiError(
      429,
      "Подождите до следующей попытки синхронизации.",
      Math.ceil((Number(meta.next_retry_at) - Date.now()) / 1000),
    );
  const existing = (
    await db.query<Job>("SELECT * FROM sync_jobs WHERE user_id=$1", [userId])
  ).rows[0];
  if (existing?.state === "active") {
    if (existing.time_class !== control)
      throw new ChessApiError(
        409,
        "Сначала завершите начатую синхронизацию другого контроля.",
      );
    return publicJob(existing);
  }
  const id = randomUUID();
  const reserved = await db.query<Job>(
    `INSERT INTO sync_jobs(user_id,job_id,time_class,lease_until,state) VALUES($1,$2,$3,$4,'starting')
 ON CONFLICT(user_id) DO UPDATE SET job_id=$2,time_class=$3,lease_until=$4,state='starting',cursor=0,total=0,imported=0,skipped=0,queue_json='[]'
 WHERE sync_jobs.lease_until<=$5 RETURNING *`,
    [userId, id, control, Date.now() + 90000, Date.now()],
  );
  if (!reserved.changes)
    throw new ChessApiError(409, "Синхронизация уже выполняется.");
  try {
    const name = await username(db, userId),
      base = `/pub/player/${name}`;
    const profile = await remote(base),
      stats = await remote(base + "/stats"),
      archives = await remote(base + "/games/archives");
    if (
      !profile ||
      typeof profile.username !== "string" ||
      profile.username.toLowerCase() !== name ||
      !stats ||
      typeof stats !== "object" ||
      !Array.isArray(archives?.archives)
    )
      throw new ChessApiError(
        502,
        "Некорректные данные профиля или архивов Chess.com.",
      );
    const saved = (
      await db.query<{ archive: string }>(
        "SELECT archive FROM archive_sync WHERE user_id=$1 AND time_class=$2",
        [userId, control],
      )
    ).rows.map((r) => r.archive);
    const current = new Date(),
      previous = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1),
      );
    const refreshFrom = `${previous.getUTCFullYear()}/${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
    const queue = [
      ...new Set<string>(
        archives.archives.map((url: unknown) => {
          if (
            typeof url !== "string" ||
            !url.startsWith(`https://api.chess.com${base}/games/`)
          )
            throw new ChessApiError(
              502,
              "Chess.com вернул недопустимый адрес архива.",
            );
          const month = url.slice(-7);
          if (!/^\d{4}\/(0[1-9]|1[0-2])$/.test(month))
            throw new ChessApiError(502, "Некорректный месяц архива.");
          return month;
        }),
      ),
    ]
      .filter((month) => !saved.includes(month) || month >= refreshFrom)
      .sort()
      .reverse();
    const state = queue.length ? "active" : "complete";
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE chess_accounts SET profile_json=$1,stats_json=$2,next_retry_at=0 WHERE user_id=$3",
        [JSON.stringify(profile), JSON.stringify(stats), userId],
      );
      await tx.query(
        "UPDATE sync_jobs SET queue_json=$1,total=$2,state=$3,lease_until=0 WHERE user_id=$4 AND job_id=$5",
        [JSON.stringify(queue), queue.length, state, userId, id],
      );
      if (!queue.length)
        await tx.query(
          "UPDATE chess_accounts SET last_sync=$1 WHERE user_id=$2",
          [new Date().toISOString(), userId],
        );
    });
    return publicJob(
      (
        await db.query<Job>("SELECT * FROM sync_jobs WHERE user_id=$1", [
          userId,
        ])
      ).rows[0],
    );
  } catch (error) {
    await db.query(
      "UPDATE sync_jobs SET lease_until=0,state='failed' WHERE user_id=$1 AND job_id=$2",
      [userId, id],
    );
    await handleError(db, userId, error);
    throw error;
  }
}
export async function saveRemoteGame(
  tx: Transaction,
  userId: number,
  name: string,
  control: string,
  raw: any,
) {
  if (raw?.time_class !== control || raw?.rules !== "chess")
    return { added: 0, skipped: 0 };
  if (
    typeof raw.pgn !== "string" ||
    raw.pgn.length > 65536 ||
    typeof raw.url !== "string" ||
    !/^https:\/\/www\.chess\.com\/game\/(live|daily)\/\d+$/.test(raw.url) ||
    !Number.isSafeInteger(raw.end_time) ||
    raw.end_time < 0 ||
    !raw.white ||
    !raw.black
  )
    return { added: 0, skipped: 1 };
  const color =
    typeof raw.white.username === "string" &&
    raw.white.username.toLowerCase() === name
      ? "w"
      : typeof raw.black.username === "string" &&
          raw.black.username.toLowerCase() === name
        ? "b"
        : null;
  if (!color) return { added: 0, skipped: 1 };
  const chess = new Chess();
  try {
    chess.loadPgn(raw.pgn);
  } catch {
    return { added: 0, skipped: 1 };
  }
  if (
    [raw.pgn, raw.time_control, raw.white.username, raw.black.username].some(
      (value) => typeof value === "string" && value.includes("\0"),
    )
  )
    return { added: 0, skipped: 1 };
  {
    if (chess.history().length > 600) return { added: 0, skipped: 1 };
    const self = color === "w" ? raw.white : raw.black,
      other = color === "w" ? raw.black : raw.white;
    if (
      typeof other.username !== "string" ||
      other.username.length > 100 ||
      typeof raw.time_control !== "string"
    )
      return { added: 0, skipped: 1 };
    const result =
      self.result === "win"
        ? "win"
        : other.result === "win"
          ? "loss"
          : [
                "agreed",
                "repetition",
                "stalemate",
                "insufficient",
                "50move",
                "timevsinsufficient",
              ].includes(self.result)
            ? "draw"
            : null;
    if (!result) return { added: 0, skipped: 1 };
    const headers = chess.getHeaders();
    const opening =
      headers.Opening?.slice(0, 150) ||
      (/^[A-E]\d{2}$/.test(headers.ECO || "") ? `ECO ${headers.ECO}` : null);
    const rating = (v: unknown) =>
      Number.isInteger(v) && Number(v) >= 0 && Number(v) < 10000
        ? Number(v)
        : null;
    const inserted = await tx.query(
      "INSERT INTO games(id,user_id,source_key,source_url,ended_at,opponent,color,result,time_class,time_control,rating,opponent_rating,opening,pgn,imported_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(user_id,source_key) DO NOTHING",
      [
        randomUUID(),
        userId,
        raw.url,
        raw.url,
        raw.end_time,
        other.username,
        color,
        result,
        control,
        raw.time_control,
        rating(self.rating),
        rating(other.rating),
        opening,
        raw.pgn,
        new Date().toISOString(),
      ],
    );
    return { added: inserted.changes, skipped: 0 };
  }
}
export async function stepSync(
  db: Storage,
  userId: number,
  id: string,
  remote: ChessFetcher = chessFetch,
) {
  const meta = await account(db, userId);
  if (Number(meta.next_retry_at) > Date.now())
    throw new ChessApiError(429, "Подождите перед повтором синхронизации.");
  const result = await db.query<Job>(
    "UPDATE sync_jobs SET lease_until=$1 WHERE user_id=$2 AND job_id=$3 AND state='active' AND lease_until<=$4 RETURNING *",
    [Date.now() + 90000, userId, id, Date.now()],
  );
  const job = result.rows[0];
  if (!job)
    throw new ChessApiError(
      409,
      "Синхронизация занята или завершена. Обновите список партий.",
    );
  try {
    const queue: string[] = JSON.parse(job.queue_json),
      month = queue[job.cursor],
      name = await username(db, userId);
    const archive = await remote(`/pub/player/${name}/games/${month}`);
    if (!Array.isArray(archive?.games))
      throw new ChessApiError(502, "Некорректный ответ архива Chess.com.");
    await db.transaction(async (tx) => {
      const fenced = await tx.query(
        "UPDATE sync_jobs SET lease_until=$1 WHERE user_id=$2 AND job_id=$3 AND lease_until=$1 AND cursor=$4 RETURNING job_id",
        [job.lease_until, userId, id, job.cursor],
      );
      if (!fenced.changes)
        throw new ChessApiError(
          409,
          "Сеанс синхронизации изменился. Повторите загрузку.",
        );
      let added = 0,
        skipped = 0;
      for (const raw of archive.games) {
        const r = await saveRemoteGame(tx, userId, name, job.time_class, raw);
        added += r.added;
        skipped += r.skipped;
      }
      const now = new Date().toISOString();
      await tx.query(
        "INSERT INTO archive_sync(user_id,time_class,archive,synced_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,time_class,archive) DO UPDATE SET synced_at=$4",
        [userId, job.time_class, month, now],
      );
      const cursor = job.cursor + 1;
      await tx.query(
        "UPDATE sync_jobs SET cursor=$1,imported=imported+$2,skipped=skipped+$3,lease_until=0,state=$4 WHERE user_id=$5 AND job_id=$6",
        [
          cursor,
          added,
          skipped,
          cursor >= queue.length ? "complete" : "active",
          userId,
          id,
        ],
      );
      if (cursor >= queue.length)
        await tx.query(
          "UPDATE chess_accounts SET last_sync=$1 WHERE user_id=$2",
          [now, userId],
        );
    });
    return publicJob(
      (
        await db.query<Job>("SELECT * FROM sync_jobs WHERE user_id=$1", [
          userId,
        ])
      ).rows[0],
    );
  } catch (error) {
    await db.query(
      "UPDATE sync_jobs SET lease_until=0 WHERE user_id=$1 AND job_id=$2 AND lease_until=$3",
      [userId, id, job.lease_until],
    );
    await handleError(db, userId, error);
    throw error;
  }
}
