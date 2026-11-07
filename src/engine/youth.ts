// The youth team (base), Brasfoot style: human clubs keep their academy players apart from the first team.
// Juniors train and play youth matches (their stats hint at how good they are), but their força stays hidden
// until the manager promotes them. They age out at 20: promoted if promising, released otherwise.
import { fillerLevel, generatePlayer } from './generator';
import { ceilingFor, starsFor } from './potential';
import type { Rng } from './rng';
import type { Club, GameState, Player, Pos } from './types';
import { addNews, age, expectedWage, roundMoney, squadOf } from './util';

/** Most juniors a club keeps. */
export const YOUTH_MAX = 14;
/** A youth team starts with this many players. */
export const YOUTH_START = 7;

export function juniorsOf(state: GameState, clubId: number): Player[] {
  const out: Player[] = [];
  for (const id in state.players) {
    const p = state.players[id];
    if (p.junior && p.clubId === clubId) out.push(p);
  }
  return out;
}

const POSITIONS: Pos[] = ['GOL', 'ZAG', 'ZAG', 'LAT', 'VOL', 'MEI', 'MEI', 'ATA', 'ATA'];

/** A new academy player (15-18): a better training centre turns up better and more promising ones. */
export function makeJunior(state: GameState, rng: Rng, club: Club, ageY: number): Player {
  const p = generatePlayer(state, rng, {
    pos: rng.pick(POSITIONS),
    str: fillerLevel(club) - 22 + (ageY - 15) * 2 + rng.normal(0, 5) + club.tc.level,
    nat: club.country,
    ageY,
    clubId: club.id,
    clubRep: club.rep,
  });
  p.stars = starsFor(p.str, ageY, rng, club.tc.level);
  p.pot = Math.max(p.str, ceilingFor(p.stars));
  p.junior = true;
  p.contractEnd = state.meta.season + 3;
  p.wage = roundMoney(300 + rng.range(0, 300) + club.rep * 3);
  p.num = 0;
  p.ys = [0, 0, 0, 0];
  state.players[p.id] = p;
  return p;
}

/** Give a club that a human takes over a youth team, if it has none yet. */
export function ensureYouthTeam(state: GameState, rng: Rng, club: Club) {
  const have = juniorsOf(state, club.id).length;
  for (let i = have; i < YOUTH_START; i++) makeJunior(state, rng, club, rng.int(15, 18));
}

/** Youth matches on weekend dates: juniors play, score and get ratings that hint at their level. */
export function youthMatches(state: GameState, rng: Rng) {
  if (state.calendar[state.meta.date]?.wd !== 'dom') return;
  for (const id in state.players) {
    const p = state.players[id];
    if (!p.junior || p.clubId == null || p.injury > 0 || !rng.chance(0.75)) continue;
    const club = state.clubs[p.clubId];
    const rel = p.str - (fillerLevel(club) - 18);
    const ys = (p.ys ??= [0, 0, 0, 0]);
    ys[0]++;
    const scoring = { ATA: 0.45, MEI: 0.2, VOL: 0.08, LAT: 0.05, ZAG: 0.05, GOL: 0 }[p.pos] * Math.max(0.3, 1 + rel / 15);
    let goals = 0;
    while (goals < 4 && rng.chance(scoring / (1 + goals))) goals++;
    const ast = rng.chance(({ ATA: 0.2, MEI: 0.28, VOL: 0.12, LAT: 0.14, ZAG: 0.04, GOL: 0.01 }[p.pos] ?? 0.1) * Math.max(0.3, 1 + rel / 15)) ? 1 : 0;
    ys[1] += goals;
    ys[2] += ast;
    const rating = Math.max(4, Math.min(9.8, 6.3 + rel / 9 + goals * 0.7 + ast * 0.4 + rng.normal(0, 0.55)));
    ys[3] += Math.round(rating * 10);
  }
}

/** First-team contract for a promoted junior. */
export function promote(state: GameState, p: Player) {
  const club = state.clubs[p.clubId!];
  p.junior = false;
  p.contractEnd = state.meta.season + 2;
  p.wage = roundMoney(Math.max(550, expectedWage(p, state.meta.season, club.rep) * 0.6));
  p.num = 0;
}

/**
 * Season end for the youth teams of human clubs: juniors turning 20 move up (if promising and there is room)
 * or leave, the youngest intake arrives, and the team is trimmed to YOUTH_MAX.
 */
export function youthSeasonEnd(state: GameState, rng: Rng, club: Club) {
  const next = state.meta.season + 1;
  const m = club.managerId;
  for (const p of juniorsOf(state, club.id)) {
    if (age(p, next) < 20) continue;
    if (p.stars >= 2 && squadOf(state, club.id).length < 34) {
      promote(state, p);
      addNews(state, 'info', `${p.name} completou 20 anos e subiu da base para o profissional (${'★'.repeat(p.stars) || 'sem estrelas'}).`, [club.id], m);
    } else {
      release(state, p);
      addNews(state, 'info', `${p.name} completou 20 anos sem espaço no profissional e deixa a base.`, [club.id], m);
    }
  }
  const n = rng.int(2, 4) + (club.tc.level >= 4 ? 1 : 0);
  const fresh: Player[] = [];
  for (let i = 0; i < n; i++) fresh.push(makeJunior(state, rng, club, rng.int(15, 16)));
  const best = fresh.sort((a, b) => b.stars - a.stars)[0];
  if (m && best) addNews(state, 'info', `Peneira da base: ${n} garotos chegam ao ${club.name}; o mais promissor é ${best.name} (${best.pos}, ${'★'.repeat(best.stars) || 'sem estrelas'}).`, [club.id], m);
  const all = juniorsOf(state, club.id);
  if (all.length > YOUTH_MAX) {
    const cut = [...all].sort((a, b) => a.stars - b.stars || b.birth - a.birth).slice(0, all.length - YOUTH_MAX);
    for (const p of cut) release(state, p);
  }
}

/** A junior leaves the club (free agent, no longer in the youth team). */
export function release(state: GameState, p: Player) {
  p.junior = false;
  p.clubId = null;
  p.idle = 0;
  p.num = 0;
  void state;
}
