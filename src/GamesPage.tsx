import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { PageHeading, Empty } from "./components";
export type GameRow = {
  id: string;
  source_url: string;
  ended_at: number;
  opponent: string;
  color: "w" | "b";
  result: "win" | "loss" | "draw";
  time_class: string;
  time_control: string;
  rating: number | null;
  opponent_rating: number | null;
  opening: string | null;
  analysis_status: "complete" | "stopped" | null;
};
export type ChessMeta = {
  profile: { username: string; name: string | null } | null;
  rapid: {
    last?: { rating: number; date: number };
    record?: { win: number; loss: number; draw: number };
  } | null;
  blitz: any;
  lastSync: string | null;
  retryAt: number;
  counts: Record<string, number>;
};
type GameList = {games:GameRow[];controls:string[];total:number;pages:number};
type Job = {
  id: string;
  control: string;
  processed: number;
  total: number;
  imported: number;
  skipped: number;
  done: boolean;
};
export const timeControl = (value: string) => {
  if (!/^\d+(\+\d+)?$/.test(value)) return value;
  const [seconds, increment] = value.split("+").map(Number);
  return `${seconds / 60}${increment !== undefined ? " + " + increment : ""}`;
};
export function GamesPage() {
  const [time, setTime] = useState("");
  const [control, setControl] = useState("rapid"),
    [result, setResult] = useState(""),
    [color, setColor] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1);
  const [data, setData] = useState<GameList>(),
    [meta, setMeta] = useState<ChessMeta>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<Job>();
  const stop = useRef(false),
    mounted = useRef(true);
  const seq = useRef(0);
  const load = async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        control,
        page: String(page),
        ...(time ? { time } : {}),
        ...(result ? { result } : {}),
        ...(color ? { color } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      const [games, account] = await Promise.all([
        api<GameList>(
          "games?" + query,
        ),
        api<ChessMeta>("chess"),
      ]);
      if (n === seq.current && mounted.current) {
        setData(games);
        setMeta(account);
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (n === seq.current && mounted.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [control, time, result, color, from, to, page]);
  async function sync() {
    stop.current = false;
    setBusy(true);
    setError("");
    try {
      let next = await api<Job>("chess/sync", { control });
      if (mounted.current) setJob(next);
      while (!next.done && !stop.current) {
        next = await api<Job>("chess/sync/step", { id: next.id });
        if (mounted.current) setJob(next);
      }
      if (mounted.current) await load();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      if (mounted.current) await load();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="РЕАЛЬНЫЕ ШАХМАТНЫЕ ДАННЫЕ"
        title="Мои партии"
        text="Профиль alexander_gusev · публичный Chess.com API"
        action={
          <button disabled={busy || loading} onClick={() => void sync()}>
            {busy ? "Синхронизация…" : "Синхронизировать"}
          </button>
        }
      />
      <div className="games-meta">
        <span>
          {meta?.profile?.name ||
            meta?.profile?.username ||
            "Профиль ещё не загружен"}
        </span>
        <strong>Rapid: {meta?.rapid?.last?.rating ?? "—"}</strong>
        <span>Blitz: {meta?.blitz?.last?.rating ?? "—"} · отдельно</span>
        <span>
          Последняя синхронизация:{" "}
          {meta?.lastSync
            ? new Date(meta.lastSync).toLocaleString("ru-RU", {
                timeZone: "Europe/Moscow",
              }) + " МСК"
            : "ещё не выполнялась"}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {job && (
        <div className="sync-status" role="status">
          <span>
            {job.done
              ? "Синхронизация завершена"
              : busy
                ? "Загрузка архивов"
                : "Синхронизация приостановлена"}
            : {job.processed} / {job.total}. Добавлено: {job.imported}.
            Пропущено некорректных: {job.skipped}.
          </span>
          {busy && (
            <button
              className="secondary"
              onClick={() => {
                stop.current = true;
              }}
            >
              Остановить синхронизацию
            </button>
          )}
        </div>
      )}
      <div className="filters">
        <label>
          Контроль
          <select
            aria-label="Контроль"
            value={control}
            disabled={busy}
            onChange={(e) => {
              setControl(e.target.value);
              setTime("");
              setPage(1);
            }}
          >
            <option value="rapid">Rapid</option>
            <option value="blitz">Blitz · отдельно</option>
          </select>
        </label>
        <label>
          Время
          <select
            aria-label="Время"
            disabled={busy}
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все</option>
            {data?.controls?.map((value) => (
              <option key={value} value={value}>
                {timeControl(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Результат
          <select
            aria-label="Результат"
            disabled={busy}
            value={result}
            onChange={(e) => {
              setResult(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все</option>
            <option value="win">Победа</option>
            <option value="loss">Поражение</option>
            <option value="draw">Ничья</option>
          </select>
        </label>
        <label>
          Цвет
          <select
            aria-label="Цвет"
            disabled={busy}
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все</option>
            <option value="w">Белые</option>
            <option value="b">Чёрные</option>
          </select>
        </label>
        <label>
          С даты
          <input
            disabled={busy}
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          По дату
          <input
            disabled={busy}
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <section className="panel games-list" aria-busy={loading}>
        {loading ? (
          <p role="status">Загрузка партий…</p>
        ) : !data?.games.length ? (
          <Empty
            icon="▦"
            title="Партии не найдены"
            text="Нажмите «Синхронизировать» или измените фильтры. Rapid и Blitz загружаются отдельно."
          />
        ) : (
          <>
            <div className="games-table">
              <table>
                <thead>
                  <tr>
                    <th>Дата · МСК</th>
                    <th>Соперник</th>
                    <th>Цвет</th>
                    <th>Результат</th>
                    <th>Контроль</th>
                    <th>Рейтинг</th>
                    <th>Дебют</th>
                    <th>Анализ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.games.map((game) => (
                    <tr key={game.id}>
                      <td>
                        {new Date(game.ended_at * 1000).toLocaleDateString(
                          "ru-RU",
                          { timeZone: "Europe/Moscow" },
                        )}
                      </td>
                      <td>
                        <a href={`#game/${game.id}`} className="game-link">
                          {game.opponent} ↗
                        </a>
                      </td>
                      <td>{game.color === "w" ? "Белые" : "Чёрные"}</td>
                      <td className={`result-${game.result}`}>
                        {
                          { win: "Победа", loss: "Поражение", draw: "Ничья" }[
                            game.result
                          ]
                        }
                      </td>
                      <td>{timeControl(game.time_control)}</td>
                      <td>
                        {game.rating ?? "—"} / {game.opponent_rating ?? "—"}
                      </td>
                      <td>{game.opening || "Не определён"}</td>
                      <td>
                        {game.analysis_status === "complete"
                          ? "Готов"
                          : game.analysis_status === "stopped"
                            ? "Неполный"
                            : "Не выполнен"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                className="secondary"
                disabled={busy || page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Назад
              </button>
              <span>
                Страница {page} из {data.pages} · {data.total} партий
              </span>
              <button
                className="secondary"
                disabled={busy || page >= data.pages}
                onClick={() => setPage(page + 1)}
              >
                Далее
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
