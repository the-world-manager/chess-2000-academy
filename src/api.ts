export type BoardState = {
  pgn: string;
  fen: string;
  notes: string;
  revision: number;
  updated_at: string;
};
export type Profile = {
  login: string;
  chess_username: string;
  start_rating: number;
  target_rating: number;
  created_at: string;
};
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `/api/${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new Error("Нет связи с сервером. Проверьте подключение и повторите.");
  }
  if (response.status === 401 && path !== "login")
    window.dispatchEvent(new Event("session-expired"));
  const data = await response
    .json()
    .catch(() => ({ error: "Сервер вернул некорректный ответ." }));
  if (!response.ok)
    throw new Error(data.error || "Не удалось выполнить запрос.");
  return data as T;
}
