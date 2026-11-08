import { ceilingFor, potentialSeen, starsFor } from './potential';
import { coachRng, fireManager } from './board';
import { careerBonus } from './development';
import { aiCoachOf, sackCoach } from './coaches';
import { seasonCoachAwards } from './awards';
import { homeGameCounts, wageBudget } from './economy';
import { juniorsOf, promote, release, youthSeasonEnd } from './youth';
import { objectiveDelta, seasonReviews } from './review';
import { isRich, richPay, statureGap, STATURE_MAX_GAP } from './transfers';
import { CORE_PLAYERS, foreignShareFor, startSeason } from './world';
import { academyLevel, assignNumbers, fillerLevel, fillSquad, generatePlayer, SQUAD_SHAPE } from './generator';
import type { Rng } from './rng';
import type { Club, GameState, Player, Pos, SeasonHistory } from './types';
import { absDate, addNews, age, clamp, expectedWage, formatMoney, roundMoney, sortTable, squadIndex, squadOf } from './util';

/** Run end-of-season processing and start the next season. */
export function endSeason(state: GameState, rng: Rng, present: Set<string>) {
  const season = state.meta.season;
  const hist: SeasonHistory = { season, champions: {}, topScorers: {} };

  // final positions, champions, top scorers
  const ranks: Record<string, number[]> = {};
  for (const comp of Object.values(state.comps)) {
    if (comp.champion != null) hist.champions[comp.id] = comp.champion;
    if (comp.cfg.kind === 'league') ranks[comp.id] = sortTable(comp.table, state.clubs);
  }
  const scorers = new Map<string, { pid: number; goals: number }>();
  for (const f of Object.values(state.fixtures)) {
    if (state.comps[f.comp]?.cfg.kind !== 'league') continue;
    for (const g of f.goals) {
      const key = `${f.comp}:${g.pid}`;
      const cur = scorers.get(key) ?? { pid: g.pid, goals: 0 };
      cur.goals++;
      scorers.set(key, cur);
    }
  }
  for (const [key, v] of scorers) {
    const comp = key.split(':')[0];
    const best = hist.topScorers[comp];
    if (!best || v.goals > best.goals) {
      const p = state.players[v.pid];
      hist.topScorers[comp] = { pid: v.pid, name: p?.name ?? '?', goals: v.goals, clubId: p?.clubId ?? null };
    }
  }
  state.history.push(hist);
  // the human managers' season in review, before anyone moves
  seasonReviews(state, ranks);
  // coach of the season in each top division, before anyone is sacked
  seasonCoachAwards(state, ranks);
  state.prev = {
    ranks,
    winners: Object.fromEntries(Object.values(state.comps).filter((c) => c.cfg.kind !== 'league' && c.champion != null).map((c) => [c.id, c.champion!])),
  };

  // league prize money by position and board end-of-season verdict
  for (const [lid, order] of Object.entries(ranks)) {
    const comp = state.comps[lid];
    const n = order.length;
    order.forEach((cid, i) => {
      const club = state.clubs[cid];
      const share = 1 - (i / Math.max(1, n - 1)) * 0.9;
      const prize = Math.round(comp.cfg.prize * share * 0.5);
      club.balance += prize;
      club.ledger.prizes += prize;
      seasonVerdict(state, club, i + 1, n, present);
    });
  }

  promotionsAndRelegations(state, ranks, rng);
  contractsAndLoans(state, rng);
  retirements(state, rng);
  youthIntake(state, rng);
  maintainSquads(state, rng);
  reputationDrift(state, ranks);

  // human managers: record the season
  for (const m of Object.values(state.managers)) {
    if (m.clubId != null) m.history.push({ season, clubId: m.clubId, note: 'Temporada concluída' });
  }

  state.meta.season = season + 1;
  startSeason(state, rng);
  state.meta.seasonOver = true;
  addNews(state, 'info', `Começa a temporada ${state.meta.season}!`);
}

