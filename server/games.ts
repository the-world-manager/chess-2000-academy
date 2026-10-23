import type {
  Express,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import type { Storage, Value } from "./storage.js";
import {
  startSync,
  stepSync,
  ChessApiError,
  type ChessFetcher,
} from "./chesscom.js";
import { validateAnalysis } from "../shared/analysis.js";
const publicStats = (value: any) =>
  value && typeof value === "object"
    ? {
        last:
          Number.isInteger(value.last?.rating) &&
          value.last.rating >= 0 &&
          value.last.rating < 10000
            ? { rating: value.last.rating, date: Number(value.last.date) || 0 }
            : null,
        record:
          value.record &&
          ["win", "loss", "draw"].every(
            (key) =>
              Number.isSafeInteger(value.record[key]) && value.record[key] >= 0,
          )
            ? {
                win: value.record.win,
                loss: value.record.loss,
                draw: value.record.draw,
              }
            : null,
      }
    : null;
export function attachGames(
  app: Express,
  db: Storage,
  authorize: RequestHandler,
  remote?: ChessFetcher,
) {
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    async (req, res, next) => {
      try {
        await fn(req, res);
      } catch (error) {
        if (error instanceof ChessApiError) {
          if (error.retryAfter) res.setHeader("Retry-After", error.retryAfter);
          res.status(error.status).json({ error: error.message });
        } else next(error);
      }
    };
  app.get(
    "/api/chess",
    authorize,
    route(async (_req, res) => {
      const userId = res.locals.userId;
      const meta = (
        await db.query("SELECT * FROM chess_accounts WHERE user_id=$1", [
          userId,
        ])
      ).rows[0];
      const profile = meta ? JSON.parse(String(meta.profile_json)) : null,
        stats = meta ? JSON.parse(String(meta.stats_json)) : null;
      const counts = (
        await db.query(
          "SELECT time_class,COUNT(*) AS n FROM games WHERE user_id=$1 GROUP BY time_class",
          [userId],
        )
      ).rows;
      res.json({
        profile: profile
          ? {
              username: profile.username,
              name: typeof profile.name === "string" ? profile.name : null,
              url: typeof profile.url === "string" ? profile.url : null,
            }
          : null,
        rapid: publicStats(stats?.chess_rapid),
        blitz: publicStats(stats?.chess_blitz),
        lastSync: meta?.last_sync || null,
        retryAt: Number(meta?.next_retry_at || 0),
        counts: Object.fromEntries(
          counts.map((r) => [r.time_class, Number(r.n)]),
        ),
      });
    }),
  );
  app.post(
    "/api/chess/sync",
    authorize,
    route(async (req, res) =>
      res.json(
        await startSync(db, res.locals.userId, req.body.control, remote),
      ),
    ),
  );
  app.post(
    "/api/chess/sync/step",
    authorize,
    route(async (req, res) => {
      if (typeof req.body.id !== "string")
        throw new ChessApiError(400, "Не указан сеанс синхронизации.");
      res.json(await stepSync(db, res.locals.userId, req.body.id, remote));
    }),
  );
  app.get(
    "/api/games",
    authorize,
    route(async (req, res) => {
      const control = req.query.control || "rapid";
      if (!["rapid", "blitz"].includes(String(control)))
        throw new ChessApiError(400, "Выберите Rapid или Blitz.");
      const params: Value[] = [res.locals.userId, String(control)];
      const where = ["g.user_id=$1", "g.time_class=$2"];
      const add = (field: string, value: Value) => {
        params.push(value);
        where.push(`${field}=$${params.length}`);
      };
      if (req.query.result) {
        if (!["win", "loss", "draw"].includes(String(req.query.result)))
          throw new ChessApiError(400, "Некорректный результат.");
        add("g.result", String(req.query.result));
      }
      if (req.query.time) {
        const value = String(req.query.time);
        if (!/^\d{1,7}(?:\+\d{1,5})?$/.test(value))
          throw new ChessApiError(400, "Некорректный контроль времени.");
        add("g.time_control", value);
      }
      if (req.query.color) {
        if (!["w", "b"].includes(String(req.query.color)))
          throw new ChessApiError(400, "Некорректный цвет фигур.");
        add("g.color", String(req.query.color));
      }
      for (const key of ["from", "to"] as const)
        if (req.query[key]) {
          const date = String(req.query[key]);
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(Date.parse(date))
          )
            throw new ChessApiError(400, "Некорректная дата.");
          const value =
            Math.floor(Date.parse(`${date}T00:00:00+03:00`) / 1000) +
            (key === "to" ? 86400 - 1 : 0);
          params.push(value);
          where.push(
            `g.ended_at${key === "from" ? ">=" : "<="}$${params.length}`,
          );
        }
      const page = Number(req.query.page || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
        throw new ChessApiError(400, "Некорректный номер страницы.");
      const total = Number(
        (
          await db.query(
            `SELECT COUNT(*) AS n FROM games g WHERE ${where.join(" AND ")}`,
            params,
          )
        ).rows[0].n,
      );
      const rows = (
        await db.query(
          `SELECT g.id,g.source_url,g.ended_at,g.opponent,g.color,g.result,g.time_class,g.time_control,g.rating,g.opponent_rating,g.opening,a.status AS analysis_status FROM games g LEFT JOIN game_analyses a ON a.game_id=g.id WHERE ${where.join(" AND ")} ORDER BY g.ended_at DESC,g.id LIMIT 50 OFFSET ${(page - 1) * 50}`,
          params,
        )
      ).rows;
      const controls = (
        await db.query<{ time_control: string }>(
          "SELECT DISTINCT time_control FROM games WHERE user_id=$1 AND time_class=$2 ORDER BY time_control",
          [res.locals.userId, String(control)],
        )
      ).rows.map((row) => row.time_control);
      res.json({
        controls,
        total,
        page,
        pages: Math.ceil(total / 50),
        games: rows.map((row) => ({ ...row, ended_at: Number(row.ended_at) })),
      });
    }),
  );
  const ownGame = async (req: Request, res: Response) => {
    const row = (
      await db.query("SELECT * FROM games WHERE id=$1 AND user_id=$2", [
        String(req.params.id),
        res.locals.userId,
      ])
    ).rows[0];
    if (!row) throw new ChessApiError(404, "Партия не найдена.");
    return row;
  };
  app.get(
    "/api/games/:id",
    authorize,
    route(async (req, res) => {
      const game = await ownGame(req, res);
      const analysis = (
        await db.query(
          "SELECT result_json FROM game_analyses WHERE game_id=$1 AND user_id=$2",
          [String(req.params.id), res.locals.userId],
        )
      ).rows[0];
      res.json({
        ...game,
        ended_at: Number(game.ended_at),
        analysis: analysis ? JSON.parse(String(analysis.result_json)) : null,
      });
    }),
  );
  app.post(
    "/api/games/:id/analysis",
    authorize,
    route(async (req, res) => {
      const game = await ownGame(req, res);
      let result;
      try {
        result = validateAnalysis(String(game.pgn), req.body);
      } catch {
        throw new ChessApiError(
          400,
          "Результат анализа не соответствует партии или содержит некорректные данные.",
        );
      }
      const written = await db.query(
        `INSERT INTO game_analyses(game_id,user_id,result_json,status,updated_at) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(game_id) DO UPDATE SET result_json=$3,status=$4,updated_at=$5 WHERE game_analyses.status<>'complete' OR $4='complete' RETURNING game_id`,
        [
          String(req.params.id),
          res.locals.userId,
          JSON.stringify(result),
          result.status,
          new Date().toISOString(),
        ],
      );
      if (!written.changes)
        throw new ChessApiError(
          409,
          "Полный анализ уже сохранён. Неполный результат его не заменит.",
        );
      res.json({ ok: true });
    }),
  );
}
