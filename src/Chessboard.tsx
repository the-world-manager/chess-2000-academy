import { useLayoutEffect, useRef, useState } from "react";
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
  const board = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number>();
  useLayoutEffect(() => {
    const node = board.current;
    const panel = node?.parentElement;
    const layout = panel?.closest<HTMLElement>(
      ".board-layout, .analysis-layout",
    );
    if (!node || !panel || !layout) return;
    const measure = () => {
      if (!panel.getClientRects().length) return;
      const style = getComputedStyle(panel);
      const paddingX =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const paddingY =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const siblings = Array.from(panel.children).filter(
        (child) =>
          child !== node && (child as HTMLElement).offsetParent !== null,
      );
      const used = siblings.reduce((sum, child) => {
        const css = getComputedStyle(child);
        return (
          sum +
          child.getBoundingClientRect().height +
          parseFloat(css.marginTop) +
          parseFloat(css.marginBottom)
        );
      }, 0);
      const gap = (parseFloat(style.rowGap) || 0) * siblings.length;
      setSize(
        Math.max(
          64,
          Math.floor(
            Math.min(
              panel.clientWidth - paddingX,
              layout.clientHeight - paddingY - used - gap,
            ),
          ),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    observer.observe(panel);
    Array.from(panel.children)
      .filter((child) => child !== node)
      .forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, []);
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
      ref={board}
      style={size ? { width: size } : undefined}
      onPointerDown={(e) => {
        if (disabled || !e.isPrimary || e.button !== 0) return;
        const square = (e.target as Element).closest<HTMLElement>(
          "[data-square]",
        )?.dataset.square as Square | undefined;
        if (!square) return;
        start.current = {
          from: square,
          x: e.clientX,
          y: e.clientY,
          pointer: e.pointerId,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.pointer !== e.pointerId || disabled) return;
        if (
          Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5 &&
          position.get(s.from)?.color === position.turn()
        ) {
          setSelected(s.from);
          setDrag({ from: s.from, x: e.clientX, y: e.clientY, active: true });
        }
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = undefined;
        setDrag(undefined);
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (!s || s.pointer !== e.pointerId || disabled) return;
        // Координаты считаются по клеткам, а не по элементу под курсором:
        // захват указателя, фигура и подсветка не могут перехватить сброс.
        const first = e.currentTarget
          .querySelector<HTMLElement>("[data-square]")!
          .getBoundingClientRect();
        const col = Math.floor((e.clientX - first.left) / first.width);
        const row = Math.floor((e.clientY - first.top) / first.height);
        const target =
          col >= 0 && col < 8 && row >= 0 && row < 8
            ? squares[row * 8 + col]
            : undefined;
        const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5;
        if (moved && position.get(s.from)?.color === position.turn()) {
          if (
            target &&
            position
              .moves({ square: s.from, verbose: true })
              .some((move) => move.to === target)
          )
            onMove(s.from, target);
          else setSelected(s.from);
        } else if (target === s.from) select(target);
      }}
      onPointerCancel={() => {
        start.current = undefined;
        setDrag(undefined);
      }}
      onLostPointerCapture={() => {
        start.current = undefined;
        setDrag(undefined);
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
            style={{
              backgroundPosition: `${((index % 8) * 100) / 7}% ${(Math.floor(index / 8) * 100) / 7}%`,
            }}
            aria-label={`${square}${piece ? `, ${piece.color === "w" ? "белые" : "чёрные"}: ${names[piece.type]}` : ", пусто"}${target ? ", возможный ход" : ""}`}
            aria-pressed={selected === square}
            disabled={disabled}
            onClick={(event) => {
              // Нажатия указателем обработаны в pointerup; detail=0 — клавиатура.
              if (event.detail === 0) select(square);
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
