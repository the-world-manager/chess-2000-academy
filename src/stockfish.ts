import { Chess } from "chess.js";
import {
  replay,
  type Score,
  type GameAnalysis,
  type PositionAnalysis,
} from "../shared/analysis";
export function parseInfo(line: string, turn: "w" | "b") {
  const score = line.match(/\bscore (cp|mate) (-?\d+)/),
    depth = line.match(/\bdepth (\d+)/),
    pv = line.match(/\bpv (.+)$/);
  if (
    !line.startsWith("info ") ||
    !score ||
    !depth ||
    /\b(lowerbound|upperbound)\b/.test(line)
  )
    return null;
  const n = Number(score[2]),
    sign = turn === "w" ? 1 : -1;
  const normalized: Score =
    score[1] === "cp"
      ? { type: "cp", value: n * sign }
      : {
          type: "mate",
          value: n * sign,
          winner: n > 0 ? turn : turn === "w" ? "b" : "w",
        };
  return {
    score: normalized,
    depth: Number(depth[1]),
    pv: pv ? pv[1].trim().split(/\s+/).slice(0, 16) : [],
  };
}
export async function analyzeGame(
  pgn: string,
  ms: 100 | 250 | 500,
  signal: AbortSignal,
  onProgress: (positions: PositionAnalysis[], total: number) => void,
): Promise<GameAnalysis | null> {
  if (typeof WebAssembly === "undefined" || typeof Worker === "undefined")
    throw new Error(
      "Браузер не поддерживает WebAssembly или фоновые вычисления. Откройте сайт в современном браузере.",
    );
  const { moves, fens } = replay(pgn);
  if (fens.length > 601)
    throw new Error("Поддерживается анализ партий до 600 полуходов.");
  const worker = new Worker("/engine/stockfish-19-lite-single.js");
  let rejectCurrent: ((error: Error) => void) | undefined;
  const abort = () => {
    worker.terminate();
    rejectCurrent?.(new DOMException("Анализ остановлен.", "AbortError"));
  };
  const failure = () =>
    rejectCurrent?.(
      new Error(
        "Не удалось выполнить Stockfish. Проверьте загрузку движка и доступную память браузера.",
      ),
    );
  signal.addEventListener("abort", abort);
  worker.addEventListener("error", failure);
  const wait = (
    command: string,
    accept: (line: string) => boolean,
    timeout = 15000,
  ) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Анализ остановлен.", "AbortError"));
        return;
      }
      const finish = (error?: Error) => {
        clearTimeout(timer);
        worker.removeEventListener("message", listener);
        rejectCurrent = undefined;
        error ? reject(error) : resolve();
      };
      const listener = (event: MessageEvent) => {
        for (const line of String(event.data).split("\n"))
          if (accept(line)) {
            finish();
            break;
          }
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "Stockfish не ответил вовремя. Повторите с меньшей нагрузкой или закройте другие вкладки.",
            ),
          ),
        timeout,
      );
      rejectCurrent = (error) => finish(error);
      worker.addEventListener("message", listener);
      worker.postMessage(command);
    });
  const startedAt = new Date().toISOString();
  const positions: PositionAnalysis[] = [];
  let stopped = false;
  try {
    await wait("uci", (line) => line === "uciok");
    worker.postMessage("setoption name Hash value 16");
    worker.postMessage("ucinewgame");
    await wait("isready", (line) => line === "readyok");
    onProgress([], fens.length);
    const chess = new Chess(fens[0]);
    const prefix: string[] = [];
    for (let ply = 0; ply < fens.length; ply++) {
      if (signal.aborted)
        throw new DOMException("Анализ остановлен.", "AbortError");
      if (ply) {
        chess.move(moves[ply - 1].san);
        prefix.push(
          moves[ply - 1].from +
            moves[ply - 1].to +
            (moves[ply - 1].promotion || ""),
        );
      }
      if (chess.isGameOver()) {
        const score: Score = chess.isCheckmate()
          ? { type: "mate", value: 0, winner: chess.turn() === "w" ? "b" : "w" }
          : { type: "cp", value: 0 };
        positions.push({
          ply,
          fen: chess.fen(),
          score,
          depth: 0,
          bestMove: null,
          pv: [],
        });
      } else {
        let info: ReturnType<typeof parseInfo> = null;
        let best: string | null = null;
        worker.postMessage(
          `position fen ${fens[0]}${prefix.length ? " moves " + prefix.join(" ") : ""}`,
        );
        await wait(
          `go movetime ${ms} depth 14`,
          (line) => {
            const parsed = parseInfo(line, chess.turn());
            if (parsed) info = parsed;
            if (line.startsWith("bestmove ")) {
              best = line.split(/\s+/)[1];
              return true;
            }
            return false;
          },
          Math.max(15000, ms * 15),
        );
        // При коротком бюджете поиск может завершиться до первой подтверждённой PV.
        // Один ограниченный поиск глубины 1 даёт настоящий результат вместо заглушки.
        if (
          !info ||
          !best ||
          !(info as NonNullable<ReturnType<typeof parseInfo>>).pv.length ||
          (info as NonNullable<ReturnType<typeof parseInfo>>).pv[0] !== best
        ) {
          info = null;
          best = null;
          await wait("go depth 1", (line) => {
            const parsed = parseInfo(line, chess.turn());
            if (parsed) info = parsed;
            if (line.startsWith("bestmove ")) {
              best = line.split(/\s+/)[1];
              return true;
            }
            return false;
          });
        }
        const value = info as ReturnType<typeof parseInfo>;
        if (!value || !best || !value.pv.length || value.pv[0] !== best)
          throw new Error(
            `Stockfish не подтвердил оценку позиции ${ply}. Результат не подменяется.`,
          );
        positions.push({
          ply,
          fen: chess.fen(),
          score: value.score,
          depth: value.depth,
          bestMove: best,
          pv: value.pv,
        });
      }
      onProgress([...positions], fens.length);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      stopped = true;
    else throw error;
  } finally {
    worker.terminate();
    signal.removeEventListener("abort", abort);
    worker.removeEventListener("error", failure);
  }
  if (!positions.length) return null;
  return {
    version: 1,
    engine: "Stockfish 19 Lite",
    status: stopped ? "stopped" : "complete",
    options: { ms, depth: 14, hash: 16, threads: 1 },
    positions,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
