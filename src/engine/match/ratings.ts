import type { Pos, Tactics, Trait } from '../types';
import { FORMATIONS, type Slot } from './formations';

/** Minimal player info the match engine needs. */
export interface RatedPlayer {
  id: number;
  pos: Pos;
  str: number;
  fitness: number;
  morale: number;
  traits: Trait[];
}

export interface SectorRatings {
  gk: number;
  def: number;
  mid: number;
  att: number;
}

// How much a slot of each position contributes to [def, mid, att].
const SECTOR_W: Record<Pos, [number, number, number]> = {
  GOL: [0, 0, 0],
  ZAG: [1, 0.1, 0],
  LAT: [0.7, 0.3, 0.15],
  VOL: [0.5, 0.8, 0],
  MEI: [0, 1, 0.5],
  ATA: [0, 0.15, 1],
};

const REF = (() => {
  const r = [0, 0, 0];
  for (const sl of FORMATIONS['4-4-2']) {
    const w = SECTOR_W[sl.pos];
    r[0] += w[0];
    r[1] += w[1];
    r[2] += w[2];
  }
  return r;
})();

const ADJ: Partial<Record<Pos, Partial<Record<Pos, number>>>> = {
  ZAG: { LAT: 0.88, VOL: 0.85 },
  LAT: { ZAG: 0.86, MEI: 0.85, VOL: 0.82 },
  VOL: { ZAG: 0.84, MEI: 0.9, LAT: 0.8 },
  MEI: { VOL: 0.88, ATA: 0.86, LAT: 0.82 },
  ATA: { MEI: 0.86 },
};

/** Multiplier for a player of position `p` playing in slot position `slot`. */
export function posFactor(p: Pos, slot: Pos): number {
  if (p === slot) return 1;
  if (p === 'GOL' || slot === 'GOL') return slot === 'GOL' ? 0.3 : 0.4;
  return ADJ[p]?.[slot] ?? 0.7;
}

export function effective(p: RatedPlayer, slot: Pos): number {
  const fit = 0.7 + 0.3 * (p.fitness / 100);
  const mor = 0.95 + 0.1 * (p.morale / 100);
  return p.str * posFactor(p.pos, slot) * fit * mor;
}

export function computeRatings(slots: Slot[], onPitch: (RatedPlayer | null)[], tactics: Tactics): SectorRatings {
  let gk = 20;
  const sum = [0, 0, 0];
  const wsum = [0, 0, 0];
  const present = [0, 0, 0];
  for (let i = 0; i < slots.length; i++) {
    const sl = slots[i];
    const pl = onPitch[i];
    if (sl.pos === 'GOL') {
      if (pl) gk = effective(pl, 'GOL') * (pl.traits.includes('reflexos') ? 1.04 : 1);
      continue;
    }
    const w = SECTOR_W[sl.pos];
    const e = pl ? effective(pl, sl.pos) : 0;
    for (let k = 0; k < 3; k++) {
      wsum[k] += w[k];
      if (pl) {
        sum[k] += w[k] * e;
        present[k] += w[k];
      }
    }
  }
  const sector = (k: number) => {
    if (wsum[k] === 0) return 20;
    const avg = sum[k] / wsum[k]; // missing players count as zero -> big penalty
    return avg * (0.6 + (0.4 * present[k]) / REF[k]);
  };
  // a leader on the pitch lifts everyone a little
  const lead = onPitch.some((p) => p?.traits.includes('lideranca')) ? 1.015 : 1;
  let def = sector(0) * lead;
  let mid = sector(1) * lead;
  let att = sector(2) * lead;
  if (tactics.mentality === 'defensiva') {
    def *= 1.06;
    att *= 0.92;
  } else if (tactics.mentality === 'ofensiva') {
    att *= 1.07;
    def *= 0.93;
  }
  if (tactics.marking === 'pressao') mid *= 1.03;
  return { gk, def, mid, att };
}

export function overall(r: SectorRatings): number {
  return 0.14 * r.gk + 0.3 * r.def + 0.3 * r.mid + 0.26 * r.att;
}
