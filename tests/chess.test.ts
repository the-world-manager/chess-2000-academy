import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
test("Превращение требует выбора фигуры и поддерживает все четыре варианта", () => {
  for (const promotion of ["q", "r", "b", "n"] as const) {
    const chess = new Chess("7k/P7/8/8/8/8/8/7K w - - 0 1");
    chess.move({ from: "a7", to: "a8", promotion });
    assert.equal(chess.get("a8")?.type, promotion);
    const restored = new Chess();
    restored.loadPgn(chess.pgn());
    assert.equal(restored.fen(), chess.fen());
  }
  assert.throws(() =>
    new Chess("7k/P7/8/8/8/8/8/7K w - - 0 1").move({ from: "a7", to: "a8" }),
  );
});
test("Король не может остаться под шахом; рокировка через атакованное поле запрещена", () => {
  const chess = new Chess("k4r2/8/8/8/8/8/8/4K2R w K - 0 1");
  assert.throws(() => chess.move({ from: "e1", to: "g1" }));
  assert.throws(() => chess.move({ from: "e1", to: "f1" }));
});
test("Мат и пат распознаются; нотация восстанавливает полную историю", () => {
  const chess = new Chess();
  ["f3", "e5", "g4", "Qh4#"].forEach((move) => chess.move(move));
  assert.equal(chess.isCheckmate(), true);
  const restored = new Chess();
  restored.loadPgn(chess.pgn());
  assert.deepEqual(restored.history(), chess.history());
  assert.equal(new Chess("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1").isStalemate(), true);
});
