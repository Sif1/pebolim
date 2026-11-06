import { squadStrength } from './ai/lineup';
import { DATES_PER_SEASON, homeGameCounts, wageBudget } from './economy';
import { assignNumbers, SQUAD_SHAPE } from './generator';
import type { Rng } from './rng';
import type { Bid, Club, GameState, Player, Pos } from './types';
import { absDate, addNews, age, clamp, expectedWage, playerValue, roundMoney, squadIndex, squadOf } from './util';

export function windowOpen(state: GameState): boolean {
  return windowOpenAt(state, state.meta.date);
}

/** Is the window open on a given date of this season? */
export function windowOpenAt(state: GameState, date: number): boolean {
  if (!state.meta.settings.windows) return true;
  return state.calendar[date]?.window ?? false;
}

/** Can an auction started now still close (it closes at the start of the next date)? */
export const auctionCanClose = (state: GameState) => windowOpenAt(state, state.meta.date + 1);

/** Absolute date (season*100+date) `months` from now. */
export function datePlusMonths(state: GameState, months: number): number {
  const total = state.meta.date + Math.round((months / 12) * DATES_PER_SEASON);
  return absDate(state.meta.season + Math.floor(total / DATES_PER_SEASON), total % DATES_PER_SEASON);
}

/** Take a player off every market list. */
export function unlist(state: GameState, p: Player) {
  p.salePrice = null;
  p.loanListed = null;
  p.auction = null;
  delete state.auctionBids[p.id];
}

/** Move a player between clubs (fee may be 0). Loans last `months` and the borrower pays the wages. */
export function executeTransfer(state: GameState, p: Player, to: Club, fee: number, wage: number, years: number, loan = false, months: 6 | 12 = 12) {
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
  unlist(state, p);
  p.num = 0;
  if (loan && from) {
    p.loan = { from: from.id, until: datePlusMonths(state, months) };
  } else {
    p.loan = null;
    p.contractEnd = state.meta.season + Math.max(0, years - 1);
  }
  p.morale = Math.min(100, p.morale + 10);
  assignNumbers(squadOf(state, to.id));
  const verb = loan ? `é emprestado por ${months} meses ao` : 'é contratado pelo';
  const feeTxt = fee > 0 ? ` por ${moneyShort(fee)}` : '';
  addNews(state, 'transfer', `${p.name} ${verb} ${to.name}${from ? ` (vindo do ${from.name})` : ''}${feeTxt}.`, [to.id, ...(from ? [from.id] : [])]);
  to.power = squadStrength(squadOf(state, to.id));
  if (from) from.power = squadStrength(squadOf(state, from.id));
}

/** Players whose loan has ended go back to their club (checked every date). */
export function returnLoans(state: GameState) {
  const now = absDate(state.meta.season, state.meta.date);
  for (const p of Object.values(state.players)) {
    if (!p.loan || p.loan.until > now) continue;
    const back = state.clubs[p.loan.from];
    const was = p.clubId != null ? state.clubs[p.clubId] : null;
    if (was) {
      was.lineup.xi = was.lineup.xi.map((x) => (x === p.id ? null : x));
      was.lineup.bench = was.lineup.bench.filter((x) => x !== p.id);
    }
    p.loan = null;
    p.clubId = back ? back.id : null;
    p.num = 0;
    unlist(state, p);
    if (back) {
      assignNumbers(squadOf(state, back.id));
      if (back.managerId) addNews(state, 'transfer', `${p.name} volta de empréstimo${was ? ` do ${was.name}` : ''}.`, [back.id], back.managerId);
    }
  }
}

