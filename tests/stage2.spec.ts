import { test, expect } from "@playwright/test";
const owner = {
  login: "academy_owner",
  password: "long-secure-chess-password",
};
async function login(page: any) {
  if (!(await (await page.request.get("/api/auth")).json()).initialized)
    expect(
      (await page.request.post("/api/setup", { data: owner })).status(),
    ).toBe(201);
  expect(
    (await page.request.post("/api/login", { data: owner })).status(),
  ).toBe(200);
}
test("Контрольный импорт без дублей, PGN, настоящий WASM Stockfish, сохранение и повторный вход", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  const engineRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/engine/stockfish"))
      engineRequests.push(request.url());
  });
  await page.goto("/#games");
  await page
    .getByRole("button", { name: "Синхронизировать", exact: true })
    .click();
  await expect(page.getByText(/Синхронизация завершена/)).toBeVisible();
  await expect(page.getByRole("link", { name: /test_opponent/ })).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: "Синхронизировать", exact: true })
    .click();
  await expect(page.getByText(/Добавлено: 0/)).toBeVisible();
  await page.getByRole("link", { name: /test_opponent/ }).click();
  if (await page.getByRole("tab", { name: "Ходы", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Qh4#", exact: true }),
  ).toBeVisible();
  expect(engineRequests).toHaveLength(0);
  await page.getByLabel("Нагрузка", { exact: true }).selectOption("100");
  const began = Date.now();
  await page
    .getByRole("button", { name: "Анализировать партию", exact: true })
    .click();
  await expect(
    page.getByText("Полный анализ сохранён.", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(engineRequests.some((url) => url.endsWith(".wasm"))).toBeTruthy();
  await expect(page.getByTestId("evaluation-line")).toBeVisible();
  const points = await page
    .getByTestId("evaluation-line")
    .getAttribute("points");
  expect(points?.split(" ")).toHaveLength(5);
  expect(points?.split(" ").at(-1)).toBe("590,110");
  const gameId = new URL(page.url()).hash.slice(6);
  const saved = (await (await page.request.get("/api/games/" + gameId)).json())
    .analysis;
  expect(saved.positions[3].bestMove).toBe("d8h4");
  expect(saved.positions[3].score.type).toBe("mate");
  expect(saved.positions[3].score.winner).toBe("b");
  await test.info().attach("Реальный Stockfish: измерение", {
    body: JSON.stringify({
      milliseconds: Date.now() - began,
      positions: saved.positions.length,
      depths: saved.positions.map((p: any) => p.depth),
      engine: saved.engine,
    }),
    contentType: "application/json",
  });
  if (await page.getByRole("tab", { name: "Доска", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Доска", exact: true }).click();
  await page
    .getByRole("button", { name: "В конец партии", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Предыдущий ход", exact: true })
    .click();
  if (await page.getByRole("tab", { name: "Оценки", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Оценки", exact: true }).click();
  await expect(page.locator(".engine-pv")).toContainText("Qh4#");
  const hash = new URL(page.url()).hash;
  await page.reload();
  await page.getByRole("tab", { name: "Оценки", exact: true }).click();
  await expect(page.getByText("Загружен сохранённый анализ.")).toBeVisible();
  await page.getByRole("link", { name: "Настройки", exact: false }).click();
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await page.getByLabel("Логин", { exact: true }).fill(owner.login);
  await page.getByLabel("Пароль", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.goto("/" + hash);
  await page.getByRole("tab", { name: "Оценки", exact: true }).click();
  await expect(page.getByText("Загружен сохранённый анализ.")).toBeVisible();
  expect(
    (await (await page.request.get("/api/games/" + gameId)).json()).analysis,
  ).toEqual(saved);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await page
      .locator(".board-workspace .content")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/анализ-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("Остановка настоящего Stockfish и перетаскивание фигуры", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#games");
  await page.getByLabel("Контроль", { exact: true }).selectOption("blitz");
  const link = page.getByRole("link", { name: /test_opponent/ });
  if (!(await link.count())) {
    await page
      .getByRole("button", { name: "Синхронизировать", exact: true })
      .click();
    await expect(page.getByText(/Синхронизация завершена/)).toBeVisible();
  }
  await link.click();
  await page.getByRole("tab", { name: "Оценки", exact: true }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Нагрузка", { exact: true }).selectOption("500");
  await page
    .getByRole("button", { name: "Анализировать партию", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Остановить анализ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Прогресс анализа" }),
  ).not.toHaveAttribute("value", "0");
  await page
    .getByRole("button", { name: "Остановить анализ", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Анализировать партию", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Анализ остановлен. Рассчитанные позиции сохранены.", {
      exact: true,
    }),
  ).toBeVisible();
  const partial = (
    await (
      await page.request.get("/api/games/" + new URL(page.url()).hash.slice(6))
    ).json()
  ).analysis;
  expect(partial.status).toBe("stopped");
  expect(partial.positions.length).toBeGreaterThan(0);
  expect(partial.positions.length).toBeLessThan(21);
  await page.goto("/#board");
  const before = await (await page.request.get("/api/board")).json();
  await page.request.post("/api/board", {
    data: { action: "reset", revision: before.revision },
  });
  await page.reload();
  const source = await page.locator('[data-square="e2"]').boundingBox(),
    target = await page.locator('[data-square="e4"]').boundingBox();
  expect(source && target).toBeTruthy();
  if (test.info().project.name === "телефон") {
    const cdp = await page.context().newCDPSession(page);
    const from = {
        x: source!.x + source!.width / 2,
        y: source!.y + source!.height / 2,
      },
      to = {
        x: target!.x + target!.width / 2,
        y: target!.y + target!.height / 2,
      };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [from],
    });
    for (let i = 1; i <= 12; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * i) / 12,
            y: from.y + ((to.y - from.y) * i) / 12,
          },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(
      source!.x + source!.width / 2,
      source!.y + source!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target!.x + target!.width / 2,
      target!.y + target!.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
  }
  if (await page.getByRole("tab", { name: "Ходы", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "e4", exact: true }),
  ).toBeVisible();
});
