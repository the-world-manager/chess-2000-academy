import { test, expect, type Page } from "@playwright/test";

async function drag(page: Page, from: string, to: string, touch: boolean) {
  const a = await page.locator(`[data-square="${from}"]`).boundingBox();
  const b = await page.locator(`[data-square="${to}"]`).boundingBox();
  expect(a && b).toBeTruthy();
  // Сброс у края клетки: он должен работать и вне центра фигуры.
  const start = { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 };
  const end = { x: b!.x + b!.width * 0.85, y: b!.y + b!.height * 0.85 };
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    for (let i = 1; i <= 8; i++)
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * i) / 8,
            y: start.y + ((end.y - start.y) * i) / 8,
          },
        ],
      });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  }
}

test("Сброс фигуры на край клетки, переворот, сохранение и варианты импортированной партии", async ({
  page,
}, info) => {
  const owner = {
    login: "academy_owner",
    password: "long-secure-chess-password",
  };
  if (!(await (await page.request.get("/api/auth")).json()).initialized)
    await page.request.post("/api/setup", { data: owner });
  await page.request.post("/api/login", { data: owner });
  const before = await (await page.request.get("/api/board")).json();
  await page.request.post("/api/board", {
    data: { action: "reset", revision: before.revision },
  });
  await page.goto("/#board");
  const touch = info.project.name === "телефон";
  await expect(page.locator('[data-square="e2"]')).toHaveAttribute(
    "aria-label",
    /пешка/,
  );
  await drag(page, "e2", "e1", touch);
  await expect(page.locator('[data-square="e2"]')).toHaveAttribute(
    "aria-label",
    /белые: пешка/,
  );
  await expect(page.locator(".dragged-piece")).toHaveCount(0);
  await drag(page, "e2", "e4", touch);
  await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
    "aria-label",
    /белые: пешка/,
  );
  await expect
    .poll(async () => (await (await page.request.get("/api/board")).json()).pgn)
    .toContain("e4");
  await page.getByRole("button", { name: "Перевернуть", exact: true }).click();
  await drag(page, "e7", "e5", touch);
  await expect(page.locator('[data-square="e5"]')).toHaveAttribute(
    "aria-label",
    /чёрные: пешка/,
  );
  if (touch) await page.getByRole("tab", { name: "Ходы", exact: true }).click();
  await page
    .getByRole("button", { name: "Предыдущий ход", exact: true })
    .click();
  if (touch)
    await page.getByRole("tab", { name: "Доска", exact: true }).click();
  await expect(page.locator('[data-square="e7"]')).toBeDisabled();
  await page
    .getByRole("button", { name: "К последней позиции", exact: true })
    .click();
  await expect(page.locator('[data-square="e7"]')).toBeEnabled();
  await page.reload();
  await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
    "aria-label",
    /белые: пешка/,
  );
  await expect(page.locator('[data-square="e5"]')).toHaveAttribute(
    "aria-label",
    /чёрные: пешка/,
  );
  const board = await page.locator(".chessboard").boundingBox();
  expect(board!.width).toBeGreaterThan(touch ? 320 : 480);
  expect(
    await page
      .locator(".content")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
  ).toBe(true);
  await page.goto("/#games");
  if (!(await page.getByRole("link", { name: /test_opponent/ }).count())) {
    await page
      .getByRole("button", { name: "Синхронизировать", exact: true })
      .click();
    await expect(page.getByText(/Синхронизация завершена/)).toBeVisible();
  }
  await page
    .getByRole("link", { name: /test_opponent/ })
    .first()
    .click();
  await expect(page.locator('[data-square="e2"]')).toHaveAttribute(
    "aria-label",
    /пешка/,
  );
  const url = "/api/games/" + new URL(page.url()).hash.slice(6);
  const original = await (await page.request.get(url)).json();
  await drag(page, "e2", "e4", touch);
  await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
    "aria-label",
    /белые: пешка/,
  );
  expect((await (await page.request.get(url)).json()).pgn).toBe(original.pgn);
});