export function moneyShort(v: number) {
  if (v >= 1_000_000) return `US$ ${(v / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  return `US$ ${Math.round(v / 1000)} mil`;
}

/** How much a club wants for a player: the listed price, else value scaled by how important he is. */
export function askingPrice(state: GameState, p: Player): number {
  if (p.clubId == null) return 0;
  if (p.salePrice != null) return p.salePrice;
  const v = playerValue(p, state.meta.season);
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
      if (!p.loanListed) {
        const squad = squadOf(state, p.clubId).sort((a, b) => b.str - a.str);
        const rank = squad.findIndex((x) => x.id === p.id);
        if (rank < 14 || age(p, state.meta.season) > 26) return { ok: false, text: 'O clube não libera esse jogador por empréstimo.' };
      }
      // on loan the player keeps his wage, paid by the borrower
      return { ok: true, text: 'Empréstimo acertado!' };
    }
    const ask = askingPrice(state, p);
    if (p.salePrice != null) {
      // listed at a price: that is the price
      if (bid.fee < ask) return { ok: false, text: `O clube pede ${moneyShort(ask)}.`, counter: ask };
    } else {
      if (bid.fee < ask * 0.8) return { ok: false, text: `Proposta recusada. O clube quer pelo menos ${moneyShort(ask)}.`, counter: ask };
      if (bid.fee < ask && !rng.chance(0.35)) return { ok: false, text: `Contraproposta: ${moneyShort(ask)}.`, counter: ask };
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
  return (Object.keys(SQUAD_SHAPE) as Pos[]).filter((pos) => counts[pos] < SQUAD_SHAPE[pos] - 1);
};

/** Median força at a position in a squad (what a signing must beat to be worth it). */
function medianAt(squad: Player[], pos: Pos, fallback: number): number {
  const at = squad.filter((p) => p.pos === pos).sort((a, b) => a.str - b.str);
  return at.length ? at[Math.floor(at.length / 2)].str : fallback;
}

/** Most an AI club pays for a player: his value, a bit more when it really needs him, never silly prices. */
function aiMaxPrice(state: GameState, p: Player, need: boolean): number {
  return playerValue(p, state.meta.season) * (need ? 1.15 : 1.0);
}

/** Squads by club plus cached per-position medians and wage budgets, updated as players move during one date. */
class MarketView {
  private med = new Map<string, number>();
  private budgets = new Map<number, number>();
  private homes: Map<string, number> | null = null;
  constructor(
    readonly state: GameState,
    readonly idx: Map<number, Player[]>,
    readonly aiClubs: Club[],
  ) {}
  /** Yearly wage budget of a club (see wageBudget). */
  budget(club: Club): number {
    let b = this.budgets.get(club.id);
    if (b == null) {
      this.homes ??= homeGameCounts(this.state);
      b = wageBudget(this.state, club, this.homes);
      this.budgets.set(club.id, b);
    }
    return b;
  }
  /** Yearly wages still unspent in the budget (negative when over it). */
  room(club: Club): number {
    return this.budget(club) - this.squad(club.id).reduce((a, p) => a + p.wage, 0) * 12;
  }
  /** Can the club take on this monthly wage? Filling a real gap is allowed a little over budget. */
  affords(club: Club, wage: number, need: boolean): boolean {
    const room = this.room(club);
    return wage * 12 <= room || (need && wage * 12 <= room + this.budget(club) * 0.04);
  }
  squad(clubId: number): Player[] {
    return this.idx.get(clubId) ?? [];
  }
  median(club: Club, pos: Pos): number {
    const k = `${club.id}:${pos}`;
    let m = this.med.get(k);
    if (m == null) {
      m = medianAt(this.squad(club.id), pos, club.power - 6);
      this.med.set(k, m);
    }
    return m;
  }
  needs(club: Club, pos: Pos): boolean {
    return this.squad(club.id).filter((p) => p.pos === pos).length < SQUAD_SHAPE[pos] - 1;
  }
  move(p: Player, from: number | null, to: number) {
    if (from != null) this.idx.set(from, this.squad(from).filter((x) => x.id !== p.id));
    this.idx.set(to, [...this.squad(to).filter((x) => x.id !== p.id), p]);
    for (const c of [from, to]) {
      if (c == null) continue;
      this.budgets.delete(c);
      for (const pos of Object.keys(SQUAD_SHAPE)) this.med.delete(`${c}:${pos}`);
    }
  }
}

/**
 * Listed players look for a club: each date some of them are noticed, and an AI club that would play him
 * (better than its median at the position, or short there), can afford him and finds the price fair signs him.
 * Overpriced players stay listed; loans go to clubs of similar or smaller size.
 */
function buyListed(state: GameState, rng: Rng, view: MarketView) {
  const season = state.meta.season;
  const listed = rng.shuffle(Object.values(state.players).filter((p) => p.clubId != null && (p.salePrice != null || p.loanListed) && !p.auction && !p.loan));
  let deals = 0;
  for (const p of listed) {
    if (deals >= 12) return;
    if (!rng.chance(0.3)) continue;
    const seller = state.clubs[p.clubId!];
    if (view.squad(seller.id).length <= 17) continue;
    const loan = p.salePrice == null;
    const a = age(p, season);
    if (a > (loan ? 30 : 33)) continue;
    const value = playerValue(p, season);
    const buyers = view.aiClubs.filter((c) => {
      if (c.id === seller.id || view.squad(c.id).length >= 30) return false;
      if (p.str > c.power + 8) return false;
      const need = view.needs(c, p.pos);
      if (!need && p.str <= view.median(c, p.pos) + 1) return false;
      if (loan) return c.rep <= seller.rep + 5 && view.affords(c, p.wage, need);
      return p.salePrice! <= value * (need ? 1.15 : 1.02) && p.salePrice! <= c.balance * 0.35 && view.affords(c, wageDemand(state, p, c), need);
    });
    if (!buyers.length) continue;
    const club = rng.pick(buyers);
    const fee = loan ? 0 : p.salePrice!;
    const months = p.loanListed ?? 12;
    executeTransfer(state, p, club, fee, loan ? p.wage : wageDemand(state, p, club), rng.int(2, 4), loan, months);
    if (seller.managerId) {
      addNews(state, 'transfer', loan ? `${p.name} foi emprestado ao ${club.name} por ${months} meses.` : `${p.name} foi vendido ao ${club.name} por ${moneyShort(fee)}.`, [seller.id], seller.managerId);
    }
    view.move(p, seller.id, club.id);
    deals++;
  }
}

/** AI market activity for one date (only while the window is open). */
export function aiTransfers(state: GameState, rng: Rng) {
  if (!windowOpen(state)) return;
  const idx = squadIndex(state);
  const aiClubs = Object.values(state.clubs).filter((c) => !c.managerId && (c.league || c.contOnly));
  const freeAgents = Object.values(state.players).filter((p) => p.clubId == null);
  const view = new MarketView(state, idx, aiClubs);
  buyListed(state, rng, view);
  let moves = 0;
  for (let i = 0; i < 16 && moves < 10; i++) {
    // clubs with money to spend are more active
    const club = rng.weighted(aiClubs, (c) => 1 + clamp(c.balance / Math.max(1, c.baseIncome), 0, 3));
    const squad = idx.get(club.id) ?? [];
    const needs = posNeeds(squad);
    const wantsUpgrade = squad.length < 30 && rng.chance(view.room(club) > 0.15 * view.budget(club) ? 0.7 : 0.35);
    if (!needs.length && !wantsUpgrade) continue;
    const pos = needs.length ? rng.pick(needs) : rng.pick(Object.keys(SQUAD_SHAPE) as Pos[]);
    const need = needs.includes(pos);
    const floor = medianAt(squad, pos, club.power - 6);
    const budget = Math.max(0, club.balance * 0.35);
    // 1) free agents
    const fa = freeAgents
      .filter((p) => p.clubId == null && p.pos === pos && p.str >= floor - 2 && age(p, state.meta.season) <= 33)
      .sort((a, b) => b.str - a.str)[0];
    if (fa && view.affords(club, wageDemand(state, fa, club), need)) {
      executeTransfer(state, fa, club, 0, wageDemand(state, fa, club), rng.int(1, 3));
      view.move(fa, null, club.id);
      moves++;
      continue;
    }
    // over the wage budget: no purchases
    if (view.room(club) <= 0) continue;
    // 2) buy from a smaller AI club (listed players found their buyers above)
    const cands: Player[] = [];
    for (const [cid, sq] of idx) {
      const c = state.clubs[cid];
      if (c.id === club.id || c.managerId || c.rep > club.rep + 3) continue;
      for (const p of sq) if (p.pos === pos && p.str > floor + 1 && !p.loan && !p.auction) cands.push(p);
      if (cands.length > 60) break;
    }
    // never more than ~1.6x value for a starter (1.85x when the position is short)
    const pick = cands
      .filter((p) => askingPrice(state, p) <= Math.min(budget, aiMaxPrice(state, p, need) * 1.6) && view.affords(club, wageDemand(state, p, club), need))
      .sort((a, b) => b.str - a.str)[rng.int(0, 2)];
    if (!pick) continue;
    const fromId = pick.clubId!;
    if (view.squad(fromId).length <= 18) continue;
    executeTransfer(state, pick, club, askingPrice(state, pick), wageDemand(state, pick, club), rng.int(2, 4));
    view.move(pick, fromId, club.id);
    moves++;
  }
  aiListings(state, rng, view);
  aiBidsForHumans(state, rng, idx);
}

/** At most this many AI players listed (for sale or loan) at once, and open auctions. */
export const AI_LISTED_MAX = 320;
export const AUCTIONS_MAX = 10;

/**
 * AI clubs put surplus players on the market: the weakest at a position they have plenty of. Promising
 * youngsters go out on loan, a few go to auction (only if it can close before the window shuts), the rest
 * are listed at about their value.
 */
function aiListings(state: GameState, rng: Rng, view: MarketView) {
  const season = state.meta.season;
  const all = Object.values(state.players);
  let auctions = all.filter((p) => p.auction).length;
  let listed = all.filter((p) => p.clubId != null && (p.salePrice != null || p.loanListed) && !state.clubs[p.clubId].managerId).length;
  const canAuction = auctionCanClose(state);
  // clubs in the red or over their wage budget sell a well-paid player who is not a regular starter
  for (const club of view.aiClubs) {
    if (!rng.chance(0.25)) continue;
    if (club.balance >= 0 && view.room(club) >= -0.05 * view.budget(club)) continue;
    const squad = view.squad(club.id).filter((p) => !p.loan);
    if (squad.length <= 20 || squad.some((p) => p.salePrice != null && p.wage > 0)) continue;
    const starters = new Set([...squad].sort((a, b) => b.str - a.str).slice(0, 11).map((p) => p.id));
    const p = squad.filter((x) => !starters.has(x.id) && !x.auction && !x.loanListed).sort((a, b) => b.wage - a.wage)[0];
    if (!p) continue;
    p.salePrice = roundMoney(playerValue(p, season) * rng.range(0.75, 0.9));
    listed++;
  }
  for (let i = 0; i < 24 && listed < AI_LISTED_MAX; i++) {
    const club = rng.pick(view.aiClubs);
    const squad = view.squad(club.id).filter((p) => !p.loan);
    if (squad.length < 23) continue;
    // usually one player on the market at a time
    if (squad.some((p) => p.salePrice != null || p.loanListed || p.auction) && !rng.chance(0.25)) continue;
    const count = (pos: Pos) => squad.filter((p) => p.pos === pos).length;
    const surplus = squad
      .filter((p) => p.salePrice == null && !p.loanListed && !p.auction && count(p.pos) >= SQUAD_SHAPE[p.pos])
      .sort((a, b) => a.str - view.median(club, a.pos) - (b.str - view.median(club, b.pos)));
    const p = surplus[rng.int(0, Math.min(2, surplus.length - 1))];
    if (!p) continue;
    const v = playerValue(p, season);
    const a = age(p, season);
    if (a <= 22 && p.stars >= 2 && rng.chance(0.55)) p.loanListed = rng.chance(0.5) ? 6 : 12;
    else if (canAuction && auctions < AUCTIONS_MAX && rng.chance(0.16)) {
      p.auction = { min: roundMoney(v * rng.range(0.45, 0.7)), season, date: state.meta.date };
      addNews(state, 'transfer', `Leilão: ${club.name} oferece ${p.name} (${p.pos}, força ${Math.round(p.str)}), lance mínimo ${moneyShort(p.auction.min)}.`, [club.id]);
      auctions++;
      continue;
    } else p.salePrice = roundMoney(v * rng.range(0.85, 1.1));
    listed++;
  }
}

/** AI clubs occasionally bid for players at human-managed clubs (more often for listed ones). */
function aiBidsForHumans(state: GameState, rng: Rng, idx: Map<number, Player[]>) {
  const humanClubs = Object.values(state.clubs).filter((c) => c.managerId);
  for (const hc of humanClubs) {
    if (!rng.chance(0.18)) continue;
    const squad = (idx.get(hc.id) ?? []).filter((p) => !p.loan && !p.auction);
    if (squad.length < 16) continue;
    const target = rng.weighted(squad, (p) => Math.pow(p.str / 60, 4) * (p.salePrice != null ? 3 : 1));
    const buyers = Object.values(state.clubs).filter(
      (c) => !c.managerId && c.id !== hc.id && (c.league || c.contOnly) && c.power >= target.str - 6 && c.balance > playerValue(target, state.meta.season),
    );
    if (!buyers.length) continue;
    const buyer = rng.pick(buyers);
    const value = playerValue(target, state.meta.season);
    // listed players get offers near the asking price when it is fair, unlisted ones a premium to tempt the manager
    const fee =
      target.salePrice != null ? roundMoney(Math.min(target.salePrice, value * 1.15) * rng.range(0.85, 1)) : roundMoney(value * rng.range(0.95, 1.45));
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

/**
 * Auctions (leilão): a player put up for auction collects sealed bids from managers until the next match day,
 * then AI clubs bid and the highest bid at or above the minimum wins. Runs at the start of every match day.
 */
export function resolveAuctions(state: GameState, rng: Rng) {
  const now = absDate(state.meta.season, state.meta.date);
  const idx = squadIndex(state);
  for (const p of Object.values(state.players)) {
    const a = p.auction;
    if (!a || absDate(a.season, a.date) >= now || p.clubId == null) continue;
    const owner = state.clubs[p.clubId];
    if (!windowOpen(state)) {
      unlist(state, p);
      if (owner.managerId) addNews(state, 'transfer', `O leilão de ${p.name} foi cancelado: a janela de transferências fechou.`, [owner.id], owner.managerId);
      continue;
    }
    const bids: { club: Club; amount: number }[] = [];
    for (const [cid, amount] of Object.entries(state.auctionBids[p.id] ?? {})) {
      const c = state.clubs[Number(cid)];
      if (c && c.id !== owner.id && c.balance >= amount && amount >= a.min) bids.push({ club: c, amount });
    }
    // AI clubs that need the position and can afford it
    const value = playerValue(p, state.meta.season);
    const ai = Object.values(state.clubs).filter((c) => {
      if (c.managerId || c.id === owner.id || !(c.league || c.contOnly)) return false;
      const sq = idx.get(c.id) ?? [];
      return sq.length < 30 && p.str >= medianAt(sq, p.pos, c.power - 6) - 1 && p.str <= c.power + 8 && c.balance * 0.4 >= a.min;
    });
    for (const c of rng.shuffle(ai).slice(0, 3)) {
      const amount = roundMoney(value * rng.range(0.55, 1.05));
      if (amount >= a.min && c.balance * 0.4 >= amount) bids.push({ club: c, amount });
    }
    bids.sort((x, y) => y.amount - x.amount);
    const win = bids[0];
    if (!win) {
      unlist(state, p);
      addNews(state, 'transfer', `Leilão: ninguém deu o lance mínimo por ${p.name} (${owner.name}).`, [owner.id], owner.managerId);
      continue;
    }
    const others = bids.length - 1;
    executeTransfer(state, p, win.club, win.amount, wageDemand(state, p, win.club), rng.int(2, 4));
    addNews(
      state,
      'transfer',
      `Leilão: ${p.name} é arrematado pelo ${win.club.name} por ${moneyShort(win.amount)}${others ? ` (${others} outro${others > 1 ? 's' : ''} lance${others > 1 ? 's' : ''})` : ''}.`,
      [win.club.id, owner.id],
    );
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
