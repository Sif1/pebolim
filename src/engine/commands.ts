import { squadStrength } from './ai/lineup';
import { takeJob } from './board';
import { calibrateIncome, clubComps, roughIncome, seatCost, sectorBounds, sectorRefs, stadiumBuildDates, TC_BUILD, tcBoardShare, tcClubCost, tcUpgradeCost } from './economy';
import { assignNumbers, fillerLevel, fillSquad } from './generator';
import { ensureYouthTeam, promote as promoteJunior, release as releaseJunior } from './youth';
import { FORMATIONS, slotsFor, validShape } from './match/formations';
import { Rng } from './rng';
import { auctionCanClose, executeTransfer, refusesClub, resolveAiBid, unlist, wageDemand, windowOpen } from './transfers';
import type { Bid, GameState, Lineup, Manager, PitchCare, Player, SectorPrices, Tactics, TrainingFocus, TravelMode } from './types';
import { absDate, addNews, age, clamp, emptyLedger, expectedWage, formatMoney, playerValue, roundMoney, squadOf } from './util';

export type Command =
  | { c: 'setTactics'; tactics: Tactics }
  | { c: 'setLineup'; lineup: Lineup; auto: boolean }
  /** comp null = default prices; prices null = drop the competition's own prices */
  | { c: 'setTickets'; comp: string | null; prices: SectorPrices | null }
  | { c: 'setFocus'; focus: TrainingFocus }
  | { c: 'setTravel'; mode: TravelMode | 'auto' }
  | { c: 'setPitchCare'; care: PitchCare }
  | { c: 'upgradeTC' }
  | { c: 'expandStadium'; seats: number }
  /** price null = take him off the sale list */
  | { c: 'setSale'; pid: number; price: number | null }
  /** months null = not available on loan */
  | { c: 'setLoanList'; pid: number; months: 6 | 12 | null }
  | { c: 'startAuction'; pid: number; min: number }
  /** sealed bid on someone else's auction (amount null = withdraw) */
  | { c: 'auctionBid'; pid: number; amount: number | null }
  | { c: 'bid'; pid: number; kind: 'compra' | 'emprestimo'; fee: number; wage: number; years: number; months?: 6 | 12 }
  | { c: 'respondBid'; bid: number; action: 'aceitar' | 'recusar' | 'contraproposta'; fee?: number }
  | { c: 'acceptCounter'; bid: number }
  | { c: 'cancelBid'; bid: number }
  | { c: 'renew'; pid: number; wage: number; years: number }
  | { c: 'setAutoRenew'; pids: number[]; on: boolean }
  | { c: 'setAutoRenewAll'; on: boolean }
  | { c: 'preContract'; pid: number; wage: number; years: number }
  | { c: 'promoteYouth'; pid: number }
  | { c: 'releaseYouth'; pid: number }
  | { c: 'renameYouth'; pid: number; name: string }
  | { c: 'release'; pid: number }
  | { c: 'acceptJob'; clubId: number }
  | { c: 'declineJob'; clubId: number }
  | { c: 'resign' };

export interface CmdResult {
  ok: boolean;
  msg: string;
}

const ok = (msg = 'Feito.'): CmdResult => ({ ok: true, msg });
const fail = (msg: string): CmdResult => ({ ok: false, msg });

/** Apply a manager's command to the (draft) state. Runs on the host only. */
export function runCommand(state: GameState, managerId: string, cmd: Command): CmdResult {
  const m = state.managers[managerId];
  if (!m) return fail('Treinador desconhecido.');
  const rng = new Rng(state.meta.rng);
  try {
    return dispatch(state, m, cmd, rng);
  } finally {
    state.meta.rng = rng.state();
  }
}

function myClub(state: GameState, m: Manager) {
  return m.clubId != null ? state.clubs[m.clubId] : null;
}

