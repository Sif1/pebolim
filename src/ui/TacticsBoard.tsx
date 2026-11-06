import { useState, type DragEvent, type ReactNode } from 'react';
import { cellSlot, GRID_COLS, GRID_ROWS, presetCells, slotsFor } from '../engine/match/formations';
import type { Pos, Tactics } from '../engine/types';
import { energyColor, Rating, readable } from './common';

// ---------- drag and drop between the field and player lists ----------

export type DragSrc = { kind: 'slot'; slot: number } | { kind: 'player'; pid: number; from: 'bench' | 'res' };
export type DropTarget = { kind: 'slot'; slot: number } | { kind: 'cell'; cell: number };

let current: DragSrc | null = null;

function parse(e: DragEvent): DragSrc | null {
  if (current) return current;
  try {
    return JSON.parse(e.dataTransfer.getData('text/plain')) as DragSrc;
  } catch {
    return null;
  }
}

/** Props that make an element draggable as `src`. */
export function dragProps(src: DragSrc, enabled = true, onStart?: () => void, onEnd?: () => void) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      current = src;
      e.dataTransfer.setData('text/plain', JSON.stringify(src));
      e.dataTransfer.effectAllowed = 'move';
      onStart?.();
    },
    onDragEnd: () => {
      current = null;
      onEnd?.();
    },
  };
}

/** Props that make an element accept drops. */
export function dropProps(onDrop: (src: DragSrc) => void, accept: (src: DragSrc) => boolean = () => true) {
  return {
    onDragOver: (e: DragEvent) => {
      if (!current || accept(current)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        (e.currentTarget as HTMLElement).classList.add('drop-hover');
      }
    },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drop-hover'),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).classList.remove('drop-hover');
      const src = parse(e);
      current = null;
      if (src && accept(src)) onDrop(src);
    },
  };
}

/** Cells (slots 1..10) the team currently stands on. */
export function currentCells(t: Pick<Tactics, 'formation' | 'shape'>): number[] {
  return t.shape && t.shape.length === 10 ? [...t.shape] : presetCells(t.formation);
}

/** New shape after moving slot `slot` (1..10) to `cell`. */
export function moveSlotTo(t: Pick<Tactics, 'formation' | 'shape'>, slot: number, cell: number): number[] | null {
  if (slot < 1) return null;
  const cells = currentCells(t);
  if (cells.includes(cell)) return null;
  cells[slot - 1] = cell;
  return cells;
}

// ---------- the field ----------

export interface BoardToken {
  id: number;
  num: number;
  name: string;
  pos: Pos;
  /** small line under the name (e.g. role and strength) */
  meta?: ReactNode;
  fitness?: number;
  rating?: number | null;
  /** unavailable / sent off: drawn faded */
  dim?: boolean;
  yellow?: boolean;
}

interface Props {
  tactics: Pick<Tactics, 'formation' | 'shape'>;
  /** player id per slot */
  xi: (number | null)[];
  tokens: Map<number, BoardToken>;
  colors: [string, string];
  compact?: boolean;
  selected?: number | null;
  onSlotClick?: (slot: number) => void;
  onDrop: (target: DropTarget, src: DragSrc) => void;
  /** players on the field can be dragged (to swap them or move their position) */
  movable?: boolean;
  /** extra condition for drops from the lists onto a slot */
  acceptPlayer?: (src: DragSrc) => boolean;
}

const left = (y: number) => `${7 + y * 86}%`;
const top = (x: number) => `${93 - x * 90}%`;

/** Vertical pitch (attacking upwards) with draggable players and, while dragging, the free positions. */
export function TacticsBoard({ tactics, xi, tokens, colors, compact, selected, onSlotClick, onDrop, movable = true, acceptPlayer }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const slots = slotsFor(tactics);
  const taken = new Set(currentCells(tactics));
  const free = dragging != null && dragging > 0 ? Array.from({ length: GRID_ROWS * GRID_COLS }, (_, c) => c).filter((c) => !taken.has(c)) : [];
  const fg = readable(colors[0], colors[1]);

  return (
    <div className={`board ${compact ? 'compact' : ''}`}>
      <FieldLines />
      {free.map((cell) => {
        const sl = cellSlot(cell);
        return (
          <div
            key={`c${cell}`}
            className="cell"
            style={{ left: left(sl.y), top: top(sl.x) }}
            title={sl.pos}
            {...dropProps((src) => onDrop({ kind: 'cell', cell }, src), (src) => src.kind === 'slot')}
          >
            {sl.pos}
          </div>
        );
      })}
      {slots.map((sl, i) => {
        const id = xi[i] ?? null;
        const p = id != null ? tokens.get(id) : undefined;
        return (
          <div
            key={i}
            className={`tok ${selected === i ? 'sel' : ''} ${p?.dim ? 'dim' : ''}`}
            style={{ left: left(sl.y), top: top(sl.x) }}
            onClick={() => onSlotClick?.(i)}
            {...dragProps({ kind: 'slot', slot: i }, movable && id != null, () => setDragging(i), () => setDragging(null))}
            {...dropProps(
              (src) => onDrop({ kind: 'slot', slot: i }, src),
              (src) => (src.kind === 'slot' ? src.slot !== i : !acceptPlayer || acceptPlayer(src)),
            )}
          >
            <div className="shirt" style={{ background: colors[0], borderColor: colors[1], color: fg }}>
              {p?.num ?? ''}
              {p?.yellow && <span className="yc" />}
            </div>
            <div className="nm">{p ? p.name.split(' ').slice(-1)[0] : sl.pos}</div>
            {p && (p.fitness != null || p.rating !== undefined) && (
              <div className="tok-info">
                {p.fitness != null && (
                  <span className="mini-bar" title={`Energia ${Math.round(p.fitness)}%`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, p.fitness))}%`, background: energyColor(p.fitness) }} />
                  </span>
                )}
                {p.rating !== undefined && <Rating v={p.rating} />}
              </div>
            )}
            {p?.meta && <div className="meta">{p.meta}</div>}
          </div>
        );
      })}
    </div>
  );
}

function FieldLines() {
  // vertical pitch 68 x 105, drawn in its own coordinates
  return (
    <svg className="board-lines" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden>
      <g fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.35">
        <rect x="1" y="1" width="66" height="103" />
        <line x1="1" y1="52.5" x2="67" y2="52.5" />
        <circle cx="34" cy="52.5" r="9.15" />
        <rect x="13.84" y="1" width="40.32" height="16.5" />
        <rect x="24.84" y="1" width="18.32" height="5.5" />
        <rect x="13.84" y="87.5" width="40.32" height="16.5" />
        <rect x="24.84" y="98.5" width="18.32" height="5.5" />
        <path d="M 26.7 17.5 A 9.15 9.15 0 0 0 41.3 17.5" />
        <path d="M 26.7 87.5 A 9.15 9.15 0 0 1 41.3 87.5" />
      </g>
      <g fill="rgba(255,255,255,0.6)">
        <circle cx="34" cy="52.5" r="0.5" />
        <circle cx="34" cy="12" r="0.5" />
        <circle cx="34" cy="93" r="0.5" />
      </g>
    </svg>
  );
}
