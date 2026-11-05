import { squadStrength } from './ai/lineup';
import { assignNumbers, SQUAD_SHAPE } from './generator';
import type { Rng } from './rng';
import type { Bid, Club, GameState, Player, Pos } from './types';
import { addNews, age, expectedWage, playerValue, roundMoney, squadIndex, squadOf } from './util';

export function windowOpen(state: GameState): boolean {
  if (!state.meta.settings.windows) return true;
  return state.calendar[state.meta.date]?.window ?? false;
}

/** Move a player between clubs (fee may be 0). */
export function executeTransfer(state: GameState, p: Player, to: Club, fee: number, wage: number, years: number, loan = false) {
  const fromId = p.clubId;
  const from = fromId != null ? state.clubs[fromId] : null;
  if (from) {
    from.balance += fee;
    from.ledger.sales += fee;
    if (from.lineup.xi.includes(p.id)) from.lineup.xi = from.lineup.xi.map((x) => (x === p.id ? null : x));
    from.lineup.bench = from.lineup.bench.filter((x) => x !== p.id);
  }
  to.balance -= fee;
  to.ledger.purchases += fee;
  p.clubId = to.id;
  p.wage = wage;
  p.listed = false;
  p.num = 0;
  if (loan && from) {
    p.loan = { from: from.id, until: state.meta.season };
  } else {
    p.loan = null;
    p.contractEnd = state.meta.season + Math.max(0, years - 1);
  }
  p.morale = Math.min(100, p.morale + 10);
  assignNumbers(squadOf(state, to.id));
  const verb = loan ? 'é emprestado ao' : 'é contratado pelo';
  const feeTxt = fee > 0 ? ` por ${moneyShort(fee)}` : '';
  addNews(state, 'transfer', `${p.name} ${verb} ${to.name}${from ? ` (vindo do ${from.name})` : ''}${feeTxt}.`, [to.id, ...(from ? [from.id] : [])]);
  to.power = squadStrength(squadOf(state, to.id));
  if (from) from.power = squadStrength(squadOf(state, from.id));
}

function moneyShort(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  return `R$ ${Math.round(v / 1000)} mil`;
}

/** How much an AI club wants for a player. */
export function askingPrice(state: GameState, p: Player): number {
  const v = playerValue(p, state.meta.season);
  if (p.clubId == null) return 0;
  if (p.listed) return roundMoney(v * 0.85);
  const squad = squadOf(state, p.clubId).sort((a, b) => b.str - a.str);
  const rank = squad.findIndex((x) => x.id === p.id);
  const factor = rank < 11 ? 1.6 : rank < 16 ? 1.2 : 1.0;
  return roundMoney(v * factor);
}

/** Wage the player demands to move to `club`. */
export function wageDemand(state: GameState, p: Player, club: Club): number {
  let w = expectedWage(p, state.meta.season, club.rep);
  const cur = p.clubId != null ? state.clubs[p.clubId] : null;
  if (cur && club.rep < cur.rep - 8) w *= 1 + (cur.rep - club.rep) / 60;
  return roundMoney(Math.max(w, p.wage * 1.05));
}

export type BidOutcome =
  | { ok: true; text: string }
  | { ok: false; text: string; counter?: number; pending?: boolean };

/** Evaluate a bid against an AI club (or a free agent) immediately. */
export function resolveAiBid(state: GameState, rng: Rng, bid: Bid): BidOutcome {
  const p = state.players[bid.player];
  const buyer = state.clubs[bid.buyer];
  if (p.clubId != null) {
    if (bid.kind === 'emprestimo') {
      const squad = squadOf(state, p.clubId).sort((a, b) => b.str - a.str);
      const rank = squad.findIndex((x) => x.id === p.id);
      if (rank < 14 || age(p, state.meta.season) > 26) return { ok: false, text: 'O clube não libera esse jogador por empréstimo.' };
    } else {
      const ask = askingPrice(state, p);
      if (bid.fee < ask * 0.8) return { ok: false, text: `Proposta recusada. O clube quer pelo menos ${moneyShort(ask)}.`, counter: ask };
      if (bid.fee < ask) {
        if (rng.chance(0.35)) {
          // accepts a bit below asking price
        } else return { ok: false, text: `Contraproposta: ${moneyShort(ask)}.`, counter: ask };
      }
    }
  }
  const demand = wageDemand(state, p, buyer);
  if (bid.wage < demand * rng.range(0.88, 1.0)) {
    return { ok: false, text: `${p.name} recusou o salário. Pede ${moneyShort(demand)}/mês.` };
  }
  if (buyer.balance < bid.fee) return { ok: false, text: 'Saldo insuficiente.' };
  return { ok: true, text: 'Negócio fechado!' };
}

