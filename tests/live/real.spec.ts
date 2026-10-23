import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
test("Реальная партия alexander_gusev: импорт, PGN, Stockfish WASM, сохранение и восстановление", async ({
  page,
}) => {
  const capture = JSON.parse(
    readFileSync(".verification/real-chesscom.json", "utf8"),
  );
  expect(capture.source).toBe(
    "https://api.chess.com/pub/player/alexander_gusev",
  );
  expect(capture.rawGame.url).toBe(capture.game.source_url);
  const credentials = {
    login: "live_browser",
    password: "long-local-live-browser-password",
  };
  if (!(await (await page.request.get("/api/auth")).json()).initialized)
    expect(
      (await page.request.post("/api/setup", { data: credentials })).status(),
    ).toBe(201);
  expect(
    (await page.request.post("/api/login", { data: credentials })).status(),
  ).toBe(200);
  await page.goto("/#games");
  await page
    .getByRole("button", { name: "Синхронизировать", exact: true })
    .click();
  await expect(page.getByText(/Синхронизация завершена/)).toBeVisible();
  await expect(page.locator('a[href^="#game/"]')).toHaveCount(1);
  await page
    .getByRole("button", { name: "Синхронизировать", exact: true })
    .click();
  await expect(page.getByText(/Добавлено: 0/)).toBeVisible();
  await page.locator('a[href^="#game/"]').click();
  await page.getByRole("tab", { name: "Оценки", exact: true }).click();
  const id = new URL(page.url()).hash.slice(6);
  let game = await (await page.request.get("/api/games/" + id)).json();
  expect(game.pgn).toBe(capture.rawGame.pgn);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Нагрузка", { exact: true }).selectOption("100");
  const started = Date.now();
  await page
    .getByRole("button", { name: "Анализировать партию", exact: true })
    .click();
  await expect(
    page.getByText("Полный анализ сохранён.", { exact: true }),
  ).toBeVisible({ timeout: 75000 });
  game = await (await page.request.get("/api/games/" + id)).json();
  expect(game.analysis.status).toBe("complete");
  expect(game.analysis.positions).toHaveLength(capture.plies + 1);
  expect(game.analysis.positions.some((p: any) => p.depth > 0)).toBeTruthy();
  expect(
    game.analysis.positions.every((p: any) => Number.isFinite(p.score.value)),
  ).toBeTruthy();
  const points = (await page
    .getByTestId("evaluation-line")
    .getAttribute("points"))!.split(" ");
  expect(points).toHaveLength(capture.plies + 1);
  const end = game.analysis.positions.at(-1).score;
  const cp =
    end.type === "cp" ? end.value : end.winner === "w" ? 100000 : -100000;
  expect(points.at(-1)).toBe(
    `590,${60 - Math.max(-1000, Math.min(1000, cp)) / 20}`,
  );
  const elapsed = Date.now() - started;
  const hash = new URL(page.url()).hash;
  await page.reload();
  await page.getByRole("tab", { name: "Оценки", exact: true }).click();
  expect(
    (await (await page.request.get("/api/games/" + id)).json()).analysis,
  ).toEqual(game.analysis);
  await page.getByRole("link", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await page.getByLabel("Логин", { exact: true }).fill(credentials.login);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.goto("/" + hash);
  await page.getByRole("tab", { name: "Оценки", exact: true }).click();
  await expect(page.getByText("Загружен сохранённый анализ.")).toBeVisible();
  expect(
    (await (await page.request.get("/api/games/" + id)).json()).analysis,
  ).toEqual(game.analysis);
  mkdirSync(".verification", { recursive: true });
  writeFileSync(
    `.verification/stockfish-real-${process.env.E2E_DATABASE_URL ? "postgres" : "sqlite"}-${test.info().project.name}.json`,
    JSON.stringify(
      {
        source: capture.game.source_url,
        capturedAt: capture.fetchedAt,
        engine: game.analysis.engine,
        positions: game.analysis.positions.length,
        milliseconds: elapsed,
        depths: game.analysis.positions.map((p: any) => p.depth),
        result: game.analysis,
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: `test-results/реальная-партия-${test.info().project.name}.png`,
    fullPage: true,
  });
});
