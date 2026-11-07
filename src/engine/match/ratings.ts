import type { Pos, Side, Tactics, Trait } from '../types';
import { FORMATIONS, type Slot } from './formations';

/** Minimal player info the match engine needs. */
export interface RatedPlayer {
  id: number;
  pos: Pos;
  str: number;
  fitness: number;
  morale: number;
  traits: Trait[];
  flank?: Side;
}

export interface SectorRatings {
  gk: number;
  def: number;
  mid: number;
  att: number;
}

// How a slot of each position splits its contribution between [def, mid, att].
// Every row sums to 1, so a formation decides where the strength goes, not how much there is.
const RAW_W: Record<Pos, [number, number, number]> = {
  GOL: [0, 0, 0],
  ZAG: [1, 0.1, 0],
  LAT: [0.7, 0.3, 0.15],
  VOL: [0.5, 0.8, 0],
  MEI: [0, 1, 0.5],
  ATA: [0, 0.15, 1],
};
const SECTOR_W = Object.fromEntries(
  Object.entries(RAW_W).map(([k, w]) => {
    const t = w[0] + w[1] + w[2];
    return [k, t ? (w.map((v) => v / t) as [number, number, number]) : w];
  }),
) as Record<Pos, [number, number, number]>;

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

/** Tiredness: effectiveness falls 0.3 per 100% of energy, and faster (+steep) below the knee. */
export const FATIGUE = { knee: 0.8, steep: 0.6 };

/**
 * The lane of a formation slot, from the team's own point of view (y = 0 is its left touchline):
 * 0 = left, 1 = centre, 2 = right.
 */
export function laneOf(y: number): 0 | 1 | 2 {
  return y < 0.3 ? 0 : y > 0.7 ? 2 : 1;
}

/**
 * A player on a flank that isn't his: a full-back on the wrong side loses 8% (5% if he is a central player),
 * a wide midfielder or forward 4% (2%), since an inverted winger can cut inside. In the middle side doesn't
 * matter, and neither does it for keepers, centre-backs and holding midfielders.
 */
export const SIDE_PENALTY = { latWrong: 0.92, latCentral: 0.95, wideWrong: 0.96, wideCentral: 0.98 };

export function sideFactor(p: Pick<RatedPlayer, 'flank'>, slot: Pos, y: number | undefined): number {
  if (y == null || slot === 'GOL' || slot === 'ZAG' || slot === 'VOL') return 1;
  const lane = laneOf(y);
  if (lane === 1) return 1;
  const s = p.flank ?? 'C';
  if (s === (lane === 0 ? 'L' : 'R')) return 1;
  if (slot === 'LAT') return s === 'C' ? SIDE_PENALTY.latCentral : SIDE_PENALTY.latWrong;
  return s === 'C' ? SIDE_PENALTY.wideCentral : SIDE_PENALTY.wideWrong;
}

/** A player's strength in a slot: força × position fit × side (when the slot's y is given) × fitness × morale. */
export function effective(p: RatedPlayer, slot: Pos, y?: number): number {
  const f = p.fitness / 100;
  const fit = 0.7 + 0.3 * f - FATIGUE.steep * Math.max(0, FATIGUE.knee - f);
  const mor = 0.95 + 0.1 * (p.morale / 100);
  return p.str * posFactor(p.pos, slot) * sideFactor(p, slot, y) * fit * mor;
}

/** How much each position adds to its lane's attack and to its lane's defence. */
const LANE_ATT: Record<Pos, number> = { GOL: 0, ZAG: 0.05, LAT: 0.5, VOL: 0.25, MEI: 0.8, ATA: 1 };
const LANE_DEF: Record<Pos, number> = { GOL: 0, ZAG: 1, LAT: 1, VOL: 0.7, MEI: 0.3, ATA: 0.05 };

/**
 * Attack and defence of each lane (left, centre, right) relative to the whole team (1 = average): the quality
 * of the players there, and a little for how many there are. Kept within ±20%.
 */
export function laneStrengths(slots: Slot[], onPitch: (RatedPlayer | null)[]): { att: [number, number, number]; def: [number, number, number] } {
  const calc = (W: Record<Pos, number>): [number, number, number] => {
    const sum = [0, 0, 0];
    const wsum = [0, 0, 0];
    for (let i = 0; i < slots.length; i++) {
      const sl = slots[i];
      const pl = onPitch[i];
      if (!pl || sl.pos === 'GOL') continue;
      const w = W[sl.pos];
      const ln = laneOf(sl.y);
      sum[ln] += w * effective(pl, sl.pos, sl.y);
      wsum[ln] += w;
    }
    const tw = wsum[0] + wsum[1] + wsum[2];
    if (!tw) return [1, 1, 1];
    const all = (sum[0] + sum[1] + sum[2]) / tw;
    return [0, 1, 2].map((k) => {
      if (!wsum[k]) return 0.8;
      const rel = (sum[k] / wsum[k] / all) * (0.85 + 0.15 * Math.min(1.5, wsum[k] / (tw / 3)));
      return Math.max(0.8, Math.min(1.2, rel));
    }) as [number, number, number];
  };
  return { att: calc(LANE_ATT), def: calc(LANE_DEF) };
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
    const e = pl ? effective(pl, sl.pos, sl.y) : 0;
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
    // a thin (or short-handed) sector loses up to 40%, a stacked one gains the same way
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