export function seasonVerdict(state: GameState, club: Club, pos: number, n: number, present: Set<string>) {
  let delta = objectiveDelta(club.board.goal, pos, n);
  const m = club.managerId ? state.managers[club.managerId] : null;
  // the benefit of the doubt, half the blame for a missed objective: a manager in his first season at the club,
  // or one who won a trophy with it this season or in the two before
  const firstSeason = !!m && Math.floor(m.since / 100) >= state.meta.season;
  const trophy =
    !!m &&
    state.history.some((h) => h.season >= state.meta.season - 2 && h.season >= Math.floor(m.since / 100) && Object.values(h.champions).includes(club.id));
  // a manager who arrived after the halfway point inherited the season: the objective is not his to answer for
  const lateArrival = firstSeason && m!.since % 100 >= state.calendar.length / 2;
  if (lateArrival && delta < 0) delta = 0;
  else if ((firstSeason || trophy) && delta < 0) delta /= 2;
  club.board.conf = clamp(club.board.conf + delta, 0, 100);
  // an AI coach: his reputation follows the season, and a board this unhappy usually sacks him
  const ai = m ? null : aiCoachOf(state, club);
  if (ai) {
    ai.rep = clamp(ai.rep + delta / 6, 5, 100);
    const rng = coachRng(state, club);
    if (club.board.conf < 20 && rng.chance(0.7)) {
      sackCoach(state, rng, club);
      club.board.conf = 50;
    }
  }
  if (m) {
    m.rep = clamp(m.rep + delta / 6, 5, 100);
    if (club.board.conf < 20 && present.has(m.id)) fireManager(state, m, 'objetivo da temporada não cumprido');
    else if (lateArrival && objectiveDelta(club.board.goal, pos, n) < 0 && present.has(m.id))
      addNews(state, 'board', `O objetivo do ${club.name} não foi cumprido, mas você chegou com a temporada em andamento: a diretoria julga o seu trabalho a partir da próxima.`, [club.id], m.id);
    else if ((firstSeason || trophy) && delta < 0 && present.has(m.id))
      addNews(state, 'board', `A diretoria do ${club.name} mantém você no cargo apesar do objetivo não cumprido, mas espera muito mais na próxima temporada.`, [club.id], m.id);
  }
}

function promotionsAndRelegations(state: GameState, ranks: Record<string, number[]>, rng: Rng) {
  const moves: { club: number; to: string | null }[] = [];
  for (const cfg of state.config) {
    if (cfg.kind !== 'league') continue;
    const order = ranks[cfg.id];
    if (!order) continue;
    if (cfg.up) for (const cid of order.slice(0, cfg.up.n)) moves.push({ club: cid, to: cfg.up.comp });
    if (cfg.down) {
      let down = order.slice(order.length - cfg.down.n);
      if (cfg.down.comp === 'POOL') {
        // below this league there are only the estaduais: a few games a year, no career for a human manager.
        // A club that still has one stays up, and the next club above goes down in its place.
        const kept = down.filter((cid) => state.clubs[cid].managerId);
        if (kept.length) {
          const safe = order.slice(cfg.up?.n ?? 0, order.length - cfg.down.n).filter((cid) => !state.clubs[cid].managerId);
          const instead = safe.slice(Math.max(0, safe.length - kept.length));
          down = [...down.filter((cid) => !state.clubs[cid].managerId), ...instead];
          kept.forEach((cid, i) => {
            const club = state.clubs[cid];
            const other = instead[instead.length - 1 - i] != null ? state.clubs[instead[instead.length - 1 - i]] : null;
            addNews(
              state,
              'releg',
              `Não há divisão nacional abaixo da ${cfg.short}: o ${club.name} continua nela${other ? ` e o ${other.name} cai no lugar dele` : ''}.`,
              other ? [club.id, other.id] : [club.id],
              club.managerId,
            );
          });
        }
      }
      for (const cid of down) moves.push({ club: cid, to: cfg.down.comp === 'POOL' ? null : cfg.down.comp });
      if (cfg.down.comp === 'POOL') {
        // promote the best estadual-only clubs of the country into this league (one with a human manager first,
        // as in older saves where such a club could drop out)
        const pool = Object.values(state.clubs)
          .filter((c) => c.country === cfg.country && !c.league && !c.contOnly)
          .map((c) => ({ c, k: (c.managerId ? 1000 : 0) + c.rep + c.power * 0.5 + rng.range(-6, 6) }))
          .sort((a, b) => b.k - a.k)
          .slice(0, cfg.down.n);
        for (const { c } of pool) moves.push({ club: c.id, to: cfg.id });
      }
    }
  }
  for (const mv of moves) {
    const club = state.clubs[mv.club];
    const from = club.league;
    const fromLvl = from ? (state.config.find((x) => x.id === from)?.level ?? 3) : 9;
    const toLvl = mv.to ? (state.config.find((x) => x.id === mv.to)?.level ?? 3) : 9;
    club.league = mv.to;
    const name = mv.to ? (state.config.find((x) => x.id === mv.to)?.name ?? mv.to) : 'fora das divisões nacionais';
    if (toLvl < fromLvl) {
      club.baseIncome = Math.round(club.baseIncome * 1.45);
      club.rep = Math.min(99, club.rep + 3);
      addNews(state, 'promo', `${club.name} conquista o acesso: ${name}.`, [club.id]);
    } else {
      club.baseIncome = Math.round(club.baseIncome * 0.65);
      club.rep = Math.max(5, club.rep - 3);
      addNews(state, 'releg', `${club.name} é rebaixado: ${name}.`, [club.id]);
    }
  }
}

