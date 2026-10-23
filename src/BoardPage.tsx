import { useEffect, useMemo, useState } from "react";
import { Chess, type Square, type PieceSymbol, type Color } from "chess.js";
import { api, type BoardState } from "./api";
import { PageHeading, Modal } from "./components";
const pieces: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const pieceNames = {
  k: "король",
  q: "ферзь",
  r: "ладья",
  b: "слон",
  n: "конь",
  p: "пешка",
};
export function BoardPage() {
  const [state, setState] = useState<BoardState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Square>();
  const [flipped, setFlipped] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState("");
  const [promotion, setPromotion] = useState<{ from: Square; to: Square }>();
  const [resetting, setResetting] = useState(false);
  const load = async () => {
    setError("");
    try {
      const data = await api<BoardState>("board");
      setState(data);
      setNotes(data.notes);
      setSelected(undefined);
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
  const legal = selected
    ? position.moves({ square: selected, verbose: true })
    : [];
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
      setSelected(undefined);
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
  function clickSquare(square: Square) {
    if (busy || !atEnd || position.isGameOver()) return;
    const piece = position.get(square);
    if (selected === square) {
      setSelected(undefined);
      return;
    }
    if (selected) {
      const candidate = legal.find((move) => move.to === square);
      if (candidate) {
        if (candidate.isPromotion())
          setPromotion({ from: selected, to: square });
        else void change("move", { from: selected, to: square });
        return;
      }
      if (!piece || piece.color !== position.turn()) {
        setNotice(
          "Выберите одну из отмеченных клеток: туда можно сделать ход.",
        );
        return;
      }
    }
    if (piece?.color === position.turn()) {
      setSelected(square);
      setNotice("Возможные ходы отмечены точками.");
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
  const squares: Square[] = [];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      squares.push(
        `${"abcdefgh"[flipped ? 7 - col : col]}${flipped ? row + 1 : 8 - row}` as Square,
      );
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
        <div className="board-layout">
          <section className="board-panel panel">
            <div className="board-player">
              <span className="avatar">{flipped ? "Б" : "Ч"}</span>
              <strong>{flipped ? "Белые" : "Чёрные"}</strong>
              <span className="muted small">Свободная доска</span>
            </div>
            <div
              className="chessboard"
              role="group"
              aria-label="Шахматная доска"
            >
              {squares.map((square, index) => {
                const piece = position.get(square);
                const target = legal.some((move) => move.to === square);
                const light =
                  ("abcdefgh".indexOf(square[0]) + Number(square[1])) % 2 === 0;
                return (
                  <button
                    type="button"
                    key={square}
                    data-square={square}
                    className={`square ${light ? "light" : "dark"} ${selected === square ? "selected" : ""} ${last?.from === square || last?.to === square ? "last-move" : ""} ${target ? "legal" : ""}`}
                    aria-label={`${square}${piece ? `, ${piece.color === "w" ? "белые" : "чёрные"}: ${pieceNames[piece.type]}` : ", пусто"}${target ? ", возможный ход" : ""}`}
                    aria-pressed={selected === square}
                    disabled={busy}
                    onClick={() => clickSquare(square)}
                  >
                    {index % 8 === 0 && (
                      <span className="rank">{square[1]}</span>
                    )}
                    {piece && (
                      <span
                        className={`piece ${piece.color === "w" ? "white-piece" : "black-piece"}`}
                        aria-hidden="true"
                      >
                        {pieces[piece.color][piece.type]}
                      </span>
                    )}
                    {index >= 56 && <span className="file">{square[0]}</span>}
                    {target && !piece && <span className="move-dot" />}
                  </button>
                );
              })}
            </div>
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
                  setSelected(undefined);
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
                              setSelected(undefined);
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
                    setSelected(undefined);
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
                    setSelected(undefined);
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
                    setSelected(undefined);
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
                    setSelected(undefined);
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
              <span className="tiny-badge">ЭТАП 2</span>
              <h2>Анализ Stockfish</h2>
              <p className="muted">
                Движок ещё не подключён. Оценки и лучшие варианты не
                рассчитываются.
              </p>
              <p className="small muted">
                Глубокий анализ будет запускаться только по кнопке
                «Анализировать партию».
              </p>
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
                {pieceNames[piece]}
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
