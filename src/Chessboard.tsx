import { useRef, useState } from "react";
import { Chess, type Square, type PieceSymbol } from "chess.js";
const names = {
  k: "король",
  q: "ферзь",
  r: "ладья",
  b: "слон",
  n: "конь",
  p: "пешка",
};
function Piece({ type, color }: { type: PieceSymbol; color: "w" | "b" }) {
  const fill = color === "w" ? "#fff8e8" : "#20352b",
    stroke = color === "w" ? "#354a40" : "#9db1a4";
  const paths: Record<PieceSymbol, React.ReactNode> = {
    p: (
      <>
        <circle cx="32" cy="16" r="8" />
        <path d="M26 24h12l-2 9 7 13H21l7-13z" />
      </>
    ),
    r: (
      <>
        <path d="M18 10h7v7h5v-7h5v7h5v-7h7v15l-7 5 2 15H22l2-15-6-5z" />
        <path d="M23 25h18" />
      </>
    ),
    b: (
      <>
        <path d="M32 7C23 16 20 21 23 27l5 7-9 12h26l-9-12 5-7c3-6 0-11-9-20z" />
        <path d="m33 16-6 9" />
      </>
    ),
    n: (
      <>
        <path d="M20 45h27l-3-10c7-14-2-24-17-27l-3 7-9 12 6 7 8-6-3 9z" />
        <path d="m27 8 5 8" />
        <circle cx="29" cy="22" r="1.5" fill={stroke} />
      </>
    ),
    q: (
      <>
        <path d="m17 19 8 8 7-12 7 12 8-8-6 25H23z" />
        <circle cx="16" cy="16" r="4" />
        <circle cx="32" cy="12" r="4" />
        <circle cx="48" cy="16" r="4" />
      </>
    ),
    k: (
      <>
        <path d="M32 5v13m-6-8h12" />
        <path d="M24 21c-13-8-13 10-1 15l-2 9h22l-2-9c12-5 12-23-1-15-3-8-13-8-16 0z" />
      </>
    ),
  };
  return (
    <svg className="piece-svg" viewBox="0 0 64 64" aria-hidden="true">
      <g
        fill={fill}
        stroke={stroke}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {paths[type]}
        <path d="M22 44h20l5 7H17z" />
        <path d="M17 51h30v5H17z" />
      </g>
    </svg>
  );
}
export function Chessboard({
  position,
  flipped = false,
  onMove,
  disabled = false,
  lastMove,
}: {
  position: Chess;
  flipped?: boolean;
  onMove: (from: Square, to: Square) => void;
  disabled?: boolean;
  lastMove?: { from: string; to: string };
}) {
  const [selected, setSelected] = useState<Square>();
  const [drag, setDrag] = useState<{
    from: Square;
    x: number;
    y: number;
    active: boolean;
  }>();
  const start = useRef<
    { from: Square; x: number; y: number; pointer: number } | undefined
  >(undefined);
  const dragged = useRef(false);
  const squares: Square[] = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      squares.push(
        `${"abcdefgh"[flipped ? 7 - c : c]}${flipped ? r + 1 : 8 - r}` as Square,
      );
  const legal = selected
    ? position.moves({ square: selected, verbose: true })
    : [];
  const select = (square: Square) => {
    if (disabled) return;
    if (selected && legal.some((move) => move.to === square)) {
      onMove(selected, square);
      return;
    }
    setSelected(
      position.get(square)?.color === position.turn()
        ? selected === square
          ? undefined
          : square
        : undefined,
    );
  };
  return (
    <div
      className="chessboard"
      role="group"
      aria-label="Шахматная доска"
      onPointerDown={(e) => {
        const square = (e.target as Element).closest<HTMLElement>(
          "[data-square]",
        )?.dataset.square as Square | undefined;
        if (
          disabled ||
          !square ||
          position.get(square)?.color !== position.turn()
        )
          return;
        start.current = {
          from: square,
          x: e.clientX,
          y: e.clientY,
          pointer: e.pointerId,
        };
        dragged.current = false;
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5) {
          dragged.current = true;
          if (!e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.setPointerCapture(e.pointerId);
          setSelected(s.from);
          setDrag({ from: s.from, x: e.clientX, y: e.clientY, active: true });
          e.preventDefault();
        }
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = undefined;
        setDrag(undefined);
        if (!s || !dragged.current) return;
        const target = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-square]")?.dataset.square as
          | Square
          | undefined;
        if (
          target &&
          position
            .moves({ square: s.from, verbose: true })
            .some((move) => move.to === target)
        ) {
          onMove(s.from, target);
        } else setSelected(s.from);
        // Подавляем синтетический click после перетаскивания, но сохраняем обычный выбор двумя нажатиями.
        setTimeout(() => {
          dragged.current = false;
        }, 0);
      }}
      onPointerCancel={() => {
        start.current = undefined;
        setDrag(undefined);
        dragged.current = false;
      }}
    >
      {squares.map((square, index) => {
        const piece = position.get(square),
          target = legal.some((move) => move.to === square),
          light = ("abcdefgh".indexOf(square[0]) + Number(square[1])) % 2 === 0;
        return (
          <button
            key={square}
            type="button"
            data-square={square}
            className={`square ${light ? "light" : "dark"} ${selected === square ? "selected" : ""} ${target ? "legal" : ""} ${lastMove?.from === square || lastMove?.to === square ? "last-move" : ""}`}
            aria-label={`${square}${piece ? `, ${piece.color === "w" ? "белые" : "чёрные"}: ${names[piece.type]}` : ", пусто"}${target ? ", возможный ход" : ""}`}
            aria-pressed={selected === square}
            disabled={disabled}
            onClick={() => {
              if (!dragged.current) select(square);
            }}
          >
            {index % 8 === 0 && <span className="rank">{square[1]}</span>}
            {piece && (
              <span
                className={`piece ${drag?.from === square ? "drag-source" : ""}`}
              >
                <Piece type={piece.type} color={piece.color} />
              </span>
            )}
            {index >= 56 && <span className="file">{square[0]}</span>}
            {target && !piece && <span className="move-dot" />}
          </button>
        );
      })}
      {drag && position.get(drag.from) && (
        <div className="dragged-piece" style={{ left: drag.x, top: drag.y }}>
          <Piece
            type={position.get(drag.from)!.type}
            color={position.get(drag.from)!.color}
          />
        </div>
      )}
    </div>
  );
}
