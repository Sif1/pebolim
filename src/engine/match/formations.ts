import type { Formation, Pos } from '../types';

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
