import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("public/engine", { recursive: true });
for (const file of [
  "stockfish-19-lite-single.js",
  "stockfish-19-lite-single.wasm",
])
  copyFileSync(`node_modules/stockfish/bin/${file}`, `public/engine/${file}`);
copyFileSync(
  "node_modules/stockfish/Copying.txt",
  "public/engine/ЛИЦЕНЗИЯ.txt",
);
