// Penalty shootouts: the order of takers, who kicks next, when it is decided, and how a kick ends.
// Directions are as seen on screen, from behind the taker: 0 = left, 1 = middle, 2 = right. A keeper who
// dives the way the ball goes has a fair chance to save; one who guesses wrong almost never does.
import type { Rng } from '../rng';

export type PkDir = 0 | 1 | 2;
export type PkOutcome = 0 | 1 | 2; // goal, save, miss

export interface PkTaker {
  id: number;
  name: string;
  str: number;
  /** penalty specialist (trait "cobranças") */
  pen: boolean;
  gk: boolean;
}

export interface PkKick {
  side: 0 | 1;
  taker: number;
  dir: PkDir;
  dive: PkDir;
  out: PkOutcome;
}

/** Penalty skill of a taker: força plus a bonus for specialists; keepers are poor takers. */
export const takerSkill = (t: PkTaker) => (t.gk ? t.str - 20 : t.str) + (t.pen ? 8 : 0);

/** Best five takers first (specialists ahead), then the rest, keeper last. */
export function defaultOrder(takers: PkTaker[]): number[] {
  return [...takers].sort((a, b) => Number(a.gk) - Number(b.gk) || takerSkill(b) - takerSkill(a)).map((t) => t.id);
}

/** How a kick ends, given the taker's skill, the keeper's rating, where the ball goes and where he dives. */
export function kickOutcome(taker: PkTaker, keeper: number, dir: PkDir, dive: PkDir, rng: Rng): PkOutcome {
  const s = takerSkill(taker);
  // aiming for a corner risks missing the target; down the middle rarely misses
  const miss = Math.min(0.16, Math.max(0.02, 0.06 + (70 - s) / 260)) * (dir === 1 ? 0.45 : 1);
  if (rng.chance(miss)) return 2;
  let save: number;
  if (dive === dir) save = dir === 1 ? 0.72 : Math.min(0.72, Math.max(0.3, 0.46 + (keeper - s) / 160));
  else save = Math.min(0.1, Math.max(0.01, 0.04 + (keeper - 70) / 400));
  return rng.chance(save) ? 1 : 0;
}

/** Where an AI taker shoots: usually a corner, sometimes down the middle. */
export function aiShot(rng: Rng): PkDir {
  const r = rng.next();
  return r < 0.43 ? 0 : r < 0.57 ? 1 : 2;
}

/**
 * Where an AI keeper dives: mostly to a corner, but he notices takers who keep going down the middle and
 * starts staying put against them.
 */
export function aiDive(rng: Rng, shotsSoFar: PkDir[]): PkDir {
  const middles = shotsSoFar.filter((d) => d === 1).length;
  const stay = Math.min(0.55, 0.1 + middles * 0.18);
  const r = rng.next();
  return r < stay ? 1 : r < stay + (1 - stay) / 2 ? 0 : 2;
}

/** The state of one shootout: kicks so far, score, and the standard five-each-then-sudden-death rules. */
export class Shootout {
  kicks: PkKick[] = [];
  score: [number, number] = [0, 0];
  constructor(
    readonly first: 0 | 1,
    public order: [number[], number[]],
    /** stop after this many kicks (1 for a penalty during the match) */
    readonly limit = 0,
  ) {}

  taken(side: 0 | 1): number {
    return this.kicks.filter((k) => k.side === side).length;
  }

  /** Decided once one side can no longer catch up, or after an equal number of kicks (5+) with a winner. */
  decided(): boolean {
    if (this.limit && this.kicks.length >= this.limit) return true;
    const [a, b] = [this.taken(0), this.taken(1)];
    const [ga, gb] = this.score;
    if (a <= 5 && b <= 5 && (a < 5 || b < 5)) {
      if (ga + (5 - a) < gb || gb + (5 - b) < ga) return true;
      return false;
    }
    return a === b && ga !== gb;
  }

  /** Who kicks next (null when it is over). */
  next(): { side: 0 | 1; taker: number } | null {
    if (this.decided()) return null;
    const [a, b] = [this.taken(0), this.taken(1)];
    const side: 0 | 1 = a === b ? this.first : a < b ? 0 : 1;
    const list = this.order[side];
    return { side, taker: list[this.taken(side) % Math.max(1, list.length)] };
  }

  record(k: PkKick) {
    this.kicks.push(k);
    if (k.out === 0) this.score[k.side]++;
  }

  /** Directions a side's takers have chosen so far (what a keeper can read). */
  shotsBy(side: 0 | 1): PkDir[] {
    return this.kicks.filter((k) => k.side === side).map((k) => k.dir);
  }
}

/** Play a whole shootout with AI choices on both sides (matches nobody is watching, or "simular rápido"). */
export function autoShootout(so: Shootout, takers: Map<number, PkTaker>, keepers: [number, number], rng: Rng): [number, number] {
  let guard = 0;
  for (let n = so.next(); n && guard++ < 60; n = so.next()) {
    const t = takers.get(n.taker) ?? { id: n.taker, name: '', str: 60, pen: false, gk: false };
    const dir = aiShot(rng);
    const dive = aiDive(rng, so.shotsBy(n.side));
    so.record({ side: n.side, taker: n.taker, dir, dive, out: kickOutcome(t, keepers[1 - n.side], dir, dive, rng) });
  }
  if (so.score[0] === so.score[1]) so.score[rng.int(0, 1)]++;
  return so.score;
}