function dispatch(state: GameState, m: Manager, cmd: Command, rng: Rng): CmdResult {
  // job commands work while unemployed
  if (cmd.c === 'acceptJob') {
    const offer = m.offers.find((o) => o.clubId === cmd.clubId);
    const club = state.clubs[cmd.clubId];
    if (!offer || !club) return fail('Proposta não encontrada.');
    if (club.managerId) return fail('O cargo já foi ocupado.');
    takeJob(state, m, club.id);
    ensureYouthTeam(state, rng, club);
    return ok(`Você é o novo treinador do ${club.name}!`);
  }
  if (cmd.c === 'declineJob') {
    m.offers = m.offers.filter((o) => o.clubId !== cmd.clubId);
    return ok('Proposta recusada.');
  }
  const club = myClub(state, m);
  if (!club) return fail('Você não está treinando nenhum clube.');

  switch (cmd.c) {
    case 'resign': {
      m.history.push({ season: state.meta.season, clubId: club.id, note: 'Pediu demissão' });
      club.managerId = null;
      club.upForSelection = true;
      club.autoLineup = true;
      m.clubId = null;
      m.rep = clamp(m.rep - 3, 5, 100);
      addNews(state, 'fired', `${m.name} pede demissão do ${club.name}.`, [club.id]);
      return ok('Você deixou o clube.');
    }
    case 'setTactics': {
      const t = cmd.tactics;
      if (!FORMATIONS[t.formation]) return fail('Formação inválida.');
      if (t.shape != null && !validShape(t.shape)) return fail('Posições inválidas.');
      // a different preset formation clears the lineup; moving positions keeps everyone in his slot
      if (t.formation !== club.tactics.formation && !t.shape) club.lineup = { xi: slotsFor(t).map(() => null), bench: club.lineup.bench };
      club.tactics = { ...t, shape: t.shape ? [...t.shape] : null };
      return ok('Tática salva.');
    }
    case 'setLineup': {
      const squadIds = new Set(squadOf(state, club.id).map((p) => p.id));
      const ids = [...cmd.lineup.xi.filter((x): x is number => x != null), ...cmd.lineup.bench];
      if (ids.some((id) => !squadIds.has(id))) return fail('Jogador fora do elenco.');
      if (new Set(ids).size !== ids.length) return fail('Jogador repetido na escalação.');
      club.lineup = { xi: cmd.lineup.xi.slice(0, 11), bench: cmd.lineup.bench.slice(0, 12) };
      club.autoLineup = cmd.auto;
      return ok('Escalação salva.');
    }
    case 'setTickets': {
      if (cmd.comp != null && !clubComps(state, club.id).some((c) => c.id === cmd.comp)) return fail('Seu clube não disputa essa competição.');
      if (cmd.prices == null) {
        if (cmd.comp == null) return fail('Preços inválidos.');
        delete club.tickets.comps[cmd.comp];
        return ok('Essa competição volta a usar os preços padrão.');
      }
      const prices = cmd.prices.map((v, i) => {
        const [lo, hi] = sectorBounds(club, i);
        return Math.round(clamp(v, lo, hi));
      }) as SectorPrices;
      if (cmd.comp == null) club.tickets.base = prices;
      else club.tickets.comps[cmd.comp] = prices;
      return ok(cmd.comp == null ? 'Preços padrão salvos.' : `Preços salvos para ${state.comps[cmd.comp].cfg.name}.`);
    }
    case 'setFocus':
      club.focus = cmd.focus;
      return ok('Foco de treino atualizado.');
    case 'setTravel':
      club.travel = cmd.mode;
      return ok('Logística atualizada.');
    case 'setPitchCare':
      club.pitchCare = cmd.care;
      return ok('Cuidado com o gramado atualizado.');
    case 'upgradeTC': {
      if (club.tc.building > 0) return fail('Já existe uma obra em andamento no CT.');
      if (club.tc.level >= 5) return fail('O CT já está no nível máximo.');
      // the board pays part of the works when it trusts the manager
      const cost = tcClubCost(club);
      const share = tcBoardShare(club);
      if (club.balance < cost) return fail(`Saldo insuficiente (custa ${formatMoney(cost)}).`);
      club.balance -= cost;
      club.ledger.works += cost;
      club.tc.building = TC_BUILD[club.tc.level + 1];
      club.tc.total = club.tc.building;
      return ok(
        `Obra iniciada: CT nível ${club.tc.level + 1} em ${club.tc.building} rodadas.${share > 0 ? ` A diretoria pagou ${Math.round(share * 100)}% (${formatMoney(tcUpgradeCost(club) - cost)}).` : ''}`,
      );
    }
    case 'expandStadium': {
      if (club.stadiumWork) return fail('O estádio já está em obras.');
      const seats = Math.round(clamp(cmd.seats, 1000, 30000) / 1000) * 1000;
      const cost = seats * seatCost(club);
      if (club.balance < cost) return fail(`Saldo insuficiente (custa ${formatMoney(cost)}).`);
      club.balance -= cost;
      club.ledger.works += cost;
      const dates = stadiumBuildDates(seats);
      club.stadiumWork = { seats, left: dates, total: dates };
      return ok(`Ampliação de ${seats.toLocaleString('pt-BR')} lugares iniciada: ${dates} rodadas, com 10% do estádio fechado durante as obras.`);
    }
    case 'setSale': {
      const p = state.players[cmd.pid];
      if (!p || p.clubId !== club.id || p.loan) return fail('Jogador não é do seu clube.');
      if (p.auction) return fail(`${p.name} está em leilão.`);
      if (cmd.price == null) {
        p.salePrice = null;
        return ok(`${p.name} saiu da lista de vendas.`);
      }
      const v = playerValue(p, state.meta.season);
      p.salePrice = roundMoney(clamp(cmd.price, 10_000, Math.max(v * 10, 100_000)));
      return ok(`${p.name} está à venda por ${formatMoney(p.salePrice)}.`);
    }
    case 'setLoanList': {
      const p = state.players[cmd.pid];
      if (!p || p.clubId !== club.id || p.loan) return fail('Jogador não é do seu clube.');
      if (p.auction) return fail(`${p.name} está em leilão.`);
      p.loanListed = cmd.months;
      return ok(cmd.months ? `${p.name} está disponível para empréstimo de ${cmd.months} meses.` : `${p.name} não está mais disponível para empréstimo.`);
    }
    case 'startAuction': {
      const p = state.players[cmd.pid];
      if (!p || p.clubId !== club.id || p.loan) return fail('Jogador não é do seu clube.');
      if (p.auction) return fail(`${p.name} já está em leilão.`);
      if (!windowOpen(state)) return fail('Leilões só com a janela de transferências aberta.');
      if (!auctionCanClose(state)) return fail('A janela fecha antes da próxima rodada: não daria tempo de fechar o leilão.');
      if (squadOf(state, club.id).length <= 17) return fail('Elenco muito curto para leiloar jogadores.');
      const v = playerValue(p, state.meta.season);
      p.salePrice = null;
      p.loanListed = null;
      p.auction = { min: roundMoney(clamp(cmd.min, 10_000, Math.max(v * 5, 100_000))), season: state.meta.season, date: state.meta.date };
      addNews(state, 'transfer', `Leilão: ${club.name} oferece ${p.name} (${p.pos}, força ${Math.round(p.str)}), lance mínimo ${formatMoney(p.auction.min)}.`, [club.id]);
      return ok(`${p.name} vai a leilão. Os lances fecham no início da próxima rodada.`);
    }
    case 'auctionBid': {
      const p = state.players[cmd.pid];
      if (!p?.auction || p.clubId === club.id) return fail('Leilão não encontrado.');
      const bids = (state.auctionBids[p.id] ??= {});
      if (cmd.amount == null) {
        delete bids[club.id];
        return ok('Lance retirado.');
      }
      const amount = roundMoney(cmd.amount);
      const refuses = refusesClub(state, p, club);
      if (refuses) return fail(refuses);
      if (amount < p.auction.min) return fail(`O lance mínimo é ${formatMoney(p.auction.min)}.`);
      if (amount > club.balance) return fail('Saldo insuficiente.');
      bids[club.id] = amount;
      return ok(`Lance de ${formatMoney(amount)} registrado. O resultado sai no início da próxima rodada.`);
    }
    case 'setAutoRenew': {
      const mine = new Set(squadOf(state, club.id).filter((p) => !p.loan).map((p) => p.id));
      const set = new Set((club.autoRenew ?? []).filter((id) => mine.has(id)));
      for (const id of cmd.pids) if (mine.has(id)) (cmd.on ? set.add(id) : set.delete(id));
      club.autoRenew = [...set];
      if (cmd.pids.length === 1) {
        const p = state.players[cmd.pids[0]];
        return ok(cmd.on ? `${p?.name} renova automaticamente no fim da temporada.` : `${p?.name} não renova mais automaticamente.`);
      }
      return ok(cmd.on ? 'Renovação automática marcada.' : 'Renovação automática desmarcada.');
    }
    case 'promoteYouth':
    case 'releaseYouth':
    case 'renameYouth': {
      const p = state.players[cmd.pid];
      if (!p || !p.junior || p.clubId !== club.id) return fail('Jogador não está na sua base.');
      if (cmd.c === 'renameYouth') {
        const name = cmd.name.replace(/\s+/g, ' ').trim();
        if (name.length < 2 || name.length > 30) return fail('Nome entre 2 e 30 letras.');
        const old = p.name;
        p.name = name;
        return ok(`${old} agora se chama ${name}.`);
      }
      if (cmd.c === 'releaseYouth') {
        releaseJunior(state, p);
        return ok(`${p.name} foi dispensado da base.`);
      }
      if (squadOf(state, club.id).length >= 40) return fail('Elenco profissional cheio (máximo 40).');
      promoteJunior(state, p);
      assignNumbers(squadOf(state, club.id));
      return ok(`${p.name} sobe ao profissional: força ${Math.round(p.str)}, contrato até ${p.contractEnd}.`);
    }
    case 'preContract': {
      const p = state.players[cmd.pid];
      if (!p || p.clubId == null || p.clubId === club.id || p.junior) return fail('Jogador não encontrado.');
      const why = preContractBlock(state, p);
      if (why) return fail(why);
      if (p.pre) return fail(`${p.name} já assinou pré-contrato com o ${state.clubs[p.pre.club]?.name}.`);
      const refuses = refusesClub(state, p, club);
      if (refuses) return fail(refuses);
      const demand = wageDemand(state, p, club);
      if (cmd.wage < demand * rng.range(0.9, 1)) return fail(`${p.name} recusou. Pede cerca de ${formatMoney(demand)}/mês para assinar.`);
      const years = clamp(Math.round(cmd.years), 1, 5);
      p.pre = { club: club.id, wage: Math.round(cmd.wage), years };
      const owner = state.clubs[p.clubId];
      if (owner.managerId) addNews(state, 'transfer', `${p.name} assinou pré-contrato com o ${club.name} e sai de graça no fim da temporada.`, [owner.id], owner.managerId);
      return ok(`Pré-contrato assinado: ${p.name} chega de graça em ${state.meta.season + 1}.`);
    }
    case 'setAutoRenewAll':
      club.autoRenewAll = cmd.on;
      return ok(cmd.on ? 'Todos os contratos que vencem serão renovados automaticamente.' : 'Renovação automática só para os jogadores marcados.');
    case 'renew': {
      const p = state.players[cmd.pid];
      if (!p || p.clubId !== club.id || p.loan) return fail('Jogador não é do seu clube.');
      const years = clamp(Math.round(cmd.years), 1, 5);
      const a = age(p, state.meta.season);
      if (a >= 34 && years > 2) return fail(`${p.name} só aceita contratos de até 2 anos.`);
      const demand = expectedWage(p, state.meta.season, club.rep) * (a < 30 ? 1.1 : 1) * (p.morale < 40 ? 1.15 : 1);
      if (cmd.wage < demand * rng.range(0.85, 1.0)) return fail(`${p.name} recusou. Pede cerca de ${formatMoney(demand)}/mês.`);
      p.wage = Math.round(cmd.wage);
      p.contractEnd = Math.max(p.contractEnd, state.meta.season + years - 1 + (state.meta.date > 60 ? 1 : 0));
      p.morale = Math.min(100, p.morale + 8);
      return ok(`${p.name} renovou até ${p.contractEnd}.`);
    }
    case 'release': {
      const p = state.players[cmd.pid];
      if (!p || p.clubId !== club.id) return fail('Jogador não é do seu clube.');
      if (squadOf(state, club.id).length <= 16) return fail('Elenco mínimo de 16 jogadores.');
      if (p.loan) {
        p.clubId = p.loan.from;
        p.loan = null;
        p.num = 0;
        club.lineup.xi = club.lineup.xi.map((x) => (x === p.id ? null : x));
        club.lineup.bench = club.lineup.bench.filter((x) => x !== p.id);
        if (state.clubs[p.clubId]) assignNumbers(squadOf(state, p.clubId));
        return ok(`${p.name} devolvido ao clube de origem.`);
      }
      const years = Math.max(0, p.contractEnd - state.meta.season) + (1 - state.meta.date / 78);
      const comp = Math.round(p.wage * 12 * years * 0.5);
      club.balance -= comp;
      club.ledger.wages += comp;
      p.clubId = null;
      unlist(state, p);
      p.idle = 0;
      p.num = 0;
      club.lineup.xi = club.lineup.xi.map((x) => (x === p.id ? null : x));
      club.lineup.bench = club.lineup.bench.filter((x) => x !== p.id);
      return ok(`${p.name} foi dispensado (multa de ${formatMoney(comp)}).`);
    }
    case 'bid':
      return makeBid(state, m, cmd, rng);
    case 'respondBid':
      return respondBid(state, m, cmd, rng);
    case 'acceptCounter': {
      const b = state.bids[cmd.bid];
      if (!b || b.buyer !== club.id || b.status !== 'contraproposta' || b.counter == null) return fail('Contraproposta não encontrada.');
      b.fee = b.counter;
      return closeBid(state, b, rng, true);
    }
    case 'cancelBid': {
      const b = state.bids[cmd.bid];
      if (!b || b.buyer !== club.id) return fail('Proposta não encontrada.');
      b.status = 'cancelada';
      return ok('Proposta cancelada.');
    }
  }
}

