import { useEffect, useMemo, useState } from "react";
import { Chess, type Square, type PieceSymbol, type Color } from "chess.js";
import { api, type BoardState } from "./api";
import { PageHeading, Modal } from "./components";
import { Chessboard } from "./Chessboard";
export function BoardPage() {
  const [state, setState] = useState<BoardState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState("");
  const [promotion, setPromotion] = useState<{ from: Square; to: Square }>();
  const [resetting, setResetting] = useState(false);
  const [mobileView, setMobileView] = useState("board");
  const load = async () => {
    setError("");
    try {
      const data = await api<BoardState>("board");
      setState(data);
      setNotes(data.notes);
      setCursor(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!state || notes === state.notes) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        target &&
        target.getAttribute("href") !== "#board" &&
        target.getAttribute("href") !== "#main" &&
        !window.confirm(
          "Уйти со страницы? Несохранённые заметки будут потеряны.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [notes, state]);
  const game = useMemo(() => {
    const chess = new Chess();
    if (state?.pgn) chess.loadPgn(state.pgn);
    return chess;
  }, [state]);
  const history = game.history();
  const atEnd = cursor === null || cursor === history.length;
  const position = useMemo(() => {
    if (cursor === null) return game;
    const chess = new Chess();
    game
      .history()
      .slice(0, cursor)
      .forEach((move) => chess.move(move));
    return chess;
  }, [game, cursor]);
  async function change(action: string, extra: Record<string, unknown> = {}) {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<BoardState>("board", {
        action,
        revision: state.revision,
        ...extra,
      });
      setState(result);
      setPromotion(undefined);
      setCursor(null);
      setNotice(
        action === "notes"
          ? "Заметки сохранены на сервере."
          : "Позиция сохранена на сервере.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  let status = position.turn() === "w" ? "Ход белых" : "Ход чёрных";
  if (position.isCheckmate())
    status = `Мат. Победили ${position.turn() === "w" ? "чёрные" : "белые"}.`;
  else if (position.isStalemate()) status = "Ничья: пат.";
  else if (position.isThreefoldRepetition())
    status = "Ничья: троекратное повторение.";
  else if (position.isInsufficientMaterial())
    status = "Ничья: недостаточно материала.";
  else if (position.isDraw()) status = "Ничья по правилу 50 ходов.";
  else if (position.isCheck()) status += " · Шах";
  const verbose = position.history({ verbose: true });
  const last = verbose.at(-1);
  return (
    <>
      <PageHeading
        eyebrow="ЛАБОРАТОРИЯ ПОЗИЦИЙ"
        title="Рабочая доска"
        text="Проверяйте идеи. Сравнивайте варианты. Сохраняйте выводы."
        action={<span className="badge">Самостоятельная работа</span>}
      />
      <div className="work-count">
        {" "}
        <span className="tiny-badge">
          {history.length}{" "}
          {history.length % 100 >= 11 && history.length % 100 <= 14
            ? "полуходов"
            : history.length % 10 === 1
              ? "полуход"
              : [2, 3, 4].includes(history.length % 10)
                ? "полухода"
                : "полуходов"}
        </span>
      </div>
      <div
        className="mobile-game-tabs"
        role="tablist"
        aria-label="Панели рабочей доски"
      >
        {[
          ["board", "Доска"],
          ["moves", "Ходы"],
          ["notes", "Заметки"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mobileView === id}
            onClick={() => setMobileView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button
            className="secondary"
            onClick={() => {
              if (
                notes === state?.notes ||
                window.confirm(
                  "Загрузить доску с сервера? Несохранённые заметки будут заменены.",
                )
              )
                void load();
            }}
          >
            Обновить доску
          </button>
        </div>
      )}
      {!state ? (
        <section className="panel" role="status">
          {error ? "Доска пока недоступна." : "Загрузка сохранённой позиции…"}
        </section>
      ) : (
        <div className={`board-layout mobile-work-${mobileView}`}>
          <section className="board-panel panel">
            <div className="board-player">
              <span className="avatar">{flipped ? "Б" : "Ч"}</span>
              <strong>{flipped ? "Белые" : "Чёрные"}</strong>
              <span className="muted small">Свободная доска</span>
            </div>
            <Chessboard
              key={`${state.revision}-${cursor ?? "end"}`}
              position={position}
              flipped={flipped}
              disabled={busy}
              lastMove={last}
              onMove={(from, to) => {
                if (!atEnd || position.isGameOver()) return;
                const candidate = position
                  .moves({ square: from, verbose: true })
                  .find((move) => move.to === to);
                if (candidate?.isPromotion()) setPromotion({ from, to });
                else if (candidate) void change("move", { from, to });
              }}
            />

            <div className="board-player">
              <span className="avatar">{flipped ? "Ч" : "Б"}</span>
              <strong>{flipped ? "Чёрные" : "Белые"}</strong>
              <span className="turn-status">{status}</span>
            </div>
            <div className="board-toolbar">
              <button
                className="secondary"
                onClick={() => {
                  setFlipped(!flipped);
                }}
              >
                Перевернуть
              </button>
              <button
                className="secondary"
                disabled={!history.length || busy}
                onClick={() => void change("undo")}
              >
                Отменить ход
              </button>
              <button
                className="text-button"
                disabled={busy || !history.length}
                onClick={() => setResetting(true)}
              >
                Начать заново
              </button>
            </div>
            <p className="small muted">
              Выберите фигуру и клетку назначения. Для нового хода вернитесь к
              последней позиции.
            </p>
            <p className="save-status" role="status">
              {busy
                ? "Сохранение…"
                : notice ||
                  `Сохранено (МСК): ${new Date(state.updated_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`}
            </p>
          </section>
          <div className="board-aside">
            <section className="panel notation">
              <div className="section-heading">
                <h2>Ходы партии</h2>
              </div>
              {history.length ? (
                <ol className="moves">
                  {Array.from(
                    { length: Math.ceil(history.length / 2) },
                    (_, i) => (
                      <li key={i}>
                        <span>{i + 1}.</span>
                        {history.slice(i * 2, i * 2 + 2).map((san, j) => (
                          <button
                            className={
                              (cursor ?? history.length) === i * 2 + j + 1
                                ? "active-move"
                                : ""
                            }
                            key={j}
                            onClick={() => {
                              setCursor(i * 2 + j + 1);
                            }}
                          >
                            {san}
                          </button>
                        ))}
                      </li>
                    ),
                  )}
                </ol>
              ) : (
                <p className="muted notation-empty">
                  Сделайте первый ход — здесь появится полная нотация.
                </p>
              )}
              <div className="replay" aria-label="Просмотр ходов">
                <button
                  className="secondary"
                  aria-label="В начало партии"
                  disabled={!history.length}
                  onClick={() => {
                    setCursor(0);
                  }}
                >
                  ⇤
                </button>
                <button
                  className="secondary"
                  aria-label="Предыдущий ход"
                  disabled={(cursor ?? history.length) === 0}
                  onClick={() => {
                    setCursor((cursor ?? history.length) - 1);
                  }}
                >
                  ←
                </button>
                <span>
                  {cursor ?? history.length} / {history.length}
                </span>
                <button
                  className="secondary"
                  aria-label="Следующий ход"
                  disabled={atEnd}
                  onClick={() => {
                    setCursor((cursor ?? 0) + 1);
                  }}
                >
                  →
                </button>
                <button
                  className="secondary"
                  aria-label="В конец партии"
                  disabled={atEnd}
                  onClick={() => {
                    setCursor(null);
                  }}
                >
                  ⇥
                </button>
              </div>
              {!atEnd && (
                <p className="small muted">
                  Просмотр истории. Для продолжения вернитесь в конец партии.
                </p>
              )}
            </section>
            <section className="panel notes">
              <h2>Мои выводы</h2>
              <label htmlFor="notes" className="muted small">
                Какие ходы вы рассматривали и почему?
              </label>
              <textarea
                id="notes"
                value={notes}
                maxLength={10000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Запишите идеи и вопросы к позиции…"
              />
              <div className="section-heading">
                <span className="small muted">
                  {notes !== state.notes
                    ? "Есть несохранённые изменения"
                    : "Все заметки сохранены"}
                </span>
                <button
                  className="secondary"
                  disabled={busy || notes === state.notes}
                  onClick={() => void change("notes", { notes })}
                >
                  Сохранить
                </button>
              </div>
            </section>
            <section className="panel engine-info">
              <h2>Анализ Stockfish</h2>
              <p className="muted">
                Откройте импортированную партию для анализа в браузере.
              </p>
              <a href="#games" className="text-button">
                Мои партии →
              </a>
            </section>
          </div>
        </div>
      )}
      {promotion && (
        <Modal
          titleId="promotion-title"
          onClose={() => setPromotion(undefined)}
        >
          <h2 id="promotion-title">Превращение пешки</h2>
          <p>Выберите фигуру.</p>
          <div className="promotion-choices">
            {(["q", "r", "b", "n"] as const).map((piece, i) => (
              <button
                autoFocus={i === 0}
                key={piece}
                disabled={busy}
                onClick={() =>
                  void change("move", { ...promotion, promotion: piece })
                }
              >
                {{ q: "ферзь", r: "ладья", b: "слон", n: "конь" }[piece]}
              </button>
            ))}
          </div>
          <button className="secondary" onClick={() => setPromotion(undefined)}>
            Отмена
          </button>
        </Modal>
      )}
      {resetting && (
        <Modal titleId="reset-title" onClose={() => setResetting(false)}>
          <h2 id="reset-title">Начать новую партию?</h2>
          <p>Ходы текущей партии будут удалены. Заметки сохранятся.</p>
          <div className="dialog-actions">
            <button
              autoFocus
              className="secondary"
              onClick={() => setResetting(false)}
            >
              Продолжить текущую
            </button>
            <button
              onClick={() => {
                setResetting(false);
                void change("reset");
              }}
            >
              Начать заново
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