const posNeeds = (squad: Player[]): Pos[] => {
  const counts: Record<Pos, number> = { GOL: 0, ZAG: 0, LAT: 0, VOL: 0, MEI: 0, ATA: 0 };
  for (const p of squad) counts[p.pos]++;
  return (Object.keys(SQUAD_SHAPE) as Pos[]).filter((pos) => counts[pos] < SQUAD_SHAPE[pos] - (pos === 'GOL' ? 1 : 1));
};

/** AI market activity for one date (only while the window is open). */
export function aiTransfers(state: GameState, rng: Rng) {
  if (!windowOpen(state)) return;
  const idx = squadIndex(state);
  const aiClubs = Object.values(state.clubs).filter((c) => !c.managerId && (c.league || c.contOnly));
  const freeAgents = Object.values(state.players).filter((p) => p.clubId == null);
  let moves = 0;
  for (let i = 0; i < 14 && moves < 10; i++) {
    const club = rng.pick(aiClubs);
    const squad = idx.get(club.id) ?? [];
    const needs = posNeeds(squad);
    const wantsUpgrade = squad.length < 30 && rng.chance(0.35);
    if (!needs.length && !wantsUpgrade) continue;
    const pos = needs.length ? rng.pick(needs) : rng.pick(Object.keys(SQUAD_SHAPE) as Pos[]);
    const atPos = squad.filter((p) => p.pos === pos).sort((a, b) => a.str - b.str);
    const floor = atPos.length ? atPos[Math.floor(atPos.length / 2)].str : club.power - 6;
    // free agents first
    const fa = freeAgents
      .filter((p) => p.clubId == null && p.pos === pos && p.str >= floor - 2 && age(p, state.meta.season) <= 33)
      .sort((a, b) => b.str - a.str)[0];
    if (fa) {
      const wage = wageDemand(state, fa, club);
      executeTransfer(state, fa, club, 0, wage, rng.int(1, 3));
      squad.push(fa);
      moves++;
      continue;
    }
    if (!wantsUpgrade && !needs.length) continue;
    // buy from a smaller club
    const budget = Math.max(0, club.balance * 0.35);
    const cands: Player[] = [];
    for (const [cid, sq] of idx) {
      const c = state.clubs[cid];
      if (c.id === club.id || c.managerId || c.rep > club.rep + 3) continue;
      for (const p of sq) {
        if (p.pos === pos && p.str > floor + 1 && !p.loan) cands.push(p);
      }
      if (cands.length > 60) break;
    }
    const pick = cands
      .filter((p) => askingPrice(state, p) <= budget)
      .sort((a, b) => b.str - a.str)[rng.int(0, 2)];
    if (!pick) continue;
    const fee = askingPrice(state, pick);
    const from = idx.get(pick.clubId!) ?? [];
    if (from.length <= 18) continue;
    executeTransfer(state, pick, club, fee, wageDemand(state, pick, club), rng.int(2, 4));
    idx.set(pick.clubId!, from.filter((x) => x.id !== pick.id));
    squad.push(pick);
    moves++;
  }
  aiBidsForHumans(state, rng, idx);
}

/** AI clubs occasionally bid for players at human-managed clubs. */
function aiBidsForHumans(state: GameState, rng: Rng, idx: Map<number, Player[]>) {
  const humanClubs = Object.values(state.clubs).filter((c) => c.managerId);
  for (const hc of humanClubs) {
    if (!rng.chance(0.18)) continue;
    const squad = (idx.get(hc.id) ?? []).filter((p) => !p.loan);
    if (squad.length < 16) continue;
    const target = rng.weighted(squad, (p) => Math.pow(p.str / 60, 4) * (p.listed ? 3 : 1));
    const buyers = Object.values(state.clubs).filter(
      (c) => !c.managerId && c.id !== hc.id && (c.league || c.contOnly) && c.power >= target.str - 6 && c.balance > playerValue(target, state.meta.season),
    );
    if (!buyers.length) continue;
    const buyer = rng.pick(buyers);
    const fee = roundMoney(playerValue(target, state.meta.season) * rng.range(0.95, 1.45));
    const id = state.meta.next.bid++;
    state.bids[id] = {
      id,
      player: target.id,
      buyer: buyer.id,
      seller: hc.id,
      kind: 'compra',
      fee,
      wage: wageDemand(state, target, buyer),
      years: rng.int(2, 4),
      status: 'pendente',
      counter: null,
      date: state.meta.date,
      season: state.meta.season,
      msg: '',
    };
    addNews(state, 'bid', `O ${buyer.name} fez uma proposta de ${moneyShort(fee)} por ${target.name}.`, [hc.id, buyer.id], hc.managerId);
  }
}

/** Expire old pending bids. */
export function expireBids(state: GameState) {
  for (const b of Object.values(state.bids)) {
    if ((b.status === 'pendente' || b.status === 'contraproposta') && (b.season < state.meta.season || state.meta.date - b.date > 4)) {
      b.status = 'expirada';
    }
  }
  // keep the bid list small
  const all = Object.values(state.bids).sort((a, b) => b.id - a.id);
  for (const b of all.slice(300)) delete state.bids[b.id];
}