/** Why a player can't sign a pre-contract now (null when he can): only in his contract's last six months. */
export function preContractBlock(state: GameState, p: Player): string | null {
  if (p.loan) return 'Jogador emprestado.';
  if (p.contractEnd > state.meta.season) return `Pré-contrato só com quem tem contrato até ${state.meta.season}.`;
  if (state.meta.date < PRE_CONTRACT_FROM) return 'Pré-contratos só nos últimos seis meses do contrato (a partir do meio da temporada).';
  return null;
}

/** First date (of the season) from which players in their final contract year can sign a pre-contract. */
export const PRE_CONTRACT_FROM = 39;

function makeBid(state: GameState, m: Manager, cmd: Extract<Command, { c: 'bid' }>, rng: Rng): CmdResult {
  const club = myClub(state, m)!;
  const p = state.players[cmd.pid];
  if (!p) return fail('Jogador não encontrado.');
  if (p.clubId === club.id) return fail('Ele já é do seu clube.');
  if (p.loan) return fail('Jogador emprestado, não pode ser negociado agora.');
  if (p.auction) return fail(`${p.name} está em leilão: dê um lance no leilão.`);
  if (p.clubId != null && !windowOpen(state)) return fail('A janela de transferências está fechada.');
  if (cmd.fee > club.balance) return fail('Saldo insuficiente.');
  if (squadOf(state, club.id).length >= 40) return fail('Elenco cheio (máximo 40).');
  if (Object.values(state.bids).some((b) => b.buyer === club.id && b.player === p.id && (b.status === 'pendente' || b.status === 'contraproposta')))
    return fail('Já existe uma proposta sua por este jogador.');
  const id = state.meta.next.bid++;
  const bid: Bid = {
    id,
    player: p.id,
    buyer: club.id,
    seller: p.clubId,
    kind: p.clubId == null ? 'compra' : cmd.kind,
    // a loan costs no fee: the borrower pays the player's current wage for 6 or 12 months
    fee: p.clubId == null || cmd.kind === 'emprestimo' ? 0 : Math.max(0, Math.round(cmd.fee)),
    wage: cmd.kind === 'emprestimo' && p.clubId != null ? p.wage : Math.round(cmd.wage),
    years: clamp(Math.round(cmd.years), 1, 5),
    ...(cmd.kind === 'emprestimo' && p.clubId != null ? { months: p.loanListed ?? cmd.months ?? 12 } : {}),
    status: 'pendente',
    counter: null,
    date: state.meta.date,
    season: state.meta.season,
    msg: '',
  };
  state.bids[id] = bid;
  const seller = p.clubId != null ? state.clubs[p.clubId] : null;
  if (seller?.managerId) {
    // the seller already named his terms: meeting them closes the deal at once
    const meetsListing = bid.kind === 'emprestimo' ? !!p.loanListed : p.salePrice != null && bid.fee >= p.salePrice;
    if (meetsListing) {
      const r = closeBid(state, bid, rng, bid.kind === 'compra');
      if (r.ok) addNews(state, 'transfer', `${p.name} ${bid.kind === 'emprestimo' ? 'foi emprestado' : 'foi vendido'} ao ${club.name}${bid.fee ? ` por ${formatMoney(bid.fee)}` : ''}.`, [seller.id], seller.managerId);
      return r;
    }
    // human seller decides later
    const what = bid.kind === 'emprestimo' ? `pediu ${p.name} emprestado por ${bid.months} meses` : `ofereceu ${formatMoney(bid.fee)} por ${p.name}`;
    addNews(state, 'bid', `O ${club.name} ${what}.`, [seller.id, club.id], seller.managerId);
    bid.msg = 'Aguardando resposta do outro treinador.';
    return ok('Proposta enviada ao outro treinador.');
  }
  const out = resolveAiBid(state, rng, bid);
  if (!out.ok) {
    bid.status = out.counter ? 'contraproposta' : 'recusada';
    bid.counter = out.counter ?? null;
    bid.msg = out.text;
    return fail(out.text);
  }
  return closeBid(state, bid, rng, false);
}

