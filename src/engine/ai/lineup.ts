import type { Formation, GameState, Lineup, Player, Pos, Tactics } from '../types';
import { FORMATION_LIST, slotsFor, type Slot } from '../match/formations';
import { computeRatings, effective, overall } from '../match/ratings';

export const BENCH_SIZE = 9;

export function isAvailable(p: Player, compId: string | null): boolean {
  if (p.injury > 0) return false;
  if (compId && (p.ban[compId] ?? 0) > 0) return false;
  return true;
}

/** A preset formation or full tactics (which may carry custom positions). */
export type Shape = Formation | Pick<Tactics, 'formation' | 'shape'>;

export function slotsOf(shape: Shape): Slot[] {
  return slotsFor(typeof shape === 'string' ? { formation: shape } : shape);
}

/** Greedy best-fit lineup for a formation. */
export function autoLineup(squad: Player[], shape: Shape, compId: string | null): Lineup {
  const slots = slotsOf(shape);
  const avail = squad.filter((p) => isAvailable(p, compId));
  const pairs: { s: number; p: Player; e: number }[] = [];
  for (let si = 0; si < slots.length; si++) {
    for (const p of avail) pairs.push({ s: si, p, e: effective(p, slots[si].pos) });
  }
  pairs.sort((a, b) => b.e - a.e);
  const xi: (number | null)[] = slots.map(() => null);
  const used = new Set<number>();
  for (const pr of pairs) {
    if (xi[pr.s] != null || used.has(pr.p.id)) continue;
    xi[pr.s] = pr.p.id;
    used.add(pr.p.id);
  }
  const rest = avail.filter((p) => !used.has(p.id)).sort((a, b) => b.str * (b.fitness / 100) - a.str * (a.fitness / 100));
  const bench: number[] = [];
  const gk = rest.find((p) => p.pos === 'GOL');
  if (gk) bench.push(gk.id);
  // try to cover each outfield line on the bench
  const lines: Pos[] = ['ZAG', 'LAT', 'VOL', 'MEI', 'ATA'];
  for (const ln of lines) {
    const c = rest.find((p) => p.pos === ln && !bench.includes(p.id));
    if (c && bench.length < BENCH_SIZE) bench.push(c.id);
  }
  for (const p of rest) {
    if (bench.length >= BENCH_SIZE) break;
    if (!bench.includes(p.id) && p.pos !== 'GOL') bench.push(p.id);
  }
  return { xi, bench };
}

export function lineupRating(squad: Player[], lineup: Lineup, formation: Formation, tactics?: Tactics): number {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const t: Tactics = tactics ?? { formation, mentality: 'equilibrada', marking: 'zona', style: 'toque' };
  const r = computeRatings(
    slotsFor(t),
    lineup.xi.map((id) => (id != null ? (byId.get(id) ?? null) : null)),
    t,
  );
  return overall(r);
}

/** Pick the formation that gives the best overall rating for this squad. */
export function bestFormation(squad: Player[], compId: string | null = null): Formation {
  let best: Formation = '4-4-2';
  let bestR = -1;
  for (const f of FORMATION_LIST) {
    const r = lineupRating(squad, autoLineup(squad, f, compId), f);
    if (r > bestR + 0.15) {
      bestR = r;
      best = f;
    }
  }
  return best;
}

/** Squad strength estimate (best XI rating), used for expectations and AI decisions. */
export function squadStrength(squad: Player[]): number {
  if (squad.length < 11) return squad.reduce((a, p) => a + p.str, 0) / 11;
  const f: Formation = '4-4-2';
  const fresh = squad.map((p) => ({ ...p, fitness: 100, morale: 60, injury: 0, ban: {} }));
  return lineupRating(fresh, autoLineup(fresh, f, null), f);
}

/** Make sure a human-set lineup is valid for a match; fill holes with the best available players. */
export function repairLineup(squad: Player[], lineup: Lineup, shape: Shape, compId: string | null): Lineup {
  const slots = slotsOf(shape);
  const byId = new Map(squad.map((p) => [p.id, p]));
  const ok = (id: number | null) => id != null && byId.has(id) && isAvailable(byId.get(id)!, compId);
  const xi: (number | null)[] = slots.map((_, i) => (ok(lineup.xi[i] ?? null) ? lineup.xi[i]! : null));
  const used = new Set(xi.filter((x): x is number => x != null));
  let bench = lineup.bench.filter((id) => ok(id) && !used.has(id));
  for (let i = 0; i < slots.length; i++) {
    if (xi[i] != null) continue;
    const cands = squad
      .filter((p) => isAvailable(p, compId) && !used.has(p.id))
      .sort((a, b) => effective(b, slots[i].pos) - effective(a, slots[i].pos));
    if (cands[0]) {
      xi[i] = cands[0].id;
      used.add(cands[0].id);
      bench = bench.filter((id) => id !== cands[0].id);
    }
  }
  if (bench.length < BENCH_SIZE) {
    const extra = squad
      .filter((p) => isAvailable(p, compId) && !used.has(p.id) && !bench.includes(p.id))
      .sort((a, b) => b.str - a.str);
    for (const p of extra) {
      if (bench.length >= BENCH_SIZE) break;
      bench.push(p.id);
    }
  }
  return { xi, bench: bench.slice(0, BENCH_SIZE) };
}

/**
 * What stops a manager's own lineup from being used today: empty starter slots, and injured, suspended
 * or departed players in the team or on the bench. Empty when the club plays no match today or picks
 * its team automatically.
 */
export function lineupIssues(state: GameState, clubId: number, draft?: { lineup: Lineup; auto: boolean }): string[] {
  const club = state.clubs[clubId];
  const lineup = draft?.lineup ?? club?.lineup;
  if (!club || !lineup || (draft ? draft.auto : club.autoLineup)) return [];
  const f = Object.values(state.fixtures).find((x) => x.date === state.meta.date && x.hg == null && (x.home === clubId || x.away === clubId));
  if (!f) return [];
  const out: string[] = [];
  const why = (id: number): string | null => {
    const p = state.players[id];
    if (!p || p.clubId !== clubId) return `${p?.name ?? 'Um jogador'} não é mais do clube`;
    if (p.injury > 0) return `${p.name} está lesionado`;
    if ((p.ban[f.comp] ?? 0) > 0) return `${p.name} está suspenso`;
    return null;
  };
  const empty = lineup.xi.filter((x) => x == null).length + Math.max(0, 11 - lineup.xi.length);
  if (empty) out.push(`Falta${empty > 1 ? 'm' : ''} ${empty} titular${empty > 1 ? 'es' : ''}`);
  for (const id of lineup.xi) {
    const w = id != null ? why(id) : null;
    if (w) out.push(`${w} e está entre os titulares`);
  }
  for (const id of lineup.bench) {
    const w = why(id);
    if (w) out.push(`${w} e está no banco`);
  }
  return out;
}
