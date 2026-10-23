import { attachGames } from "./games.js";
import type { ChessFetcher } from "./chesscom.js";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { Chess } from "chess.js";
import {
  migrate,
  sqliteStorage,
  type Storage,
  type Transaction,
} from "./storage.js";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = "academy_session";
const sessionLife = 7 * 24 * 60 * 60 * 1000;
export const passwordHash = (password: string, salt: string) =>
  scryptSync(password, salt, 64);
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type Board = {
  pgn: string;
  fen: string;
  notes: string;
  revision: number;
  updated_at: string;
};
export interface AppOptions {
  secureCookies?: boolean;
  publicDeployment?: boolean;
  ownerLogin?: string;
  ownerPassword?: string;
  chessFetcher?: ChessFetcher;
}
function validOwner(login: unknown, password: unknown): login is string {
  return (
    typeof login === "string" &&
    /^[a-zA-Z0-9_-]{3,40}$/.test(login) &&
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128
  );
}
async function insertOwner(tx: Transaction, login: string, password: string) {
  const salt = randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  await tx.query(
    "INSERT INTO users(id,login,salt,password_hash,created_at) VALUES(1,$1,$2,$3,$4)",
    [login, salt, passwordHash(password, salt).toString("hex"), now],
  );
  await tx.query(
    "INSERT INTO board_states(user_id,fen,updated_at) VALUES(1,$1,$2)",
    [new Chess().fen(), now],
  );
}
export async function createApplication(
  database: string | Storage,
  options: AppOptions | boolean = {},
) {
  const opts =
    typeof options === "boolean" ? { secureCookies: options } : options;
  const db = typeof database === "string" ? sqliteStorage(database) : database;
  try {
    await migrate(db);
    if (opts.ownerLogin !== undefined || opts.ownerPassword !== undefined) {
      if (!validOwner(opts.ownerLogin, opts.ownerPassword))
        throw new Error(
          "Начальный логин должен содержать 3–40 латинских букв, цифр, «_» или «-», пароль — 12–128 символов.",
        );
      await db.transaction(async (tx) => {
        if (db.kind === "postgres")
          await tx.query("SELECT pg_advisory_xact_lock(20001437)");
        if (!(await tx.query("SELECT id FROM users LIMIT 1")).rows.length)
          await insertOwner(tx, opts.ownerLogin!, opts.ownerPassword!);
      });
    }
    if (
      opts.publicDeployment &&
      !(await db.query("SELECT id FROM users LIMIT 1")).rows.length
    ) {
      throw new Error(
        "Перед публикацией задайте начальные настройки владельца или перенесите существующий профиль.",
      );
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  const app = express();
  app.disable("x-powered-by");
  if (opts.publicDeployment) app.set("trust proxy", 1);
  app.use("/api/games/:id/analysis", express.json({ limit: "768kb" }));
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      let sameOrigin = !origin;
      try {
        if (origin)
          sameOrigin =
            new URL(origin).origin === `${req.protocol}://${req.get("host")}`;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin || req.get("sec-fetch-site") === "cross-site") {
        res.status(403).json({ error: "Запрос с другого сайта запрещён." });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "Ожидается запрос в формате JSON." });
        return;
      }
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body)
      ) {
        res.status(400).json({ error: "Некорректный формат запроса." });
        return;
      }
    }
    next();
  });
  const tokenFrom = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  const sessionUser = async (req: Request) => {
    const token = tokenFrom(req);
    if (!token) return undefined;
    const result = await db.query<{ user_id: number }>(
      "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>$2",
      [digest(token), Date.now()],
    );
    return result.rows[0]?.user_id;
  };
  const authorize = async (req: Request, res: Response, next: NextFunction) => {
    const user = await sessionUser(req);
    if (!user)
      throw new HttpError(401, "Войдите, чтобы открыть личные данные.");
    res.locals.userId = user;
    next();
  };
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: !!opts.secureCookies,
    path: "/",
  };
  async function signIn(res: Response, userId: number) {
    const token = randomBytes(32).toString("hex");
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM sessions WHERE expires_at<=$1", [Date.now()]);
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
        [digest(token), userId, Date.now() + sessionLife],
      );
    });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionLife });
  }
  async function authLimit(req: Request, _res: Response, next: NextFunction) {
    const now = Date.now();
    const { rows } = await db.query<{ attempts: number }>(
      `INSERT INTO auth_attempts(client_hash,attempts,expires_at) VALUES($1,1,$2)
      ON CONFLICT(client_hash) DO UPDATE SET attempts=CASE WHEN auth_attempts.expires_at<=$3 THEN 1 ELSE auth_attempts.attempts+1 END,
      expires_at=CASE WHEN auth_attempts.expires_at<=$3 THEN $2 ELSE auth_attempts.expires_at END RETURNING attempts`,
      [digest(req.ip || "local"), now + 15 * 60_000, now],
    );
    if (rows[0].attempts > 15)
      throw new HttpError(
        429,
        "Слишком много попыток. Повторите через 15 минут.",
      );
    next();
  }
  // Health check Render не обращается к Neon и не мешает бесплатному scale-to-zero.
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/ready", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  app.get("/api/auth", async (req, res) =>
    res.json({
      initialized: !!(await db.query("SELECT id FROM users LIMIT 1")).rows
        .length,
      authenticated: !!(await sessionUser(req)),
    }),
  );
  app.post("/api/setup", authLimit, async (req, res) => {
    if (opts.publicDeployment)
      throw new HttpError(
        403,
        "Первичная настройка выполняется через защищённые переменные сервера. Войдите с логином владельца.",
      );
    const { login, password } = req.body ?? {};
    if (!validOwner(login, password))
      throw new HttpError(
        400,
        "Логин: 3–40 латинских букв, цифр, «_» или «-». Пароль: 12–128 символов.",
      );
    await db.transaction(async (tx) => {
      if (db.kind === "postgres")
        await tx.query("SELECT pg_advisory_xact_lock(20001437)");
      if ((await tx.query("SELECT id FROM users LIMIT 1")).rows.length)
        throw new HttpError(409, "Владелец уже создан. Войдите в аккаунт.");
      await insertOwner(tx, login, password);
    });
    await signIn(res, 1);
    res.status(201).json({ ok: true });
  });
  app.post("/api/login", authLimit, async (req, res) => {
    const { login, password } = req.body ?? {};
    if (
      typeof login !== "string" ||
      login.length > 40 ||
      typeof password !== "string" ||
      password.length > 128
    )
      throw new HttpError(400, "Введите логин и пароль.");
    const { rows } = await db.query<{
      id: number;
      salt: string;
      password_hash: string;
    }>("SELECT id,salt,password_hash FROM users WHERE login=$1", [login]);
    const user = rows[0];
    const actual = passwordHash(password, user?.salt || "missing-account-salt");
    const expected = user
      ? Buffer.from(user.password_hash, "hex")
      : Buffer.alloc(64);
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(actual, expected) ||
      !user
    )
      throw new HttpError(401, "Неверный логин или пароль.");
    await signIn(res, user.id);
    res.json({ ok: true });
  });
  app.post("/api/logout", authorize, async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(tokenFrom(req)!),
    ]);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.get("/api/profile", authorize, async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT login,chess_username,start_rating,target_rating,created_at FROM users WHERE id=$1",
          [res.locals.userId],
        )
      ).rows[0],
    ),
  );
  const readBoard = async (userId: number) => {
    const { rows } = await db.query<Board>(
      "SELECT pgn,fen,notes,revision,updated_at FROM board_states WHERE user_id=$1",
      [userId],
    );
    if (!rows[0])
      throw new HttpError(
        503,
        "Не найдена сохранённая доска. Проверьте перенос данных.",
      );
    return rows[0];
  };
  app.get("/api/board", authorize, async (_req, res) =>
    res.json(await readBoard(res.locals.userId)),
  );
  app.post("/api/board", authorize, async (req, res) => {
    const old = await readBoard(res.locals.userId);
    const { revision, action } = req.body ?? {};
    if (!Number.isInteger(revision) || revision !== old.revision)
      throw new HttpError(
        409,
        "Позиция изменена в другом окне. Обновите доску перед повтором.",
      );
    const chess = new Chess();
    if (old.pgn) chess.loadPgn(old.pgn);
    let notes = old.notes;
    if (action === "move") {
      if (chess.isGameOver())
        throw new HttpError(
          400,
          "Партия завершена. Начните новую партию или отмените последний ход.",
        );
      const { from, to, promotion } = req.body;
      if (
        typeof from !== "string" ||
        typeof to !== "string" ||
        !/^[a-h][1-8]$/.test(from) ||
        !/^[a-h][1-8]$/.test(to) ||
        (promotion !== undefined && !["q", "r", "b", "n"].includes(promotion))
      )
        throw new HttpError(400, "Некорректные координаты хода.");
      try {
        chess.move({ from, to, promotion });
      } catch {
        throw new HttpError(400, "Этот ход невозможен по правилам шахмат.");
      }
    } else if (action === "undo") {
      if (!chess.undo()) throw new HttpError(400, "На доске ещё нет ходов.");
    } else if (action === "reset") chess.reset();
    else if (action === "notes") {
      if (
        typeof req.body.notes !== "string" ||
        req.body.notes.length > 10000 ||
        req.body.notes.includes("\0")
      )
        throw new HttpError(
          400,
          "Заметка должна содержать не более 10 000 символов и не должна содержать нулевой символ.",
        );
      notes = req.body.notes;
    } else throw new HttpError(400, "Неизвестное действие с доской.");
    const result = await db.query<Board>(
      `UPDATE board_states SET pgn=$1,fen=$2,notes=$3,revision=revision+1,updated_at=$4
      WHERE user_id=$5 AND revision=$6 RETURNING pgn,fen,notes,revision,updated_at`,
      [
        chess.history().length ? chess.pgn() : "",
        chess.fen(),
        notes,
        new Date().toISOString(),
        res.locals.userId,
        revision,
      ],
    );
    if (!result.changes)
      throw new HttpError(409, "Позиция уже изменена. Обновите доску.");
    res.json(result.rows[0]);
  });
  attachGames(app, db, authorize, opts.chessFetcher);
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Такой запрос не поддерживается." }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "Некорректный формат запроса." });
        return;
      }
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        res
          .status(413)
          .json({ error: "Запрос слишком большой. Максимум — 32 КБ." });
        return;
      }
      // Не выводим строки подключения, SQL, пароли или содержимое личных записей.
      console.error("Не удалось выполнить запрос к базе данных.");
      res.status(503).json({
        error: "База данных временно недоступна. Повторите запрос позже.",
      });
    },
  );
  return { app, close: () => db.close() };
}