/** Complete a transfer for an agreed bid (player still has to accept the wage). */
function closeBid(state: GameState, b: Bid, rng: Rng, checkPlayer: boolean): CmdResult {
  const p = state.players[b.player];
  const buyer = state.clubs[b.buyer];
  if (!p || p.clubId !== b.seller) {
    b.status = 'expirada';
    return fail('O jogador não está mais disponível.');
  }
  if (p.clubId != null && !windowOpen(state)) return fail('A janela de transferências está fechada.');
  if (buyer.balance < b.fee) return fail('O comprador não tem saldo suficiente.');
  const seller = b.seller != null ? state.clubs[b.seller] : null;
  if (seller?.managerId && squadOf(state, seller.id).length <= 16) return fail(`O ${seller.name} precisa de pelo menos 16 jogadores: não dá para vender agora.`);
  if (checkPlayer) {
    const refuses = refusesClub(state, p, buyer);
    if (refuses) {
      b.status = 'recusada';
      b.msg = refuses;
      return fail(refuses);
    }
    const demand = wageDemand(state, p, buyer);
    if (b.wage < demand * rng.range(0.88, 1)) {
      b.status = 'recusada';
      b.msg = `${p.name} recusou o salário.`;
      return fail(`${p.name} recusou o salário. Pede ${formatMoney(demand)}/mês.`);
    }
  }
  b.status = 'aceita';
  b.msg = 'Negócio fechado.';
  executeTransfer(state, p, buyer, b.fee, b.wage, b.years, b.kind === 'emprestimo', b.months ?? 12);
  // other open bids for this player are void
  for (const o of Object.values(state.bids)) {
    if (o.id !== b.id && o.player === p.id && (o.status === 'pendente' || o.status === 'contraproposta')) o.status = 'expirada';
  }
  if (buyer.managerId) addNews(state, 'transfer', `${p.name} assinou com o ${buyer.name}!`, [buyer.id], buyer.managerId);
  return ok(`${p.name} é do ${buyer.name}!`);
}

