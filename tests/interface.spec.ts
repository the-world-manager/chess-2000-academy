import { test, expect } from "@playwright/test";
test("Вход, доска, нотация, заметки, повторный вход и мобильная вёрстка", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const note = `Сначала контролировать центр, затем развивать фигуры. ${test.info().project.name} ${Date.now()}`;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const auth = await request.get("/api/auth");
  const initialized = (await auth.json()).initialized;
  await page.getByLabel("Логин", { exact: true }).fill("academy_owner");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("long-secure-chess-password");
  await page
    .getByRole("button", {
      name: initialized ? "Войти" : "Создать аккаунт",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Сильная игра начинается с системы" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/главная-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Начать тренировку" }).click();
  await expect(
    page.getByRole("heading", { name: "Рабочая доска" }),
  ).toBeVisible();
  const reset = page.getByRole("button", {
    name: "Начать заново",
    exact: true,
  });
  if (await reset.isEnabled()) {
    await reset.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Начать заново", exact: true })
      .click();
    await expect(page.locator('[data-square="e2"]')).toHaveAttribute(
      "aria-label",
      /пешка/,
    );
  }
  await page.locator('[data-square="e2"]').click();
  await expect(page.locator('[data-square="e4"]')).toHaveClass(/legal/);
  await page.locator('[data-square="e4"]').click();
  if (await page.getByRole("tab", { name: "Ходы", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "e4", exact: true }),
  ).toBeVisible();
  if (await page.getByRole("tab", { name: "Доска", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Доска", exact: true }).click();
  await page.locator('[data-square="e7"]').click();
  await page.locator('[data-square="e5"]').click();
  if (await page.getByRole("tab", { name: "Ходы", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await expect(page.getByText("2 полухода")).toBeVisible();
  if (await page.getByRole("tab", { name: "Доска", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Доска", exact: true }).click();
  if (await page.getByRole("tab", { name: "Ходы", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await page
    .getByRole("button", { name: "Предыдущий ход", exact: true })
    .click();
  await expect(page.locator('[data-square="e7"]')).toHaveAttribute(
    "aria-label",
    /пешка/,
  );
  await page
    .getByRole("button", { name: "В конец партии", exact: true })
    .click();
  if (await page.getByRole("tab", { name: "Заметки", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Заметки", exact: true }).click();
  await page.getByLabel("Какие ходы вы рассматривали и почему?").fill(note);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Все заметки сохранены")).toBeVisible();
  await page.reload();
  if (await page.getByRole("tab", { name: "Заметки", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Заметки", exact: true }).click();
  await expect(
    page.getByLabel("Какие ходы вы рассматривали и почему?"),
  ).toHaveValue(note);
  if (await page.getByRole("tab", { name: "Ходы", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await expect(page.getByText("2 полухода")).toBeVisible();
  if (await page.getByRole("tab", { name: "Доска", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Доска", exact: true }).click();
  await page.getByRole("button", { name: "Перевернуть", exact: true }).click();
  await expect(page.locator(".square").first()).toHaveAttribute(
    "data-square",
    "h1",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/доска-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await page.getByLabel("Логин", { exact: true }).fill("academy_owner");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("long-secure-chess-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("link", { name: "Анализ партии", exact: false }).click();
  if (await page.getByRole("tab", { name: "Ходы", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await expect(page.getByText("2 полухода")).toBeVisible();
  if (await page.getByRole("tab", { name: "Доска", exact: true }).isVisible())
    await page.getByRole("tab", { name: "Доска", exact: true }).click();
  expect(errors).toEqual([]);
});

test("Выбор превращения, клавиатура и сохранность позиции при сетевом сбое", async ({
  page,
  request,
}) => {
  const owner = {
    login: "academy_owner",
    password: "long-secure-chess-password",
  };
  if (!(await (await request.get("/api/auth")).json()).initialized) {
    expect((await request.post("/api/setup", { data: owner })).status()).toBe(
      201,
    );
  }
  expect(
    (await page.request.post("/api/login", { data: owner })).status(),
  ).toBe(200);
  let board = await (await page.request.get("/api/board")).json();
  board = await (
    await page.request.post("/api/board", {
      data: { action: "reset", revision: board.revision },
    })
  ).json();
  for (const [from, to] of [
    ["a2", "a4"],
    ["h7", "h5"],
    ["a4", "a5"],
    ["h5", "h4"],
    ["a5", "a6"],
    ["h4", "h3"],
    ["a6", "b7"],
    ["h3", "g2"],
  ]) {
    const response = await page.request.post("/api/board", {
      data: { action: "move", revision: board.revision, from, to },
    });
    expect(response.status()).toBe(200);
    board = await response.json();
  }
  await page.goto("/#board");
  await page.locator('[data-square="b7"]').focus();
  await page.keyboard.press("Enter");
  await page.locator('[data-square="a8"]').focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Превращение пешки" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-square="b7"]')).toHaveAttribute(
    "aria-label",
    /пешка/,
  );
  await page.locator('[data-square="a8"]').click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "конь", exact: true })
    .click();
  await expect(page.locator('[data-square="a8"]')).toHaveAttribute(
    "aria-label",
    /белые: конь/,
  );
  await page.reload();
  await expect(page.locator('[data-square="a8"]')).toHaveAttribute(
    "aria-label",
    /белые: конь/,
  );
  board = await (await page.request.get("/api/board")).json();
  expect(
    (
      await page.request.post("/api/board", {
        data: { action: "reset", revision: board.revision },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByText("0 полуходов")).toBeVisible();
  await page.route("**/api/board", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.locator('[data-square="e2"]').click();
  await page.locator('[data-square="e4"]').click();
  await expect(page.getByRole("alert")).toContainText("Нет связи с сервером");
  await expect(page.locator('[data-square="e2"]')).toHaveAttribute(
    "aria-label",
    /пешка/,
  );
  await expect(page.getByText("0 полуходов")).toBeVisible();
  await page.unroute("**/api/board");
  await page.locator('[data-square="e4"]').click();
  await expect(page.getByText("1 полуход")).toBeVisible();
});
