import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { Chess } from "chess.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = "academy_session";
const sessionLife = 7 * 24 * 60 * 60 * 1000;
const initialFen = new Chess().fen();
function passwordHash(password: string, salt: string) {
  return scryptSync(password, salt, 64);
}

export function createApplication(filename: string, secureCookies = false) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      chess_username TEXT NOT NULL DEFAULT 'alexander_gusev', start_rating INTEGER NOT NULL DEFAULT 1437,
      target_rating INTEGER NOT NULL DEFAULT 2000, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS board_states (
      user_id INTEGER PRIMARY KEY REFERENCES users(id), pgn TEXT NOT NULL DEFAULT '', fen TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    PRAGMA user_version=1;`);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Same-origin JSON writes, including account setup and sign-in, prevent cross-site writes.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      let sameOrigin = !origin;
      try {
        if (origin) sameOrigin = new URL(origin).host === req.get("host");
      } catch {
        sameOrigin = false;
      }
      if (req.get("sec-fetch-site") === "cross-site" || !sameOrigin) {
        res.status(403).json({ error: "Запрос с другого сайта запрещён." });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "Ожидается запрос в формате JSON." });
        return;
      }
    }
    next();
  });
  const attempts = new Map<string, { count: number; reset: number }>();
  const authLimit = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "local";
    const now = Date.now();
    let entry = attempts.get(key);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + 15 * 60_000 };
      attempts.set(key, entry);
    }
    if (++entry.count > 15) {
      res
        .status(429)
        .json({ error: "Слишком много попыток. Повторите через 15 минут." });
      return;
    }
    next();
  };
  const sessionUser = (req: Request): number | undefined => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!raw) return;
    const row = db
      .prepare(
        "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(digest(raw), Date.now());
    return row?.user_id as number | undefined;
  };
  function authorize(req: Request, res: Response, next: NextFunction) {
    const user = sessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Войдите, чтобы открыть личные данные." });
      return;
    }
    res.locals.userId = user;
    next();
  }
  function signIn(res: Response, userId: number) {
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      digest(token),
      userId,
      Date.now() + sessionLife,
    );
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookies,
      maxAge: sessionLife,
      path: "/",
    });
  }
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth", (req, res) =>
    res.json({
      initialized: !!db.prepare("SELECT id FROM users LIMIT 1").get(),
      authenticated: !!sessionUser(req),
    }),
  );
  app.post("/api/setup", authLimit, (req, res) => {
    const { login, password } = req.body ?? {};
    if (
      typeof login !== "string" ||
      !/^[a-zA-Z0-9_-]{3,40}$/.test(login) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    ) {
      res.status(400).json({
        error:
          "Логин: 3–40 латинских букв, цифр, «_» или «-». Пароль: 12–128 символов.",
      });
      return;
    }
    // BEGIN IMMEDIATE also serializes first-owner creation across application processes.
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.prepare("SELECT id FROM users LIMIT 1").get()) {
        db.exec("ROLLBACK");
        res
          .status(409)
          .json({ error: "Владелец уже создан. Войдите в аккаунт." });
        return;
      }
      const salt = randomBytes(16).toString("hex");
      const createdAt = new Date().toISOString();
      const result = db
        .prepare(
          "INSERT INTO users(login,salt,password_hash,created_at) VALUES(?,?,?,?)",
        )
        .run(
          login,
          salt,
          passwordHash(password, salt).toString("hex"),
          createdAt,
        );
      const userId = Number(result.lastInsertRowid);
      db.prepare(
        "INSERT INTO board_states(user_id,fen,updated_at) VALUES(?,?,?)",
      ).run(userId, initialFen, createdAt);
      db.exec("COMMIT");
      signIn(res, userId);
      res.status(201).json({ ok: true });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  });
  app.post("/api/login", authLimit, (req, res) => {
    const { login, password } = req.body ?? {};
    if (
      typeof login !== "string" ||
      typeof password !== "string" ||
      password.length > 128
    ) {
      res.status(400).json({ error: "Введите логин и пароль." });
      return;
    }
    const user = db
      .prepare("SELECT id,salt,password_hash FROM users WHERE login=?")
      .get(login);
    const actual = passwordHash(
      password,
      (user?.salt as string) || "missing-account-salt",
    );
    const expected = user
      ? Buffer.from(user.password_hash as string, "hex")
      : Buffer.alloc(64);
    if (!timingSafeEqual(actual, expected) || !user) {
      res.status(401).json({ error: "Неверный логин или пароль." });
      return;
    }
    signIn(res, Number(user.id));
    res.json({ ok: true });
  });
  app.post("/api/logout", authorize, (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
    res.clearCookie(cookieName, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookies,
    });
    res.json({ ok: true });
  });
  app.get("/api/profile", authorize, (_req, res) => {
    const row = db
      .prepare(
        "SELECT login,chess_username,start_rating,target_rating,created_at FROM users WHERE id=?",
      )
      .get(res.locals.userId);
    res.json(row);
  });
  const readBoard = (userId: number) =>
    db
      .prepare(
        "SELECT pgn,fen,notes,revision,updated_at FROM board_states WHERE user_id=?",
      )
      .get(userId)!;
  app.get("/api/board", authorize, (_req, res) =>
    res.json(readBoard(res.locals.userId)),
  );
  app.post("/api/board", authorize, (req, res) => {
    const old = readBoard(res.locals.userId);
    const { revision, action } = req.body ?? {};
    if (!Number.isInteger(revision) || revision !== old.revision) {
      res.status(409).json({
        error: "Позиция изменена в другом окне. Обновите доску перед повтором.",
      });
      return;
    }
    const chess = new Chess();
    if (old.pgn) chess.loadPgn(old.pgn as string);
    let notes = old.notes as string;
    if (action === "move") {
      if (chess.isGameOver()) {
        res.status(400).json({
          error:
            "Партия завершена. Начните новую партию или отмените последний ход.",
        });
        return;
      }
      const { from, to, promotion } = req.body;
      if (
        typeof from !== "string" ||
        typeof to !== "string" ||
        !/^[a-h][1-8]$/.test(from) ||
        !/^[a-h][1-8]$/.test(to) ||
        (promotion !== undefined && !["q", "r", "b", "n"].includes(promotion))
      ) {
        res.status(400).json({ error: "Некорректные координаты хода." });
        return;
      }
      try {
        chess.move({ from, to, promotion });
      } catch {
        res
          .status(400)
          .json({ error: "Этот ход невозможен по правилам шахмат." });
        return;
      }
    } else if (action === "undo") {
      if (!chess.undo()) {
        res.status(400).json({ error: "На доске ещё нет ходов." });
        return;
      }
    } else if (action === "reset") chess.reset();
    else if (action === "notes") {
      if (typeof req.body.notes !== "string" || req.body.notes.length > 10000) {
        res.status(400).json({
          error: "Заметка должна содержать не более 10 000 символов.",
        });
        return;
      }
      notes = req.body.notes;
    } else {
      res.status(400).json({ error: "Неизвестное действие с доской." });
      return;
    }
    const result = db
      .prepare(
        "UPDATE board_states SET pgn=?,fen=?,notes=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?",
      )
      .run(
        chess.history().length ? chess.pgn() : "",
        chess.fen(),
        notes,
        new Date().toISOString(),
        res.locals.userId,
        revision,
      );
    if (!result.changes) {
      res.status(409).json({ error: "Позиция уже изменена. Обновите доску." });
      return;
    }
    res.json(readBoard(res.locals.userId));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Такой запрос не поддерживается." }),
  );
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const badJson = err instanceof SyntaxError;
    res.status(badJson ? 400 : 500).json({
      error: badJson
        ? "Некорректный формат запроса."
        : "Не удалось выполнить запрос. Повторите позже.",
    });
    if (!badJson)
      console.error(
        "Ошибка серверного запроса:",
        err instanceof Error ? err.message : "неизвестная ошибка",
      );
  });
  return { app, close: () => db.close() };
}