function respondBid(state: GameState, m: Manager, cmd: Extract<Command, { c: 'respondBid' }>, rng: Rng): CmdResult {
  const club = myClub(state, m)!;
  const b = state.bids[cmd.bid];
  if (!b || b.seller !== club.id || b.status !== 'pendente') return fail('Proposta não encontrada.');
  const p = state.players[b.player];
  const buyer = state.clubs[b.buyer];
  if (cmd.action === 'recusar') {
    b.status = 'recusada';
    b.msg = 'Recusada pelo vendedor.';
    if (buyer.managerId) addNews(state, 'bid', `O ${club.name} recusou sua proposta por ${p?.name}.`, [buyer.id], buyer.managerId);
    return ok('Proposta recusada.');
  }
  if (cmd.action === 'contraproposta') {
    const fee = Math.round(cmd.fee ?? 0);
    if (fee <= b.fee) return fail('A contraproposta precisa ser maior que a oferta.');
    if (!buyer.managerId) {
      // AI buyer accepts counters up to 25% above its offer if it can pay
      if (fee <= b.fee * 1.25 && buyer.balance >= fee && rng.chance(0.6)) {
        b.fee = fee;
        return closeBid(state, b, rng, false);
      }
      b.status = 'recusada';
      b.msg = 'O comprador desistiu.';
      return fail(`O ${buyer.name} não aceitou a contraproposta.`);
    }
    b.status = 'contraproposta';
    b.counter = fee;
    b.msg = `Contraproposta: ${formatMoney(fee)}`;
    addNews(state, 'bid', `O ${club.name} pediu ${formatMoney(fee)} por ${p?.name}.`, [buyer.id], buyer.managerId);
    return ok('Contraproposta enviada.');
  }
  // accept
  if (!p || p.clubId !== club.id) return fail('Jogador não está mais no clube.');
  return closeBid(state, b, rng, true);
}