/**
 * An AI club extends a young core player a season early, as real clubs do, at a wage that keeps him: otherwise
 * every star entering his final year could sign a pre-contract elsewhere from mid-season and leave for free.
 */
function earlyRenewal(
  state: GameState,
  p: Player,
  next: number,
  rng: Rng,
  idx: Map<number, Player[]>,
  roomOf: (c: Club) => number,
  room: Map<number, number>,
  homes: ReturnType<typeof homeGameCounts>,
) {
  const club = p.clubId != null ? state.clubs[p.clubId] : null;
  if (!club || club.managerId || p.loan || p.pre || age(p, state.meta.season) >= 30) return;
  const squad = idx.get(club.id) ?? [];
  const core = squad.filter((x) => x.id !== p.id && x.str > p.str).length < CORE_PLAYERS;
  if (!core || !rng.chance(roomOf(club) >= 0 ? 0.75 : 0.5)) return;
  const rich = roomOf(club) > 0.15 * wageBudget(state, club, homes);
  const wage = roundMoney(Math.max(p.wage, expectedWage(p, next, club.rep) * (rich ? rng.range(1.05, 1.2) : 1)));
  room.set(club.id, roomOf(club) - (wage - p.wage) * 12);
  p.contractEnd = next + rng.int(2, 3);
  p.wage = wage;
}

/** The players a club counts as its first team: pay rises go to them. */
export const FIRST_TEAM = 14;

/**
 * Rich AI clubs pay their first team what it is worth: at the season end, each of the best 14 whose wage lags behind
 * the going rate × richPay (1.15 for a rich club, up to 1.45 with four years of income in the bank) gets a rise to
 * it. Money in the bank goes on the team instead of piling up, and less of it as the pile shrinks.
 */
export function aiPayRises(state: GameState, idx: Map<number, Player[]>, next: number) {
  for (const c of Object.values(state.clubs)) {
    if (c.managerId || !(c.league || c.contOnly) || !isRich(c)) continue;
    const k = richPay(c);
    const first = (idx.get(c.id) ?? []).filter((p) => !p.loan && !p.junior).sort((a, b) => b.str - a.str).slice(0, FIRST_TEAM);
    for (const p of first) {
      const due = roundMoney(expectedWage(p, next, c.rep) * k);
      if (p.wage < due) p.wage = due;
    }
  }
}

