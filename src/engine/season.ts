import { fireManager } from './board';
import { foreignShareFor, startSeason } from './world';
import { assignNumbers, fillSquad, generatePlayer, strForRep } from './generator';
import type { Rng } from './rng';
import type { Club, GameState, Player, SeasonHistory } from './types';
import { addNews, age, clamp, expectedWage, roundMoney, sortTable, squadIndex } from './util';

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

function seasonVerdict(state: GameState, club: Club, pos: number, n: number, present: Set<string>) {
  const goal = club.board.goal;
  let delta = 0;
  if (goal === 'titulo') delta = pos === 1 ? 25 : pos <= 4 ? 0 : pos <= 8 ? -15 : -35;
  else if (goal === 'continental') delta = pos <= Math.round(n * 0.3) ? 15 : pos <= n / 2 ? -5 : -25;
  else if (goal === 'meio') delta = pos <= n - 4 ? 8 : -30;
  else if (goal === 'rebaixamento') delta = pos <= n - 4 ? 15 : -20;
  else if (goal === 'acesso') delta = pos <= 4 ? 25 : pos <= 8 ? -5 : -25;
  club.board.conf = clamp(club.board.conf + delta, 0, 100);
  const m = club.managerId ? state.managers[club.managerId] : null;
  if (m) {
    m.rep = clamp(m.rep + delta / 6, 5, 100);
    if (club.board.conf < 20 && present.has(m.id)) fireManager(state, m, 'objetivo da temporada não cumprido');
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
  for (const p of Object.values(state.players)) {
    if (p.loan && p.loan.until < next) {
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
    if (p.contractEnd >= next) continue;
    const club = state.clubs[p.clubId];
    const a = age(p, state.meta.season);
    if (!club.managerId) {
      const squad = idx.get(club.id) ?? [];
      const median = [...squad].sort((x, y) => y.str - x.str)[Math.floor(squad.length / 2)]?.str ?? 50;
      if (a < 33 && p.str >= median - 3 && rng.chance(0.75)) {
        p.contractEnd = next + rng.int(0, 3);
        p.wage = expectedWage(p, next, club.rep);
        continue;
      }
    }
    if (club.managerId) addNews(state, 'contract', `${p.name} deixa o ${club.name} ao fim do contrato.`, [club.id], club.managerId);
    p.clubId = null;
    p.listed = false;
    p.idle = 0;
    p.num = 0;
  }
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
    const n = c.league ? rng.int(2, 4) : rng.int(0, 2);
    const level = strForRep(c.rep);
    for (let i = 0; i < n; i++) {
      const ageY = rng.int(16, 18);
      const p: Player = generatePlayer(state, rng, {
        pos: rng.pick(['GOL', 'ZAG', 'ZAG', 'LAT', 'VOL', 'MEI', 'MEI', 'ATA', 'ATA'] as const),
        str: level - 16 + rng.normal(0, 5) + c.tc.level,
        nat: c.country,
        ageY: ageY - 1,
        clubId: c.id,
        clubRep: c.rep,
      });
      p.pot = Math.min(97, Math.round(p.str + rng.range(8, 26) + c.tc.level * 1.5));
      p.contractEnd = nextSeason + 2;
      p.wage = roundMoney(Math.max(3_000, expectedWage(p, nextSeason, c.rep) * 0.6));
      state.players[p.id] = p;
      if (c.managerId && p.pot >= 78) addNews(state, 'info', `Revelação da base: ${p.name} (${p.pos}) sobe ao profissional.`, [c.id], c.managerId);
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
    const min = c.league ? 22 : 20;
    if (squad.length < min) {
      for (const p of free) {
        if (squad.length >= min) break;
        if (p.clubId != null) continue;
        if (p.str > c.power + 6) continue;
        p.clubId = c.id;
        p.wage = expectedWage(p, state.meta.season + 1, c.rep);
        p.contractEnd = state.meta.season + 1 + rng.int(0, 2);
        p.idle = 0;
        squad.push(p);
      }
      if (squad.length < min) fillSquad(state, rng, c.id, squad, strForRep(c.rep) - 2, foreignShareFor(c), min);
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