// ---------- lobby helpers (host) ----------

export function newManagerId(rng: Rng): string {
  return 'm' + rng.int(0, 0xffffff).toString(36) + rng.int(0, 0xffffff).toString(36);
}

export function createManager(state: GameState, rng: Rng, name: string, clubId: number | null): Manager {
  const id = newManagerId(rng);
  const club = clubId != null ? state.clubs[clubId] : null;
  const m: Manager = {
    id,
    name,
    clubId: null,
    rep: clamp(Math.round((club?.rep ?? 40) - 10), 20, 70),
    since: absDate(state.meta.season, state.meta.date),
    history: [],
    offers: [],
    trophies: [],
  };
  state.managers[id] = m;
  if (clubId != null) {
    takeJob(state, m, clubId);
    ensureYouthTeam(state, rng, state.clubs[clubId]);
  }
  return m;
}

export interface CustomClubSpec {
  name: string;
  short: string;
  colors: [string, string];
  city: string;
  stadium: string;
  replaceClubId: number;
}

/** Bottom division of each country (where custom clubs may enter). */
export function bottomLeagues(state: GameState): string[] {
  const byCountry = new Map<string, { id: string; level: number }>();
  for (const cfg of state.config) {
    if (cfg.kind !== 'league' || !cfg.country) continue;
    const cur = byCountry.get(cfg.country);
    if (!cur || (cfg.level ?? 1) > cur.level) byCountry.set(cfg.country, { id: cfg.id, level: cfg.level ?? 1 });
  }
  return [...byCountry.values()].map((x) => x.id);
}