function contractsAndLoans(state: GameState, rng: Rng) {
  const next = state.meta.season + 1;
  const idx = squadIndex(state);
  aiPayRises(state, idx, next);
  const homes = homeGameCounts(state);
  // yearly wage room per AI club: over budget, only key players get new contracts
  const room = new Map<number, number>();
  const roomOf = (c: Club) => {
    let r = room.get(c.id);
    if (r == null) {
      r = wageBudget(state, c, homes) - (idx.get(c.id) ?? []).reduce((a, p) => a + p.wage, 0) * 12;
      room.set(c.id, r);
    }
    return r;
  };
  for (const p of Object.values(state.players)) {
    // a loan that ends now, or a loaned player whose contract ends: back to his club, which then decides on
    // his contract below (before, he came back with an expired contract, or was let go with a loan still open)
    if (p.loan && (p.loan.until < absDate(next, 0) || p.contractEnd < next)) {
      const back = state.clubs[p.loan.from];
      const was = p.clubId != null ? state.clubs[p.clubId] : null;
      if (was) {
        was.lineup.xi = was.lineup.xi.map((x) => (x === p.id ? null : x));
        was.lineup.bench = was.lineup.bench.filter((x) => x !== p.id);
      }
      p.loan = null;
      p.clubId = back ? back.id : null;
      p.num = 0;
    }
    if (p.clubId == null) {
      p.idle++;
      continue;
    }
    if (p.junior || p.contractEnd > next) continue;
    if (p.contractEnd === next) {
      earlyRenewal(state, p, next, rng, idx, roomOf, room, homes);
      continue;
    }
    if (p.pre && state.clubs[p.pre.club] && p.pre.club !== p.clubId) {
      joinOnPreContract(state, p, next);
      continue;
    }
    const club = state.clubs[p.clubId];
    const a = age(p, state.meta.season);
    if (!club.managerId) {
      const squad = idx.get(club.id) ?? [];
      const median = [...squad].sort((x, y) => y.str - x.str)[Math.floor(squad.length / 2)]?.str ?? 50;
      const tight = roomOf(club) < 0;
      // a starter (one of the best 11, counting a player just back from a loan) is nearly always kept, even over
      // the wage budget: letting the first team walk out on free transfers drained the big European leagues
      const starter = squad.filter((x) => x.id !== p.id && x.str > p.str).length < 11;
      const keep = starter ? (tight ? 0.85 : 0.92) : p.str >= median + (tight ? 2 : -3) ? (tight ? 0.6 : 0.75) : 0;
      if (a < 33 && rng.chance(keep)) {
        // clubs with plenty of room in the budget pay above the going rate to keep their players
        const rich = roomOf(club) > 0.15 * wageBudget(state, club, homes);
        const wage = roundMoney(expectedWage(p, next, club.rep) * (rich ? rng.range(1.05, 1.3) : 1));
        room.set(club.id, roomOf(club) - (wage - p.wage) * 12);
        p.contractEnd = next + rng.int(0, 3);
        p.wage = wage;
        continue;
      }
      // the player leaves: his wages free up room
      room.set(club.id, roomOf(club) + p.wage * 12);
    }
    if (club.managerId && (club.autoRenewAll || club.autoRenew?.includes(p.id))) {
      const squad = idx.get(club.id) ?? [];
      const key = [...squad].sort((x, y) => y.str - x.str).slice(0, 11).some((x) => x.id === p.id);
      const before = p.wage;
      const r = autoRenewal(state, p, club, next, { room: roomOf(club), budget: wageBudget(state, club, homes), key });
      addNews(state, 'contract', r, [club.id], club.managerId);
      if (p.contractEnd >= next) {
        room.set(club.id, roomOf(club) - (p.wage - before) * 12);
        continue;
      }
      room.set(club.id, roomOf(club) + p.wage * 12);
    } else if (club.managerId) addNews(state, 'contract', `${p.name} deixa o ${club.name} ao fim do contrato.`, [club.id], club.managerId);
    p.clubId = null;
    p.salePrice = null;
    p.loanListed = null;
    p.auction = null;
    p.idle = 0;
    p.num = 0;
  }
}

/**
 * Automatic renewal for a human club (like Brasfoot's): the player signs on at what he asks (10% more under 30),
 * for 3 years (2 from 30, 1 from 33), unless he is 35 or older or unhappy (morale below 25). Returns the news text.
 */
