# Сторонние компоненты

## Stockfish 19 Lite / stockfish.js 19.0.1

Используется неизменённая однопоточная WebAssembly-сборка пакета `stockfish@19.0.1` под GNU GPL v3. Движок работает отдельным Web Worker и обменивается текстовыми командами UCI. При сборке приложения `scripts/prepare-engine.ts` копирует файлы движка и полный текст лицензии в `public/engine/`.

В опубликованном приложении доступны:

- `/engine/ЛИЦЕНЗИЯ.txt` — полный текст GPL v3;
- `/engine/ИСТОЧНИКИ.txt` — версия, исходники и инструкция сборки;
- `/engine/stockfish-19.0.1-source.tar.gz` — исходный код точной версии, без изменений.

Исходный проект: https://github.com/nmrugg/stockfish.js/tree/v19.0.1

Тег соответствует коммиту `8d9ca57043594a8fa6ae0b73fb685d9105bf51df`. Сборка upstream: `./build.js --single-threaded --lite`, Emscripten 6.0.9. Скрипт upstream `scripts/net.sh` загружает требуемую Lite-сеть `nn-61e7af4bb97d.nnue`; инструкции и адреса находятся в исходном проекте. Архив содержит исходники upstream; Emscripten и другие инструменты сборки устанавливаются отдельно. Приложение не изменяет лицензию движка, не скрывает его происхождение и не представляет его анализ как официальный сервис Chess.com.

Остальные зависимости и их версии закреплены в `package-lock.json`; их лицензии находятся в соответствующих npm-пакетах. Классические SVG фигур заменены на набор Cburnett (Colin M. L. Burnett), GNU GPL v2 или новее, распространяемый здесь под GPL v3. Неизменённые SVG получены из `lichess-org/lila/public/piece/cburnett`; подтверждение лицензии — `https://github.com/lichess-org/lila/blob/master/COPYING.md`. Авторство и полный текст лицензии доступны в `/pieces/classic/АВТОРСТВО.txt` и `/pieces/classic/ЛИЦЕНЗИЯ.txt`. Текстура доски создана для приложения в SVG. Графические материалы Chess.com не копируются.