/**
 * Replace a bottom-division club with a user-created one. At the start of a new game its old squad is removed;
 * later in a career the old players become free agents and the new club keeps the old one's place, points and fixtures.
 */
export function createCustomClub(state: GameState, rng: Rng, spec: CustomClubSpec, newGame = true): string | null {
  const club = state.clubs[spec.replaceClubId];
  if (!club || !club.league || !bottomLeagues(state).includes(club.league)) return 'Escolha um clube da última divisão.';
  if (club.managerId) return 'Esse clube já tem treinador.';
  const name = spec.name.trim();
  if (name.length < 3) return 'Nome muito curto.';
  club.name = name.slice(0, 32);
  club.short = (spec.short.trim() || name.slice(0, 3)).toUpperCase().slice(0, 4);
  club.colors = spec.colors;
  delete club.crest;
  club.city = spec.city.trim().slice(0, 32) || club.city;
  club.stadium = spec.stadium.trim().slice(0, 40) || `Estádio ${club.name}`;
  club.custom = true;
  club.rep = Math.min(club.rep, 30);
  club.capacity = Math.min(club.capacity, 12000);
  club.tc = { level: 1, building: 0 };
  club.estadual = null;
  // fresh generated squad at the division's level
  for (const p of squadOf(state, club.id)) {
    if (newGame) {
      delete state.players[p.id];
    } else if (p.loan) {
      p.clubId = p.loan.from;
      p.loan = null;
    } else {
      p.clubId = null;
      unlist(state, p);
      p.idle = 0;
      p.num = 0;
    }
  }
  // players the old club had loaned out stay where they are
  for (const p of Object.values(state.players)) if (p.loan?.from === club.id) p.loan = null;
  for (const b of Object.values(state.bids)) {
    if ((b.buyer === club.id || b.seller === club.id) && (b.status === 'pendente' || b.status === 'contraproposta')) b.status = 'cancelada';
  }
  const leagueClubs = Object.values(state.clubs).filter((c) => c.league === club.league && c.id !== club.id);
  const avgPower = leagueClubs.reduce((a, c) => a + c.power, 0) / Math.max(1, leagueClubs.length);
  fillSquad(state, rng, club.id, [], Math.min(fillerLevel(club) + 4, avgPower - 2), 0.05, 24);
  const squad = squadOf(state, club.id);
  assignNumbers(squad);
  const monthly = squad.reduce((a, p) => a + p.wage, 0);
  club.tickets = { base: sectorRefs(club), comps: {} };
  club.baseIncome = calibrateIncome(state, club, monthly * 12);
  club.balance = Math.round(roughIncome(club) * 0.12);
  club.stadiumWork = null;
  club.ledger = emptyLedger();
  club.power = squadStrength(squad);
  club.lineup = { xi: [], bench: [] };
  club.autoLineup = true;
  return null;
}

/** Suggested wage/fee values for the bid form. */
export function bidSuggestion(state: GameState, pid: number, buyerId: number) {
  const p = state.players[pid];
  const buyer = state.clubs[buyerId];
  return {
    value: playerValue(p, state.meta.season),
    wage: wageDemand(state, p, buyer),
  };
}