export function autoRenewal(
  state: GameState,
  p: Player,
  club: Club,
  next: number,
  budget?: { room: number; budget: number; key: boolean },
): string {
  const a = age(p, state.meta.season);
  if (a >= 35) return `${p.name} (${a} anos) não renova: só contratos negociados na mão a partir dos 35. Ele deixa o ${club.name}.`;
  if (p.morale < 25) return `${p.name} está insatisfeito e recusou a renovação automática. Ele deixa o ${club.name}.`;
  const wage = roundMoney(expectedWage(p, next, club.rep) * (a < 30 ? 1.1 : 1));
  // within the wage budget; a regular starter may go up to 10% over it
  const extra = (Math.max(p.wage, wage) - p.wage) * 12;
  if (budget && extra > budget.room && !(budget.key && extra <= budget.room + budget.budget * 0.1)) {
    return `Renovação automática cancelada: ${p.name} pede ${formatMoney(wage)}/mês e a folha passaria do orçamento salarial. Ele deixa o ${club.name}.`;
  }
  const years = a >= 33 ? 1 : a >= 30 ? 2 : 3;
  p.wage = Math.max(p.wage, wage);
  p.contractEnd = next + years - 1;
  p.morale = Math.min(100, p.morale + 5);
  return `Renovação automática: ${p.name} fica até ${p.contractEnd} por ${formatMoney(p.wage)}/mês.`;
}

/** A player with a pre-contract moves to his new club when his contract ends. */
function joinOnPreContract(state: GameState, p: Player, next: number) {
  const pre = p.pre!;
  const from = p.clubId != null ? state.clubs[p.clubId] : null;
  const to = state.clubs[pre.club];
  if (from) {
    from.lineup.xi = from.lineup.xi.map((x) => (x === p.id ? null : x));
    from.lineup.bench = from.lineup.bench.filter((x) => x !== p.id);
  }
  p.clubId = to.id;
  p.wage = pre.wage;
  p.contractEnd = next + pre.years - 1;
  p.salePrice = null;
  p.loanListed = null;
  p.auction = null;
  p.pre = null;
  p.num = 0;
  p.idle = 0;
  p.joined = next;
  addNews(state, 'transfer', `${p.name} chega ao ${to.name} de graça, com o pré-contrato assinado${from ? ` (deixa o ${from.name})` : ''}.`, [to.id, ...(from ? [from.id] : [])]);
}

function retirements(state: GameState, rng: Rng) {
  for (const p of Object.values(state.players)) {
    const a = age(p, state.meta.season);
    // keepers and great players play on for longer
    const ra = a - careerBonus(p);
    let pr = 0;
    if (ra >= 33) pr = (ra - 32) * 0.12 + (p.str < 55 ? 0.2 : 0);
    if (p.clubId == null && p.idle >= 1) pr = Math.max(pr, a > 23 ? 0.75 : 0.3);
    if (p.clubId == null && p.idle >= 2) pr = 1;
    if (pr > 0 && rng.chance(Math.min(1, pr))) {
      if (p.clubId != null) {
        const c = state.clubs[p.clubId];
        c.lineup.xi = c.lineup.xi.map((x) => (x === p.id ? null : x));
        c.lineup.bench = c.lineup.bench.filter((x) => x !== p.id);
        if (p.str >= 75) addNews(state, 'info', `${p.name} anuncia a aposentadoria.`, [c.id]);
      }
      delete state.players[p.id];
    }
  }
  // keep the free-agent pool bounded
  const free = Object.values(state.players)
    .filter((p) => p.clubId == null)
    .sort((a, b) => b.str - a.str);
  for (const p of free.slice(900)) delete state.players[p.id];
}

