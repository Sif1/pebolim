import { ceilingFor, starsFor } from './potential';
import { fireManager } from './board';
import { homeGameCounts, wageBudget } from './economy';
import { youthSeasonEnd } from './youth';
import { foreignShareFor, startSeason } from './world';
import { assignNumbers, fillerLevel, fillSquad, generatePlayer } from './generator';
import type { Rng } from './rng';
import type { Club, GameState, Player, SeasonHistory } from './types';
import { absDate, addNews, age, clamp, expectedWage, formatMoney, roundMoney, sortTable, squadIndex } from './util';

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
  const goal = club.board.goal;
  let delta = 0;
  if (goal === 'titulo') delta = pos === 1 ? 25 : pos <= 4 ? 0 : pos <= 8 ? -15 : -35;
  else if (goal === 'continental') delta = pos <= Math.round(n * 0.3) ? 15 : pos <= n / 2 ? -5 : -25;
  else if (goal === 'meio') delta = pos <= n - 4 ? 8 : -30;
  else if (goal === 'rebaixamento') delta = pos <= n - 4 ? 15 : -20;
  else if (goal === 'acesso') delta = pos <= 4 ? 25 : pos <= 8 ? -5 : -25;
  const m = club.managerId ? state.managers[club.managerId] : null;
  // a manager in his first season at the club gets the benefit of the doubt: half the blame for a missed objective
  const firstSeason = !!m && Math.floor(m.since / 100) >= state.meta.season;
  if (firstSeason && delta < 0) delta /= 2;
  club.board.conf = clamp(club.board.conf + delta, 0, 100);
  if (m) {
    m.rep = clamp(m.rep + delta / 6, 5, 100);
    if (club.board.conf < 20 && present.has(m.id)) fireManager(state, m, 'objetivo da temporada não cumprido');
    else if (firstSeason && delta < 0 && present.has(m.id))
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
      const down = order.slice(order.length - cfg.down.n);
      for (const cid of down) moves.push({ club: cid, to: cfg.down.comp === 'POOL' ? null : cfg.down.comp });
      if (cfg.down.comp === 'POOL') {
        // promote the best estadual-only clubs of the country into this league
        const pool = Object.values(state.clubs)
          .filter((c) => c.country === cfg.country && !c.league && !c.contOnly)
          .map((c) => ({ c, k: c.rep + c.power * 0.5 + rng.range(-6, 6) }))
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

function contractsAndLoans(state: GameState, rng: Rng) {
  const next = state.meta.season + 1;
  const idx = squadIndex(state);
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
    if (p.loan && p.loan.until < absDate(next, 0)) {
      const back = state.clubs[p.loan.from];
      p.loan = null;
      p.clubId = back ? back.id : null;
      p.num = 0;
      continue;
    }
    if (p.clubId == null) {
      p.idle++;
      continue;
    }
    if (p.junior || p.contractEnd >= next) continue;
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
      if (a < 33 && p.str >= median + (tight ? 2 : -3) && rng.chance(tight ? 0.6 : 0.75)) {
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
  addNews(state, 'transfer', `${p.name} chega ao ${to.name} de graça, com o pré-contrato assinado${from ? ` (deixa o ${from.name})` : ''}.`, [to.id, ...(from ? [from.id] : [])]);
}

function retirements(state: GameState, rng: Rng) {
  for (const p of Object.values(state.players)) {
    const a = age(p, state.meta.season);
    let pr = 0;
    if (a >= 33) pr = (a - 32) * 0.12 + (p.str < 55 ? 0.2 : 0);
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
    const n = c.league ? rng.int(2, 4) : rng.int(0, 2);
    const level = fillerLevel(c);
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
      if (c.managerId && p.stars >= 4) addNews(state, 'info', `Revelação da base: ${p.name} (${p.pos}, ${'★'.repeat(p.stars)}) sobe ao profissional.`, [c.id], c.managerId);
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
    if (!c.managerId && squad.length > 32) {
      const out = [...squad].sort((a, b) => a.str - b.str).slice(0, squad.length - 30);
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
      const cap = human ? fillerLevel(c) + 2 : c.power + 6;
      let room = human ? wageBudget(state, c) - squad.reduce((a, p) => a + p.wage, 0) * 12 : Infinity;
      const signed: string[] = [];
      for (const p of free) {
        if (squad.length >= min) break;
        if (p.clubId != null) continue;
        if (p.str > cap) continue;
        const wage = expectedWage(p, state.meta.season + 1, c.rep);
        if (wage * 12 > room) continue;
        room -= wage * 12;
        p.clubId = c.id;
        p.wage = wage;
        p.contractEnd = state.meta.season + 1 + rng.int(0, 2);
        p.idle = 0;
        squad.push(p);
        signed.push(p.name);
      }
      const short = min - squad.length;
      if (short > 0) fillSquad(state, rng, c.id, squad, fillerLevel(c) - 2, foreignShareFor(c), min);
      if (human)
        addNews(
          state,
          'board',
          `A diretoria completou o elenco do ${c.name} para ter ${min} jogadores: ${[...signed, ...(short > 0 ? [`${short} jovens da região`] : [])].join(', ')}.`,
          [c.id],
          c.managerId,
        );
    }
  }
  for (const squad of squadIndex(state).values()) assignNumbers(squad);
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
