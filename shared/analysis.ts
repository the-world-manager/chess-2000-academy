import { Chess } from "chess.js";
export type Score =
  | { type: "cp"; value: number }
  | { type: "mate"; value: number; winner: "w" | "b" };
export type PositionAnalysis = {
  ply: number;
  fen: string;
  score: Score;
  depth: number;
  bestMove: string | null;
  pv: string[];
};
export type GameAnalysis = {
  version: 1;
  engine: "Stockfish 19 Lite";
  status: "complete" | "stopped";
  options: { ms: number; depth: number; hash: 16; threads: 1 };
  positions: PositionAnalysis[];
  startedAt: string;
  completedAt: string;
};
export function replay(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true });
  return {
    chess,
    moves,
    fens: [moves[0]?.before || chess.fen(), ...moves.map((m) => m.after)],
  };
}
export function uciMove(chess: Chess, uci: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))
    throw new Error("Некорректный ход движка.");
  return chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4],
  });
}
export function pvSan(fen: string, pv: string[]) {
  const chess = new Chess(fen);
  return pv.map((move) => uciMove(chess, move).san).join(" ");
}
export const scoreValue = (score: Score) =>
  score.type === "cp"
    ? score.value
    : (score.winner === "w" ? 1 : -1) * (100000 - Math.abs(score.value));
export const chartValue = (score: Score) =>
  Math.max(-1000, Math.min(1000, scoreValue(score)));
export const scoreLabel = (score: Score) =>
  score.type === "cp"
    ? `${score.value > 0 ? "+" : ""}${(score.value / 100).toFixed(2)}`
    : score.value === 0
      ? `Мат ${score.winner === "w" ? "белых" : "чёрных"}`
      : `${score.winner === "w" ? "+" : "−"}M${Math.abs(score.value)}`;
export function criticalMoments(pgn: string, analysis: GameAnalysis) {
  const { moves } = replay(pgn);
  return moves.flatMap((move, index) => {
    const before = analysis.positions[index],
      after = analysis.positions[index + 1];
    if (!before || !after || !before.bestMove) return [];
    const sign = move.color === "w" ? 1 : -1,
      loss = Math.max(
        0,
        sign * (scoreValue(before.score) - scoreValue(after.score)),
      );
    const probability = (value: number) =>
      1 / (1 + Math.exp(-Math.max(-10000, Math.min(10000, value)) / 400));
    const drop =
      probability(sign * scoreValue(before.score)) -
      probability(sign * scoreValue(after.score));
    if (loss < 100 || drop < 0.08) return [];
    let reason =
      "Движок нашёл более сильное продолжение. Точная тактическая или стратегическая причина надёжно не установлена.";
    if (
      after.score.type === "mate" &&
      after.score.winner !== move.color &&
      (before.score.type !== "mate" || before.score.winner === move.color)
    )
      reason =
        "После сыгранного хода Stockfish нашёл форсированный мат в пользу соперника.";
    else if (
      before.score.type === "mate" &&
      before.score.winner === move.color &&
      (after.score.type !== "mate" || after.score.winner !== move.color)
    )
      reason =
        "До хода Stockfish находил форсированный мат; сыгранный ход не сохраняет найденное матовое продолжение.";
    const best = new Chess(move.before);
    const bestSan = uciMove(best, before.bestMove).san;
    return [
      {
        ply: index,
        number: Math.floor(index / 2) + 1,
        color: move.color,
        played: move.san,
        best: bestSan,
        before: before.score,
        after: after.score,
        loss,
        kind: drop >= 0.2 ? "Грубая ошибка" : "Ошибка",
        reason,
        recommendation:
          "Перед ходом проверяйте шахи, взятия и угрозы соперника. Повторите эту позицию и сравните свой расчёт с вариантом движка.",
        pv: before.pv,
        fen: move.before,
      },
    ];
  });
}
export function validateAnalysis(pgn: string, value: unknown): GameAnalysis {
  if (!value || typeof value !== "object")
    throw new Error("Нет результата анализа.");
  const a = value as GameAnalysis;
  const { fens, moves } = replay(pgn);
  const historyGame = new Chess(fens[0]);
  if (
    a.version !== 1 ||
    a.engine !== "Stockfish 19 Lite" ||
    !["complete", "stopped"].includes(a.status) ||
    !a.options ||
    ![100, 250, 500].includes(a.options.ms) ||
    a.options.depth !== 14 ||
    a.options.hash !== 16 ||
    a.options.threads !== 1 ||
    !Array.isArray(a.positions) ||
    !a.positions.length ||
    a.positions.length > fens.length ||
    fens.length > 601
  )
    throw new Error("Некорректные параметры анализа.");
  if (a.status === "complete" && a.positions.length !== fens.length)
    throw new Error("Полный анализ должен содержать все позиции партии.");
  if (
    !Number.isFinite(Date.parse(a.startedAt)) ||
    !Number.isFinite(Date.parse(a.completedAt)) ||
    Date.parse(a.completedAt) < Date.parse(a.startedAt)
  )
    throw new Error("Некорректное время анализа.");
  a.positions.forEach((p, index) => {
    if (index) historyGame.move(moves[index - 1].san);
    if (
      p.ply !== index ||
      p.fen !== fens[index] ||
      !Number.isInteger(p.depth) ||
      p.depth < 0 ||
      p.depth > 64 ||
      !p.score ||
      !Number.isFinite(p.score.value) ||
      !Number.isInteger(p.score.value) ||
      Math.abs(p.score.value) > 100000 ||
      !["cp", "mate"].includes(p.score.type) ||
      (p.score.type === "mate" && !["w", "b"].includes(p.score.winner)) ||
      !Array.isArray(p.pv) ||
      p.pv.length > 16
    )
      throw new Error("Результат не соответствует позициям партии.");
    const chess = new Chess(p.fen);
    if (p.bestMove !== null) {
      if (p.pv[0] !== p.bestMove)
        throw new Error("Лучший ход не совпадает с вариантом.");
      pvSan(p.fen, p.pv);
    } else if (!historyGame.isGameOver())
      throw new Error("В незавершённой позиции отсутствует лучший ход.");
  });
  return a;
}
