import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../server/app.js";
import { sqliteStorage } from "../server/storage.js";
import { fixtureFetch, fixturePgn } from "./helpers/chess-fixture.js";
import { ChessApiError, startSync, stepSync } from "../server/chesscom.js";
import {
  replay,
  chartValue,
  validateAnalysis,
  criticalMoments,
  type GameAnalysis,
} from "../shared/analysis.js";
import { parseInfo } from "../src/stockfish.js";
const owner = { login: "stage2", password: "long-stage-two-test-password" };
async function setup() {
  const db =
    process.env.TEST_BACKEND === "postgres"
      ? await (await import("./helpers/postgres.js")).testPostgres()
      : sqliteStorage(":memory:");
  const application = await createApplication(db, {
    ownerLogin: owner.login,
    ownerPassword: owner.password,
    chessFetcher: fixtureFetch,
  });
  const server = application.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = "";
  const request = async (path: string, body?: unknown, auth = true) => {
    const res = await fetch(base + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(auth ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.headers.get("set-cookie"))
      cookie = res.headers.get("set-cookie")!.split(";")[0];
    return { status: res.status, data: await res.json() };
  };
  await request("login", owner);
  return {
    db,
    request,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await application.close();
    },
  };
}
test("Chess.com: контрольный импорт, дедупликация, раздельные Rapid/Blitz и фильтры", async () => {
  const app = await setup();
  try {
    for (let round = 0; round < 2; round++) {
      const job = (await app.request("chess/sync", { control: "rapid" })).data;
      const done = await app.request("chess/sync/step", { id: job.id });
      assert.equal(done.status, 200);
      assert.equal(done.data.imported, round === 0 ? 1 : 0);
    }
    assert.equal((await app.request("games?control=rapid")).data.total, 1);
    assert.equal((await app.request("games?control=blitz")).data.total, 0);
    const blitz = (await app.request("chess/sync", { control: "blitz" })).data;
    await app.request("chess/sync/step", { id: blitz.id });
    assert.equal((await app.request("games?control=blitz")).data.total, 1);
    assert.equal((await app.request("chess")).data.rapid.last.rating, 1500);
    assert.equal((await app.request("games?result=win")).data.total, 0);
    assert.equal((await app.request("games?time=900%2B10")).data.total, 1);
    assert.equal((await app.request("games?time=180")).data.total, 0);
    assert.equal(
      (
        await app.request(
          "games?color=w&result=loss&from=2026-10-01&to=2026-10-31",
        )
      ).data.total,
      1,
    );
    const list = (await app.request("games")).data;
    const detail = (await app.request("games/" + list.games[0].id)).data;
    assert.equal(detail.pgn, fixturePgn);
    assert.equal(detail.analysis, null);
    assert.equal(replay(detail.pgn).chess.isCheckmate(), true);
    assert.equal((await app.request("games", undefined, false)).status, 401);
    assert.equal((await app.request("games/not-owned")).status, 404);
  } finally {
    await app.close();
  }
});
test("Chess.com: ошибка и 429 не теряют партии, ожидание сохраняется в базе", async () => {
  const app = await setup();
  try {
    let job = await startSync(app.db, 1, "rapid", fixtureFetch);
    await stepSync(app.db, 1, job.id, fixtureFetch);
    const before = (await app.request("games")).data.total;
    await assert.rejects(
      () =>
        startSync(app.db, 1, "rapid", async () => {
          throw new ChessApiError(429, "Ограничение", 60);
        }),
      /Ограничение/,
    );
    assert.equal((await app.request("games")).data.total, before);
    await assert.rejects(
      () => startSync(app.db, 1, "rapid", fixtureFetch),
      /Подождите/,
    );
  } finally {
    await app.close();
  }
});
test("UCI: оценка нормализуется за белых, мат и ограниченные оценки не выдумываются", () => {
  assert.deepEqual(
    parseInfo("info depth 8 score cp 120 nodes 10 pv e7e5", "b")?.score,
    { type: "cp", value: -120 },
  );
  assert.deepEqual(parseInfo("info depth 8 score mate 2 pv d8h4", "b")?.score, {
    type: "mate",
    value: -2,
    winner: "b",
  });
  assert.equal(
    parseInfo("info depth 8 score cp 20 lowerbound pv e2e4", "w"),
    null,
  );
  assert.equal(chartValue({ type: "cp", value: 250 }), 250);
  assert.equal(chartValue({ type: "mate", value: -2, winner: "b" }), -1000);
});
test("Анализ: позиции и варианты проверяются перед сохранением", () => {
  const { fens } = replay(fixturePgn);
  const value: GameAnalysis = {
    version: 1,
    engine: "Stockfish 19 Lite",
    status: "stopped",
    options: { ms: 100, depth: 14, hash: 16, threads: 1 },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    positions: [
      {
        ply: 0,
        fen: fens[0],
        score: { type: "cp", value: 20 },
        depth: 4,
        bestMove: "e2e4",
        pv: ["e2e4", "e7e5"],
      },
    ],
  };
  assert.equal(validateAnalysis(fixturePgn, value), value);
  assert.throws(() =>
    validateAnalysis(fixturePgn, { ...value, status: "complete" }),
  );
  assert.throws(() =>
    validateAnalysis(fixturePgn, {
      ...value,
      positions: [{ ...value.positions[0], fen: fens[1] }],
    }),
  );
  assert.throws(() =>
    validateAnalysis(fixturePgn, {
      ...value,
      positions: [{ ...value.positions[0], pv: ["e2e5"] }],
    }),
  );
  assert.equal(criticalMoments(fixturePgn, value).length, 0);
});