function youthIntake(state: GameState, rng: Rng) {
  const nextSeason = state.meta.season + 1;
  for (const c of Object.values(state.clubs)) {
    // human clubs: the youth team (base) takes the new boys instead
    if (c.managerId) {
      youthSeasonEnd(state, rng, c);
      continue;
    }
    // a youth team left behind by a manager who moved on: the promising ones move up, the rest leave
    for (const j of juniorsOf(state, c.id)) {
      if (age(j, nextSeason) >= 18 && j.stars >= 2) promote(state, j);
      else release(state, j);
    }
    const n = c.league ? rng.int(2, 4) : rng.int(0, 2);
    const level = academyLevel(c);
    for (let i = 0; i < n; i++) {
      const ageY = rng.int(16, 18);
      const p: Player = generatePlayer(state, rng, {
        pos: rng.pick(['GOL', 'ZAG', 'ZAG', 'LAT', 'VOL', 'MEI', 'MEI', 'ATA', 'ATA'] as const),
        str: level - 18 + rng.normal(0, 5) + c.tc.level,
        nat: c.country,
        ageY: ageY - 1,
        clubId: c.id,
        clubRep: c.rep,
      });
      // academy prospects: a better training centre turns up more stars
      p.stars = starsFor(p.str, ageY - 1, rng, c.tc.level);
      p.pot = Math.max(p.str, ceilingFor(p.stars));
      p.contractEnd = nextSeason + 2;
      p.wage = roundMoney(Math.max(550, expectedWage(p, nextSeason, c.rep) * 0.6));
      state.players[p.id] = p;
      const seen = potentialSeen(p, c.id, state.meta.season).stars;
      if (c.managerId && seen >= 4) addNews(state, 'info', `Revelação da base: ${p.name} (${p.pos}, ${'★'.repeat(seen)}) sobe ao profissional.`, [c.id], c.managerId);
    }
  }
}

/** Keep AI squads playable (sign free agents or generate), trim oversized ones. */
function maintainSquads(state: GameState, rng: Rng) {
  const idx = squadIndex(state);
  const free = Object.values(state.players)
    .filter((p) => p.clubId == null)
    .sort((a, b) => b.str - a.str);
  for (const c of Object.values(state.clubs)) {
    let squad = idx.get(c.id) ?? [];
    // line-ups only name players still at the club
    c.lineup.xi = c.lineup.xi.map((id) => (id != null && state.players[id]?.clubId === c.id && !state.players[id].junior ? id : null));
    c.lineup.bench = c.lineup.bench.filter((id) => state.players[id]?.clubId === c.id && !state.players[id].junior);
    if (!c.managerId && squad.length > 32) {
      // loaned-in players are not the club's to let go
      const out = [...squad].filter((p) => !p.loan).sort((a, b) => a.str - b.str).slice(0, squad.length - 30);
      for (const p of out) {
        p.clubId = null;
        p.idle = 0;
        p.num = 0;
      }
      squad = squad.filter((p) => !out.includes(p));
    }
    // a human manager runs his own squad: the board only tops it up to a playable size, with free agents at the
    // club's own level whose wages fit what is left of the budget, else cheap youngsters (never a free upgrade)
    const human = !!c.managerId;
    const min = human ? 18 : c.league ? 22 : 20;
    if (squad.length < min) {
      // AI clubs fill gaps with free agents near their own level (stars only go where they want to play)
      const cap = human ? fillerLevel(c) + 2 : c.power + 2;
      let room = human ? wageBudget(state, c) - squad.reduce((a, p) => a + p.wage, 0) * 12 : Infinity;
      const signed: string[] = [];
      for (const p of free) {
        if (squad.length >= min) break;
        if (p.clubId != null) continue;
        if (p.str > cap || statureGap(state, p, c) > STATURE_MAX_GAP) continue;
        const wage = expectedWage(p, state.meta.season + 1, c.rep);
        if (wage * 12 > room) continue;
        room -= wage * 12;
        p.clubId = c.id;
        p.wage = wage;
        p.contractEnd = state.meta.season + 1 + rng.int(0, 2);
        p.idle = 0;
        p.joined = state.meta.season + 1;
        squad.push(p);
        signed.push(p.name);
      }
      const short = min - squad.length;
      if (short > 0 && human) {
        // local youngsters, a level below the first team, where the squad is thinnest
        for (let i = 0; i < short; i++) {
          const count = (pos: Pos) => squad.filter((p) => p.pos === pos).length;
          const pos = (Object.keys(SQUAD_SHAPE) as Pos[]).sort((a, b) => count(a) / SQUAD_SHAPE[a] - count(b) / SQUAD_SHAPE[b])[0];
          const p = generatePlayer(state, rng, { pos, str: academyLevel(c) - 8 + rng.normal(0, 3), nat: c.country, ageY: rng.int(18, 21), clubId: c.id, clubRep: c.rep });
          state.players[p.id] = p;
          squad.push(p);
        }
      } else if (short > 0) fillSquad(state, rng, c.id, squad, aiFillerLevel(c), foreignShareFor(c), min);
      if (human)
        addNews(
          state,
          'board',
          `A diretoria completou o elenco do ${c.name} para ter ${min} jogadores: ${[...signed, ...(short > 0 ? [`${short} jovens da região`] : [])].join(', ')}.`,
          [c.id],
          c.managerId,
        );
    }
    if (c.league || c.contOnly) ensureKeepers(state, rng, c, free);
  }
  // players generated at the season end (fillers, keepers) count their contract from the new season
  for (const p of Object.values(state.players)) {
    if (p.clubId != null && !p.junior && !p.loan && p.contractEnd <= state.meta.season) p.contractEnd = state.meta.season + 1 + rng.int(0, 2);
  }
  for (const squad of squadIndex(state).values()) assignNumbers(squad);
}

