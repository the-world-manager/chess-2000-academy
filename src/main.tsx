import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Profile } from "./api";
import { PageHeading, Empty, ArrowUpRight } from "./components";
import { BoardPage } from "./BoardPage";
import { GamesPage } from "./GamesPage";
import { GamePage } from "./GamePage";
import type { ChessMeta } from "./GamesPage";
import "./styles.css";

const pages = [
  ["home", "Главная", "◈"],
  ["today", "Сегодня", "◷"],
  ["plan", "Годовой план", "▤"],
  ["games", "Мои партии", "▦"],
  ["board", "Анализ партии", "♞"],
  ["training", "Тренажёры", "◎"],
  ["openings", "Дебюты", "♜"],
  ["progress", "Прогресс", "↗"],
  ["coach", "Тренер", "✧"],
  ["settings", "Настройки", "⚙"],
] as const;
type Page = (typeof pages)[number][0];
function App() {
  const [auth, setAuth] = useState<{
    initialized: boolean;
    authenticated: boolean;
  }>();
  const [error, setError] = useState("");
  const refresh = () => {
    setError("");
    api<{ initialized: boolean; authenticated: boolean }>("auth")
      .then(setAuth)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    refresh();
    const expire = () => setAuth({ initialized: true, authenticated: false });
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  if (error)
    return (
      <main className="auth-wrap">
        <div className="panel">
          <h1>Нет связи с академией</h1>
          <p role="alert">{error}</p>
          <button onClick={refresh}>Повторить</button>
        </div>
      </main>
    );
  if (!auth)
    return (
      <main className="auth-wrap" role="status">
        Загрузка академии…
      </main>
    );
  if (!auth.authenticated)
    return <Auth initialized={auth.initialized} onSuccess={refresh} />;
  return <Workspace onLogout={refresh} />;
}
function Auth({
  initialized,
  onSuccess,
}: {
  initialized: boolean;
  onSuccess: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-wrap">
      <section className="auth-card panel">
        <div className="brand-mark">♞</div>
        <p className="eyebrow">ШАХМАТНАЯ АКАДЕМИЯ 2000</p>
        <h1>
          {initialized ? "Вернуться к тренировкам" : "Ваш путь к сильной игре"}
        </h1>
        <p className="muted">
          {initialized
            ? "Войдите, чтобы продолжить с сохранённой позиции."
            : "Создайте личный аккаунт владельца. Позиции и заметки будут храниться на сервере."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = new FormData(e.currentTarget);
            try {
              await api(initialized ? "login" : "setup", {
                login: form.get("login"),
                password: form.get("password"),
              });
              onSuccess();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Логин
            <input
              aria-label="Логин"
              aria-describedby="login-help"
              name="login"
              required
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Z0-9_-]+"
              autoComplete="username"
            />
            <span id="login-help" className="muted small">
              Латинские буквы, цифры, «_» или «-».
            </span>
          </label>
          <label>
            Пароль
            <input
              aria-label="Пароль"
              aria-describedby={!initialized ? "password-help" : undefined}
              name="password"
              type="password"
              required
              minLength={initialized ? 1 : 12}
              maxLength={128}
              autoComplete={initialized ? "current-password" : "new-password"}
            />
            {!initialized && (
              <span id="password-help" className="muted small">
                Не менее 12 символов. Пароль Chess.com не требуется.
              </span>
            )}
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} type="submit">
            {busy ? "Подождите…" : initialized ? "Войти" : "Создать аккаунт"}
          </button>
        </form>
        {!initialized && (
          <p className="small muted">
            Первичная настройка: создавайте владельца в доверенной среде до
            открытия публичного доступа.
          </p>
        )}
      </section>
    </main>
  );
}
function Workspace({ onLogout }: { onLogout: () => void }) {
  const getPage = (): Page =>
    location.hash.startsWith("#game/")
      ? "board"
      : pages.some(([id]) => id === location.hash.slice(1))
        ? (location.hash.slice(1) as Page)
        : "home";
  const [page, setPage] = useState<Page>(getPage);
  const [profile, setProfile] = useState<Profile>();
  const [gameId, setGameId] = useState(() =>
    location.hash.startsWith("#game/") ? location.hash.slice(6) : null,
  );
  const [error, setError] = useState("");
  const loadProfile = () => {
    setError("");
    api<Profile>("profile")
      .then(setProfile)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    loadProfile();
    const handler = () => {
      setPage(getPage());
      setGameId(
        location.hash.startsWith("#game/") ? location.hash.slice(6) : null,
      );
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  function navigate(id: Page) {
    location.hash = id;
  }
  return (
    <div className="app">
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Перейти к содержимому
      </a>
      <aside className="sidebar">
        <a href="#home" className="brand">
          <span className="brand-mark">♞</span>
          <span>
            ШАХМАТНАЯ
            <br />
            <b>
              АКАДЕМИЯ <em>2000</em>
            </b>
          </span>
        </a>
        <p className="nav-caption">ВАША ПОДГОТОВКА</p>
        <nav aria-label="Основная навигация">
          {pages.map(([id, label, icon]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={page === id ? "page" : undefined}
            >
              <span aria-hidden="true">
                {id === "progress" ? <ArrowUpRight /> : icon}
              </span>
              {label}
              {id === "coach" && <i>01</i>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">АГ</span>
          <div>
            <strong>{profile?.chess_username || "Личный профиль"}</strong>
            <small>Цель · 2000 Rapid</small>
          </div>
        </div>
      </aside>
      <div className={`workspace ${page === "board" ? "board-workspace" : ""}`}>
        <header className="topbar">
          <span>
            Личная академия{" "}
            <span className="crumb">
              / {pages.find(([id]) => id === page)?.[1]}
            </span>
          </span>
          <span className="stage">
            <i /> Второй этап · Партии и анализ
          </span>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {error && (
            <div className="error" role="alert">
              {error}{" "}
              <button className="secondary" onClick={loadProfile}>
                Повторить
              </button>
            </div>
          )}
          {page === "home" ? (
            <Home profile={profile} navigate={navigate} />
          ) : page === "games" ? (
            <GamesPage />
          ) : page === "board" ? (
            gameId ? (
              <GamePage key={gameId} id={gameId} />
            ) : (
              <BoardPage />
            )
          ) : page === "settings" ? (
            <>
              <PageHeading
                eyebrow="ЛИЧНЫЙ КАБИНЕТ"
                title="Настройки"
                text="Ваш профиль и безопасность данных."
              />
              <section className="panel">
                <h2>Шахматный профиль</h2>
                <dl>
                  <dt>Chess.com</dt>
                  <dd>{profile?.chess_username || "Загрузка…"}</dd>
                  <dt>Стартовая точка программы</dt>
                  <dd>1437 Rapid</dd>
                  <dt>Цель</dt>
                  <dd>2000 Rapid · 12 месяцев</dd>
                  <dt>Хранение</dt>
                  <dd>Постоянная серверная база данных</dd>
                </dl>
                <p className="muted">
                  Данные Chess.com обновляются вручную в разделе «Мои партии». В
                  этой версии доступен один аккаунт владельца.
                </p>
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await api("logout", {});
                      onLogout();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Выйти из аккаунта
                </button>
              </section>
            </>
          ) : (
            <FuturePage page={page} navigate={navigate} />
          )}
        </main>
        <footer>
          Системная подготовка. Осознанная игра.
          <span>Путь к 2000 · шаг за шагом</span>
        </footer>
      </div>
    </div>
  );
}
function Home({
  profile,
  navigate,
}: {
  profile?: Profile;
  navigate: (id: Page) => void;
}) {
  const [chessMeta, setChessMeta] = useState<ChessMeta>();
  useEffect(() => {
    api<ChessMeta>("chess")
      .then(setChessMeta)
      .catch(() => {});
  }, []);
  return (
    <>
      <PageHeading
        eyebrow="КАЖДЫЙ ХОД ИМЕЕТ ЗНАЧЕНИЕ"
        title="Сильная игра начинается с системы"
        text="Ваше пространство для вдумчивой работы над шахматами."
        action={
          <button onClick={() => navigate("board")}>
            Начать тренировку{" "}
            <span className="inline-icon">
              <ArrowUpRight />
            </span>
          </button>
        }
      />
      <div className="stats-grid">
        {[
          [
            "Rapid-рейтинг",
            chessMeta?.rapid?.last?.rating?.toString() || "—",
            chessMeta?.rapid?.last
              ? "Последнее обновление Chess.com"
              : "Нажмите «Синхронизировать» в «Моих партиях»",
          ],
          [
            "Целевой рейтинг",
            String(profile?.target_rating || 2000),
            "Ориентир программы · 12 месяцев",
          ],
          ["Занятия за неделю", "—", "Учёт тренировок ещё не подключён"],
          ["Ежедневный план", "—", "Появится на этапе персонализации"],
        ].map(([label, value, hint]) => (
          <section className="panel stat" key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <small>{hint}</small>
          </section>
        ))}
      </div>
      <div className="home-grid">
        <section className="hero panel">
          <div>
            <span className="badge">ВАША ПЕРВАЯ СЕССИЯ</span>
            <h2>
              Думайте глубже.
              <br />
              <span>Играйте точнее.</span>
            </h2>
            <p>
              Исследуйте позицию на доске, проверяйте свои идеи и записывайте
              выводы. Каждый ход сохраняется.
            </p>
            <button onClick={() => navigate("board")}>
              Открыть доску <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="hero-chess" aria-hidden="true">
            ♞<span>♟</span>
          </div>
          <div className="hero-foot">
            <span>01 / ОСНОВА</span>
            <span>Доска · Правила · Заметки</span>
          </div>
        </section>
        <section className="panel goal">
          <p className="eyebrow">ДОЛГОСРОЧНЫЙ ОРИЕНТИР</p>
          <h2>Путь к 2000</h2>
          <div className="goal-numbers">
            <span>
              1437<small>старт программы</small>
            </span>
            <span className="muted">→</span>
            <span>
              2000<small>цель Rapid</small>
            </span>
          </div>
          <div className="goal-line" />
          <p className="muted">
            {chessMeta?.rapid?.last
              ? `Текущий Rapid: ${chessMeta.rapid.last.rating}. До цели: ${Math.max(0, 2000 - chessMeta.rapid.last.rating)} пунктов.`
              : "Для расчёта текущего прогресса синхронизируйте профиль Chess.com."}
          </p>
          <p className="small muted">
            Рейтинговая цель — ориентир, а не гарантия роста.
          </p>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Последние партии</h2>
            <button className="text-button" onClick={() => navigate("games")}>
              В журнал →
            </button>
          </div>
          <Empty
            icon="▦"
            title={
              chessMeta?.counts.rapid
                ? "Ваши партии готовы к разбору"
                : "История начинается с первой партии"
            }
            text={
              chessMeta?.counts.rapid
                ? `Сохранено ${chessMeta.counts.rapid} Rapid-партий. Откройте журнал для просмотра и анализа.`
                : "Загрузите реальные партии кнопкой «Синхронизировать» в разделе «Мои партии»."
            }
          />
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Рекомендация тренера</h2>
            <span className="tiny-badge">ОСНОВА</span>
          </div>
          <div className="coach-message">
            <span className="coach-icon">✧</span>
            <p>
              Начните с самостоятельной работы на доске: выберите позицию и
              запишите, какие ходы вы рассматривали.
            </p>
          </div>
          <p className="small muted">
            Это стартовая рекомендация. Персональные выводы появятся после
            анализа реальных партий.
          </p>
        </section>
      </div>
    </>
  );
}
const future: Record<
  string,
  {
    title: string;
    intro: string;
    stage: string;
    message: string;
    items: string[];
  }
> = {
  today: {
    title: "Сегодня",
    intro: "Небольшие шаги к более сильной игре.",
    stage: "Этап 4 · Персонализация",
    message: "Ежедневный план ещё не формируется",
    items: [
      "Базовый режим — 60 минут",
      "Расширенный режим — 180 минут",
      "Интенсивный режим — до 240 минут",
      "Выполнение и фактическое время будут сохраняться",
    ],
  },
  plan: {
    title: "Годовой план",
    intro: "Горизонт подготовки — 12 месяцев. Цель — 2000 Rapid.",
    stage: "Этап 4 · Персонализация",
    message: "Персональная программа ещё не сформирована",
    items: [
      "Сначала — реальные партии и диагностика",
      "Затем — цели по навыкам и тренировочная нагрузка",
      "Каждые семь дней — пересмотр по результатам",
    ],
  },
  games: {
    title: "Журнал партий",
    intro: "Реальные партии. Конкретные выводы.",
    stage: "Этап 2 · Шахматные данные",
    message: "Импортированных партий пока нет",
    items: [
      "Публичный профиль: alexander_gusev",
      "Планируется ручная синхронизация Chess.com без пароля",
      "Импорт и анализ будут отдельными действиями",
    ],
  },
  training: {
    title: "Тренажёры",
    intro: "Точность начинается с осмысленной практики.",
    stage: "Этап 3 · Обучение",
    message: "Тренажёры ещё не подключены",
    items: [
      "Координаты доски и статистика ответов",
      "Тактика с проверяемыми решениями",
      "Расчёт вариантов",
      "Повторение собственных ошибок",
    ],
  },
  openings: {
    title: "Дебюты",
    intro: "Понимать планы, а не только запоминать ходы.",
    stage: "Этап 3 · Обучение",
    message: "Утверждённый репертуар",
    items: [
      "Белыми — Colle–Zukertort",
      "Против 1.e4 — Caro-Kann",
      "Против 1.d4 — Queen’s Gambit Declined",
      "Против 1.c4 — структуры с …e6",
      "Против 1.Nf3 — структуры с …d5",
    ],
  },
  progress: {
    title: "Прогресс",
    intro: "Достоверные показатели вашей подготовки.",
    stage: "Этапы 2–4",
    message: "Недостаточно данных для статистики",
    items: [
      "Рейтинг появится после подключения Chess.com",
      "Результаты упражнений — после подключения тренажёров",
      "Частота ошибок — после анализа Stockfish",
    ],
  },
  coach: {
    title: "Гибридный тренер",
    intro: "Рекомендации, основанные на ваших партиях.",
    stage: "Этап 4 · Персонализация",
    message: "Персональный тренер ещё не подключён",
    items: [
      "Stockfish — оценки и подтверждённые варианты",
      "Алгоритмы — статистика и распределение нагрузки",
      "Языковая модель — русские объяснения на основе результатов",
      "Без проанализированных партий персональные выводы не формируются",
    ],
  },
};
function FuturePage({
  page,
  navigate,
}: {
  page: Page;
  navigate: (id: Page) => void;
}) {
  const info = future[page];
  return (
    <>
      <PageHeading
        eyebrow="ПРОГРАММА РАЗВИТИЯ"
        title={info.title}
        text={info.intro}
      />
      <section className="panel future-panel">
        <span className="badge">{info.stage}</span>
        <Empty
          icon={pages.find(([id]) => id === page)?.[2] || "◈"}
          title={info.message}
          text="Этот раздел входит в утверждённый план разработки. Его функции пока недоступны."
        />
        <ul className="feature-list">
          {info.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <button className="secondary" onClick={() => navigate("board")}>
          Перейти к рабочей доске →
        </button>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
