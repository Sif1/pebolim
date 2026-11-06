import type { Formation, Pos, Tactics } from '../types';

/** A formation slot. x: 0 = own goal line, 1 = opponent goal line. y: 0..1 across the pitch. */
export interface Slot {
  pos: Pos;
  x: number;
  y: number;
}

const s = (pos: Pos, x: number, y: number): Slot => ({ pos, x, y });
const GK = s('GOL', 0.03, 0.5);
const BACK4 = [s('LAT', 0.24, 0.12), s('ZAG', 0.18, 0.37), s('ZAG', 0.18, 0.63), s('LAT', 0.24, 0.88)];
const BACK3 = [s('ZAG', 0.19, 0.25), s('ZAG', 0.17, 0.5), s('ZAG', 0.19, 0.75)];

export const FORMATIONS: Record<Formation, Slot[]> = {
  '4-4-2': [
    GK,
    ...BACK4,
    s('VOL', 0.4, 0.38),
    s('VOL', 0.4, 0.62),
    s('MEI', 0.52, 0.14),
    s('MEI', 0.52, 0.86),
    s('ATA', 0.74, 0.4),
    s('ATA', 0.74, 0.6),
  ],
  '4-3-3': [
    GK,
    ...BACK4,
    s('VOL', 0.38, 0.5),
    s('MEI', 0.52, 0.3),
    s('MEI', 0.52, 0.7),
    s('ATA', 0.74, 0.14),
    s('ATA', 0.8, 0.5),
    s('ATA', 0.74, 0.86),
  ],
  '4-2-3-1': [
    GK,
    ...BACK4,
    s('VOL', 0.37, 0.38),
    s('VOL', 0.37, 0.62),
    s('MEI', 0.6, 0.15),
    s('MEI', 0.58, 0.5),
    s('MEI', 0.6, 0.85),
    s('ATA', 0.8, 0.5),
  ],
  '3-5-2': [
    GK,
    ...BACK3,
    s('LAT', 0.45, 0.08),
    s('VOL', 0.38, 0.5),
    s('MEI', 0.53, 0.32),
    s('MEI', 0.53, 0.68),
    s('LAT', 0.45, 0.92),
    s('ATA', 0.76, 0.4),
    s('ATA', 0.76, 0.6),
  ],
  '5-3-2': [
    GK,
    s('LAT', 0.28, 0.08),
    ...BACK3,
    s('LAT', 0.28, 0.92),
    s('VOL', 0.4, 0.5),
    s('MEI', 0.52, 0.28),
    s('MEI', 0.52, 0.72),
    s('ATA', 0.72, 0.4),
    s('ATA', 0.72, 0.6),
  ],
  '4-5-1': [
    GK,
    ...BACK4,
    s('VOL', 0.38, 0.5),
    s('MEI', 0.52, 0.12),
    s('MEI', 0.5, 0.36),
    s('MEI', 0.5, 0.64),
    s('MEI', 0.52, 0.88),
    s('ATA', 0.76, 0.5),
  ],
  '3-4-3': [
    GK,
    ...BACK3,
    s('LAT', 0.45, 0.1),
    s('VOL', 0.4, 0.4),
    s('VOL', 0.4, 0.6),
    s('LAT', 0.45, 0.9),
    s('ATA', 0.72, 0.15),
    s('ATA', 0.78, 0.5),
    s('ATA', 0.72, 0.85),
  ],
};

export const FORMATION_LIST = Object.keys(FORMATIONS) as Formation[];

// ---------- custom positions on a 5 x 5 grid ----------
// Rows go from the defence (0) to the attack (4); columns from one flank (0) to the other (4).
// The keeper (slot 0) never moves.

export const GRID_ROWS = 5;
export const GRID_COLS = 5;
export const GK_SLOT: Slot = GK;
const ROW_X = [0.19, 0.37, 0.51, 0.61, 0.77];
const COL_Y = [0.1, 0.3, 0.5, 0.7, 0.9];
export const ROW_LABEL = ['Defesa', 'Volância', 'Meio', 'Meia-atacante', 'Ataque'];

/** Position a player in that grid cell plays. */
export function cellRole(cell: number): Pos {
  const row = Math.floor(cell / GRID_COLS);
  const col = cell % GRID_COLS;
  const wide = col === 0 || col === GRID_COLS - 1;
  if (row === 0) return wide ? 'LAT' : 'ZAG';
  if (row === 1) return wide ? 'LAT' : 'VOL';
  if (row === 4) return 'ATA';
  return 'MEI';
}

export function cellSlot(cell: number): Slot {
  const row = Math.floor(cell / GRID_COLS);
  const col = cell % GRID_COLS;
  const wide = col === 0 || col === GRID_COLS - 1;
  const x = ROW_X[row] + (wide && row === 0 ? 0.05 : wide && row === 1 ? 0.04 : wide && row === 4 ? -0.03 : 0);
  return { pos: cellRole(cell), x, y: COL_Y[col] };
}

function nearestRow(x: number): number {
  if (x < 0.31) return 0;
  if (x < 0.47) return 1;
  if (x < 0.555) return 2;
  if (x < 0.68) return 3;
  return 4;
}

function nearestCol(y: number): number {
  let best = 0;
  let bd = Infinity;
  COL_Y.forEach((cy, i) => {
    const d = Math.abs(cy - y);
    // on a tie prefer the column further from the centre
    if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && Math.abs(i - 2) > Math.abs(best - 2))) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** The preset formation expressed as grid cells (slots 1..10). */
export function presetCells(f: Formation): number[] {
  const used = new Set<number>();
  return FORMATIONS[f].slice(1).map((sl) => {
    let cell = nearestRow(sl.x) * GRID_COLS + nearestCol(sl.y);
    // never expected for the presets, but keep cells unique
    for (let k = 0; used.has(cell) && k < 25; k++) cell = (cell + 1) % (GRID_ROWS * GRID_COLS);
    used.add(cell);
    return cell;
  });
}

/** A shape is 10 distinct, in-range integer cells. */
export function validShape(shape: unknown): shape is number[] {
  if (!Array.isArray(shape) || shape.length !== 10) return false;
  if (!shape.every((c) => Number.isInteger(c) && c >= 0 && c < GRID_ROWS * GRID_COLS)) return false;
  return new Set(shape).size === 10;
}

/** Slots a team actually uses: the custom shape when there is one, else the preset. */
export function slotsFor(t: Pick<Tactics, 'formation' | 'shape'>): Slot[] {
  if (t.shape && validShape(t.shape)) return [GK, ...t.shape.map(cellSlot)];
  return FORMATIONS[t.formation] ?? FORMATIONS['4-4-2'];
}

/** "4-2-3-1"-style label counting players per grid row. */
export function shapeLabel(t: Pick<Tactics, 'formation' | 'shape'>): string {
  if (!t.shape || !validShape(t.shape)) return t.formation;
  const rows = [0, 0, 0, 0, 0];
  for (const c of t.shape) rows[Math.floor(c / GRID_COLS)]++;
  return rows.filter((n) => n > 0).join('-');
}