/**
 * Level of the players an AI club brings in to fill its squad: a little below its own level, but the big European
 * clubs (whose stars no free agent replaces) find good ones, so their leagues keep their level over the years.
 */
function aiFillerLevel(c: Club): number {
  const lvl = fillerLevel(c) - 2;
  return c.continent === 'EU' && c.rep >= 80 ? Math.max(lvl, c.power - 6) : lvl;
}

/**
 * Every club needs two goalkeepers. Contracts ending or a sale can leave a club without one: free-agent keepers
 * at the club's level sign (within the wage room for a human club), else young local keepers come up.
 */
export function ensureKeepers(state: GameState, rng: Rng, c: Club, free?: Player[]) {
  const squad = squadOf(state, c.id);
  let have = squad.filter((p) => p.pos === 'GOL').length;
  if (have >= 2) return;
  const human = !!c.managerId;
  let room = human ? wageBudget(state, c) - squad.reduce((a, p) => a + p.wage, 0) * 12 : Infinity;
  const cap = human ? fillerLevel(c) + 2 : c.power + 4;
  const pool = (free ?? Object.values(state.players)).filter((p) => p.clubId == null && p.pos === 'GOL').sort((a, b) => b.str - a.str);
  const signed: string[] = [];
  for (const p of pool) {
    if (have >= 2) break;
    if (p.clubId != null || p.str > cap || statureGap(state, p, c) > STATURE_MAX_GAP) continue;
    const wage = expectedWage(p, state.meta.season + 1, c.rep);
    if (wage * 12 > room) continue;
    room -= wage * 12;
    p.clubId = c.id;
    p.wage = wage;
    p.contractEnd = state.meta.season + 1 + rng.int(0, 1);
    p.idle = 0;
    p.num = 0;
    p.joined = state.meta.season;
    have++;
    signed.push(p.name);
  }
  while (have < 2) {
    const p = generatePlayer(state, rng, { pos: 'GOL', str: academyLevel(c) - 4 + rng.normal(0, 3), nat: c.country, ageY: rng.int(18, 21), clubId: c.id, clubRep: c.rep });
    state.players[p.id] = p;
    have++;
    signed.push(p.name);
  }
  assignNumbers(squadOf(state, c.id));
  if (human) addNews(state, 'board', `Sem goleiros suficientes, a diretoria do ${c.name} trouxe: ${signed.join(', ')}.`, [c.id], c.managerId);
}

function reputationDrift(state: GameState, ranks: Record<string, number[]>) {
  for (const [lid, order] of Object.entries(ranks)) {
    const lvl = state.config.find((x) => x.id === lid)?.level ?? 1;
    const n = order.length;
    order.forEach((cid, i) => {
      const c = state.clubs[cid];
      const target = (lvl === 1 ? 88 : lvl === 2 ? 62 : 45) - (i / n) * (lvl === 1 ? 30 : 20);
      c.rep = clamp(c.rep + (target - c.rep) * 0.08, 5, 99);
    });
  }
}
