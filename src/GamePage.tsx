import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { api } from "./api";
import { Chessboard } from "./Chessboard";
import { Modal } from "./components";
import { analyzeGame } from "./stockfish";
import {
  chartValue,
  criticalMoments,
  pvSan,
  replay,
  scoreLabel,
  type GameAnalysis,
  type PositionAnalysis,
} from "../shared/analysis";
import { timeControl, type GameRow } from "./GamesPage";
type ImportedGame = GameRow & { pgn: string; analysis: GameAnalysis | null };
export function EvaluationChart({
  positions,
  total,
  cursor,
  onSelect,
}: {
  positions: PositionAnalysis[];
  total: number;
  cursor: number;
  onSelect: (n: number) => void;
}) {
  const points = positions
    .map(
      (p, i) =>
        `${10 + (i / Math.max(1, total - 1)) * 580},${60 - (chartValue(p.score) / 1000) * 50}`,
    )
    .join(" ");
  return (
    <div className="evaluation-chart">
      <svg
        role="img"
        aria-label="График оценок Stockfish: положительная оценка — преимущество белых"
        viewBox="0 0 600 120"
      >
        <path d="M10 60H590" stroke="#718096" strokeDasharray="4 4" />
        <polyline
          data-testid="evaluation-line"
          points={points}
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
        />
        <line
          x1={10 + (cursor / Math.max(1, total - 1)) * 580}
          x2={10 + (cursor / Math.max(1, total - 1)) * 580}
          y1="8"
          y2="112"
          stroke="#f9fafb"
          opacity=".5"
        />
        {positions.map((p, i) => (
          <circle
            key={i}
            cx={10 + (i / Math.max(1, total - 1)) * 580}
            cy={60 - (chartValue(p.score) / 1000) * 50}
            r="6"
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-label={`Позиция ${i}: ${scoreLabel(p.score)}`}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(i);
            }}
          />
        ))}
      </svg>
      <small>
        Оценка за белых · график ограничен ±10 пешками, мат — край шкалы
      </small>
    </div>
  );
}
export function GamePage({ id }: { id: string }) {
  const [game, setGame] = useState<ImportedGame>(),
    [error, setError] = useState(""),
    [cursor, setCursor] = useState(0),
    [flipped, setFlipped] = useState(false),
    [variation, setVariation] = useState<Chess>(),
    [promotion, setPromotion] = useState<{ from: Square; to: Square }>();
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null),
    [live, setLive] = useState<PositionAnalysis[]>([]),
    [running, setRunning] = useState(false),
    [ms, setMs] = useState<100 | 250 | 500>(250),
    [notice, setNotice] = useState(""),
    [unsaved, setUnsaved] = useState<GameAnalysis | null>(null),
    [tab, setTab] = useState("moves"),
    [mobileView, setMobileView] = useState("board");
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    setError("");
    api<ImportedGame>("games/" + id)
      .then((data) => {
        if (mounted.current) {
          setGame(data);
          setAnalysis(data.analysis);
          setFlipped(data.color === "b");
        }
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [id]);
  const parsed = useMemo(() => (game ? replay(game.pgn) : null), [game]);
  const position = useMemo(() => {
    if (variation) return variation;
    if (!parsed) return new Chess();
    return new Chess(parsed.fens[cursor]);
  }, [parsed, cursor, variation]);
  const show = (n: number) => {
    setCursor(n);
    setVariation(undefined);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select,dialog")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        show(Math.max(0, cursor - 1));
      }
      if (e.key === "ArrowRight" && parsed) {
        e.preventDefault();
        show(Math.min(parsed.moves.length, cursor + 1));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [cursor, parsed]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) controller.current?.abort();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  const move = (from: Square, to: Square, promote?: string) => {
    const possible = position
      .moves({ square: from, verbose: true })
      .find((m) => m.to === to);
    if (!possible) return;
    if (possible.isPromotion() && !promote) {
      setPromotion({ from, to });
      return;
    }
    const next = new Chess(position.fen());
    next.move({ from, to, promotion: promote });
    setVariation(next);
    setPromotion(undefined);
  };
  async function save(result: GameAnalysis) {
    try {
      await api("games/" + id + "/analysis", result);
      if (mounted.current) {
        setUnsaved(null);
        setNotice(
          result.status === "complete"
            ? "Полный анализ сохранён."
            : "Анализ остановлен. Рассчитанные позиции сохранены.",
        );
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setUnsaved(result);
      }
    }
  }
  async function run() {
    if (!game || running) return;
    if (
      analysis?.status === "complete" &&
      !window.confirm(
        "Пересчитать сохранённый анализ? Старый полный результат останется в базе, пока новый не завершится.",
      )
    )
      return;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError("");
    setNotice("Загрузка настоящего Stockfish…");
    setLive([]);
    setTab("analysis");
    setMobileView("analysis");
    try {
      const result = await analyzeGame(
        game.pgn,
        ms,
        abort.signal,
        (positions, total) => {
          if (mounted.current) {
            setLive(positions);
            setNotice(
              positions.length < total
                ? `Рассчитано ${positions.length} / ${total} · анализируется ход ${Math.floor(positions.length / 2) + 1}`
                : "Расчёт завершён. Сохранение…",
            );
          }
        },
      );
      if (result) {
        if (result.status === "stopped" && analysis?.status === "complete") {
          if (mounted.current)
            setNotice(
              "Новый расчёт остановлен. Сохранённый полный анализ оставлен без изменений.",
            );
        } else {
          if (mounted.current) setAnalysis(result);
          await save(result);
        }
      } else if (mounted.current)
        setNotice(
          "Анализ остановлен до расчёта первой позиции. Сохранять пока нечего.",
        );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setRunning(false);
      controller.current = undefined;
    }
  }
  const critical = useMemo(
    () => (game && analysis ? criticalMoments(game.pgn, analysis) : []),
    [game, analysis],
  );
  if (!game || !parsed)
    return (
      <section className="panel">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">Загрузка партии…</p>
        )}
      </section>
    );
  const positions = running ? live : analysis?.positions || [],
    current = positions[cursor];
  return (
    <div className={`imported-game mobile-game-${mobileView}`}>
      <div className="game-heading">
        <a href="#games">← Мои партии</a>
        <strong>
          {game.color === "w" ? "Вы — белые" : "Вы — чёрные"} · {game.opponent}
        </strong>
        <span>
          {game.time_class === "rapid" ? "Rapid" : "Blitz"}{" "}
          {timeControl(game.time_control)}
        </span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          {unsaved && (
            <button className="secondary" onClick={() => void save(unsaved)}>
              Сохранить результат
            </button>
          )}
        </div>
      )}
      <div
        className="mobile-game-tabs"
        role="tablist"
        aria-label="Панели анализа"
      >
        {[
          ["board", "Доска"],
          ["moves", "Ходы"],
          ["analysis", "Оценки"],
          ["critical", "Ошибки"],
        ].map(([view, label]) => (
          <button
            key={view}
            role="tab"
            aria-selected={mobileView === view}
            onClick={() => {
              setMobileView(view);
              if (view !== "board") setTab(view);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="analysis-layout">
        <section className="panel play-surface">
          <div className="board-player">
            <strong>{flipped ? "Белые" : "Чёрные"}</strong>
            <span>
              {game.color === (flipped ? "w" : "b") ? "Вы" : game.opponent}
            </span>
            <span>
              {current && !variation ? scoreLabel(current.score) : "Без оценки"}
            </span>
          </div>
          <Chessboard
            key={`${id}-${cursor}-${variation?.fen() || ""}`}
            position={position}
            flipped={flipped}
            onMove={move}
            lastMove={
              cursor > 0 && !variation ? parsed.moves[cursor - 1] : undefined
            }
          />
          <div className="board-player">
            <strong>{flipped ? "Чёрные" : "Белые"}</strong>
            <span>
              {variation
                ? "Исследование варианта"
                : `Позиция ${cursor} из ${parsed.moves.length}`}
            </span>
          </div>
          <div className="board-toolbar">
            <button className="secondary" onClick={() => setFlipped(!flipped)}>
              Перевернуть
            </button>
            <button
              className="secondary"
              aria-label="В начало партии"
              disabled={cursor === 0 && !variation}
              onClick={() => show(0)}
            >
              ⇤
            </button>
            <button
              className="secondary"
              aria-label="Предыдущий ход"
              disabled={cursor === 0 && !variation}
              onClick={() => show(Math.max(0, cursor - 1))}
            >
              ←
            </button>
            <button
              className="secondary"
              aria-label="Следующий ход"
              disabled={cursor === parsed.moves.length}
              onClick={() => show(Math.min(parsed.moves.length, cursor + 1))}
            >
              →
            </button>
            <button
              className="secondary"
              aria-label="В конец партии"
              disabled={cursor === parsed.moves.length}
              onClick={() => show(parsed.moves.length)}
            >
              ⇥
            </button>
          </div>
          {variation ? (
            <button
              className="text-button"
              onClick={() => setVariation(undefined)}
            >
              Вернуться к партии · исходный PGN не изменён
            </button>
          ) : (
            <p className="small muted board-hint">
              Перетаскивайте фигуры или выбирайте ход двумя нажатиями. Стрелки ←
              → листают партию.
            </p>
          )}
        </section>
        <aside className="analysis-aside">
          <div className="panel engine-controls">
            <h2>Stockfish 19 Lite</h2>
            <div className="analysis-actions">
              <label>
                Нагрузка
                <select
                  aria-label="Нагрузка"
                  value={ms}
                  disabled={running}
                  onChange={(e) =>
                    setMs(Number(e.target.value) as 100 | 250 | 500)
                  }
                >
                  <option value={100}>Лёгкая · 0,1 с/позицию</option>
                  <option value={250}>Обычная · 0,25 с/позицию</option>
                  <option value={500}>Подробная · 0,5 с/позицию</option>
                </select>
              </label>
              {running ? (
                <button onClick={() => controller.current?.abort()}>
                  Остановить анализ
                </button>
              ) : (
                <button onClick={() => void run()}>Анализировать партию</button>
              )}
            </div>
            {running && (
              <progress
                aria-label="Прогресс анализа"
                value={live.length}
                max={parsed.fens.length}
              />
            )}
            <p className="save-status" role="status">
              {notice ||
                (analysis
                  ? analysis.status === "complete"
                    ? "Загружен сохранённый анализ."
                    : "Загружен неполный анализ."
                  : "Анализ запускается только по кнопке и работает в вашем браузере.")}
            </p>
          </div>
          <div className="panel analysis-details">
            <div
              className="panel-tabs"
              role="tablist"
              aria-label="Панели партии"
            >
              <button
                role="tab"
                aria-selected={tab === "moves"}
                onClick={() => setTab("moves")}
              >
                Ходы
              </button>
              <button
                role="tab"
                aria-selected={tab === "analysis"}
                onClick={() => setTab("analysis")}
              >
                Оценки
              </button>
              <button
                role="tab"
                aria-selected={tab === "critical"}
                onClick={() => setTab("critical")}
              >
                Ошибки {critical.length || ""}
              </button>
            </div>
            {tab === "moves" && (
              <div className="detail-scroll" role="tabpanel">
                <ol className="moves">
                  {Array.from(
                    { length: Math.ceil(parsed.moves.length / 2) },
                    (_, i) => (
                      <li key={i}>
                        <span>{i + 1}.</span>
                        {parsed.moves.slice(i * 2, i * 2 + 2).map((move, j) => (
                          <button
                            className={
                              cursor === i * 2 + j + 1 ? "active-move" : ""
                            }
                            key={j}
                            onClick={() => show(i * 2 + j + 1)}
                          >
                            {move.san}
                          </button>
                        ))}
                      </li>
                    ),
                  )}
                </ol>
              </div>
            )}
            {tab === "analysis" && (
              <div className="detail-scroll" role="tabpanel">
                {positions.length ? (
                  <>
                    <EvaluationChart
                      positions={positions}
                      total={parsed.fens.length}
                      cursor={cursor}
                      onSelect={show}
                    />
                    <h3>
                      Позиция {cursor}:{" "}
                      {current
                        ? scoreLabel(current.score)
                        : "ещё не рассчитана"}
                    </h3>
                    {current?.pv.length ? (
                      <>
                        <p className="small muted">
                          Лучший найденный вариант · глубина {current.depth}
                        </p>
                        <p className="engine-pv">
                          {pvSan(current.fen, current.pv)}
                        </p>
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className="muted">
                    Оценок пока нет. Запустите Stockfish по кнопке.
                  </p>
                )}
                <p className="small muted">
                  Это локальный анализ Stockfish, не официальный Chess.com Game
                  Review. Ограниченный поиск может менять оценку и пропускать
                  ошибки.
                </p>
                <a
                  className="small"
                  href="/engine/ИСТОЧНИКИ.txt"
                  target="_blank"
                  rel="noreferrer"
                >
                  Лицензия GPL v3 и исходники движка
                </a>
              </div>
            )}
            {tab === "critical" && (
              <div className="detail-scroll" role="tabpanel">
                {critical.length ? (
                  critical.map((moment) => (
                    <article className="critical" key={moment.ply}>
                      <button
                        className="text-button"
                        onClick={() => {
                          show(moment.ply);
                        }}
                      >
                        Ход {moment.number}
                        {moment.color === "b" ? "…" : "."} {moment.played} ·{" "}
                        {moment.kind}
                      </button>
                      <p>
                        Лучше: <strong>{moment.best}</strong> · оценка{" "}
                        {scoreLabel(moment.before)} → {scoreLabel(moment.after)}
                      </p>
                      <p>{moment.reason}</p>
                      <p className="muted">{moment.recommendation}</p>
                    </article>
                  ))
                ) : (
                  <p className="muted">
                    {analysis
                      ? "В рассчитанных позициях нет ошибок по выбранному порогу. Это не доказывает безошибочную игру."
                      : "Сначала выполните анализ партии."}
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
