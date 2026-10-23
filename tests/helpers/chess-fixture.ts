// Только контрольные ответы для автоматических тестов. Это не реальные партии пользователя.
export const fixturePgn =
  '[Event "Контрольная партия для автоматического теста"]\n[White "alexander_gusev"]\n[Black "test_opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
export const fixtureGame = {
  url: "https://www.chess.com/game/live/999999990001",
  pgn: fixturePgn,
  end_time: 1792713600,
  rules: "chess",
  time_class: "rapid",
  time_control: "900+10",
  white: { username: "alexander_gusev", rating: 1437, result: "checkmated" },
  black: { username: "test_opponent", rating: 1450, result: "win" },
};
export async function fixtureFetch(path: string) {
  if (path.endsWith("/games/archives"))
    return {
      archives: [
        "https://api.chess.com/pub/player/alexander_gusev/games/2026/10",
      ],
    };
  if (path.endsWith("/stats"))
    return {
      chess_rapid: {
        last: { rating: 1500, date: 1792713600 },
        record: { win: 1, loss: 1, draw: 0 },
      },
      chess_blitz: { last: { rating: 1100, date: 1792713600 } },
    };
  if (path.endsWith("/games/2026/10"))
    return {
      games: [
        fixtureGame,
        {
          ...fixtureGame,
          url: "https://www.chess.com/game/live/999999990002",
          time_class: "blitz",
          pgn: '[Event "Контрольный тест Blitz"]\n[White "alexander_gusev"]\n[Black "test_opponent"]\n[Result "0-1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 0-1',
        },
      ],
    };
  return { username: "alexander_gusev", name: "Тестовый ответ профиля" };
}
