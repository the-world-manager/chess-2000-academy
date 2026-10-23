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
  return (
    <img
      className="piece-svg"
      src={`/pieces/classic/${color}${type.toUpperCase()}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
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
            style={{ backgroundPosition: `${(index % 8) * 100 / 7}% ${Math.floor(index / 8) * 100 / 7}%` }}
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
