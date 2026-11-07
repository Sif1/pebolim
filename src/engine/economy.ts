import { Rng as RngImpl, type Rng } from './rng';
import type { Club, Competition, Fixture, GameState, SectorPrices, TravelMode } from './types';
import { addNews, clamp, distanceKm, squadIndex } from './util';
import { defaultTicket } from './world';
import { isDerby } from './rivals';
import { pitchCareCost } from './pitch';

// ---------- travel ----------

export const TRAVEL_LABEL: Record<TravelMode, string> = {
  onibus: 'Ônibus',
  comercial: 'Voo comercial',
  fretado: 'Voo fretado',
};

export function travelCost(mode: TravelMode, km: number): number {
  if (km < 30) return 400;
  if (mode === 'onibus') return Math.round(1_500 + km * 6.5);
  if (mode === 'comercial') return Math.round(7_400 + km * 17);
  return Math.round(28_000 + km * 41);
}

/** Fitness points every squad player loses on the trip. */
export function travelFatigue(mode: TravelMode, km: number): number {
  if (km < 30) return 0;
  if (mode === 'onibus') return Math.min(14, 1 + km / 120);
  if (mode === 'comercial') return Math.min(9, 2 + km / 900);
  return Math.min(3, 0.5 + km / 3000);
}

export function busAllowed(km: number) {
  return km <= 1500;
}

export function autoTravel(club: Club, km: number): TravelMode {
  if (km < 450) return 'onibus';
  if (roughIncome(club) > 40_000_000 && club.balance > 0) return 'fretado';
  return 'comercial';
}

export function travelModeFor(club: Club, km: number): TravelMode {
  let mode = club.travel === 'auto' ? autoTravel(club, km) : club.travel;
  if (mode === 'onibus' && !busAllowed(km)) mode = 'comercial';
  return mode;
}

/** Apply the away side's trip: costs money and fitness. */
export function applyTravel(state: GameState, f: Fixture, squadIds: number[]) {
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const km = distanceKm(home, away);
  const mode = travelModeFor(away, km);
  const cost = travelCost(mode, km);
  away.balance -= cost;
  away.ledger.travel += cost;
  const loss = travelFatigue(mode, km);
  if (loss > 0) for (const id of squadIds) state.players[id].fitness = Math.max(30, state.players[id].fitness - loss);
  return { km, mode, cost, loss };
}

// ---------- match-day income ----------

export interface SectorInfo {
  label: string;
  /** share of the stadium's seats */
  share: number;
  /** reference price as a multiple of the club's base ticket price */
  mult: number;
  /** how strongly attendance in the sector reacts to the price (higher = more price-sensitive) */
  elast: number;
  /** relative interest of fans in that sector */
  bias: number;
}

/** Stadium sectors, cheapest first. The weighted reference price equals the club's base ticket price. */
export const SECTORS: SectorInfo[] = [
  { label: 'Geral', share: 0.35, mult: 0.55, elast: 1.15, bias: 1.06 },
  { label: 'Arquibancada', share: 0.4, mult: 0.85, elast: 0.95, bias: 1 },
  { label: 'Cadeiras', share: 0.2, mult: 1.5, elast: 0.75, bias: 0.93 },
  { label: 'Camarotes', share: 0.05, mult: 3.5, elast: 0.55, bias: 0.86 },
];

export function sectorRefs(club: Pick<Club, 'country' | 'rep' | 'continent' | 'contOnly'>): SectorPrices {
  const base = defaultTicket(club);
  return SECTORS.map((s) => Math.max(5, Math.round(base * s.mult))) as SectorPrices;
}

/** Allowed price range for a sector: 20% to 500% of its reference price. */
export function sectorBounds(club: Club, i: number): [number, number] {
  const ref = sectorRefs(club)[i];
  return [Math.max(1, Math.round(ref * 0.2)), Math.round(ref * 5)];
}

/** Prices the club charges in a competition (its override, else the default). */
export function pricesFor(club: Club, compId: string): SectorPrices {
  return club.tickets.comps[compId] ?? club.tickets.base;
}

/** Seats usable right now (a tenth of the stadium is closed during expansion works). */
export function usableCapacity(club: Club): number {
  return club.stadiumWork ? Math.round(club.capacity * 0.9) : club.capacity;
}

/** Fans' interest in a home match before prices (about 0.3 to 1.5). */
export function matchInterest(home: Club, awayRep: number, comp: Competition | undefined, bigStage: boolean): number {
  const wins = (home.form.match(/V/g) ?? []).length;
  let interest = 0.25 + home.rep / 120 + wins * 0.03 + awayRep / 400;
  if (comp?.cfg.scope === 'continental') interest += 0.15;
  if (comp?.cfg.scope === 'state') interest -= 0.1;
  if (bigStage) interest += 0.12;
  // happy fans fill the stadium, angry ones stay home
  return interest * (1 + ((home.fans ?? 60) - 60) * 0.004);
}

export interface Gate {
  /** fans per sector */
  att: [number, number, number, number];
  total: number;
  /** ticket revenue in US$ */
  revenue: number;
}

/** Attendance and revenue per sector for a given interest and prices. `noise` scales demand (1 = expected). */
export function gateFor(club: Club, interest: number, prices: SectorPrices, bigGame: boolean, noise = 1): Gate {
  const cap = usableCapacity(club);
  const refs = sectorRefs(club);
  const att = SECTORS.map((s, i) => {
    const seats = Math.round(cap * s.share);
    const bias = s.bias + (bigGame && i === 3 ? 0.15 : 0);
    // fans get more price-sensitive the further a price goes above the reference, so every sector has a sweet spot
    const k = Math.max(1, prices[i]) / refs[i];
    const e = s.elast * (k > 1 ? 1 + (k - 1) * 0.6 : 1);
    const priceF = Math.pow(1 / k, e);
    const demand = seats * clamp(interest * bias, 0.08, 1.25) * priceF * noise;
    return Math.round(clamp(demand, Math.min(seats, 60), seats));
  }) as Gate['att'];
  const total = att.reduce((a, b) => a + b, 0);
  const revenue = att.reduce((a, n, i) => a + n * prices[i], 0);
  return { att, total, revenue };
}

function isBigStage(state: GameState, f: Fixture): boolean {
  const comp = state.comps[f.comp];
  return f.stage != null && !!comp && f.stage >= comp.stages.length - 3;
}

/** Real attendance of a fixture (with a little randomness). */
export function attendance(state: GameState, f: Fixture, rng: Rng): Gate {
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const comp = state.comps[f.comp];
  // a derby fills the stadium like a final
  const big = isBigStage(state, f) || isDerby(state, f.home, f.away);
  const interest = matchInterest(home, away.rep, comp, big);
  return gateFor(home, interest, pricesFor(home, f.comp), big || comp?.cfg.scope === 'continental', rng.range(0.9, 1.1));
}

/**
 * The gate of a fixture: the same numbers whenever it is asked (seeded by the fixture), so the match screen
 * can show tickets sold before kick-off and the money booked afterwards matches.
 */
export function gateOf(state: GameState, f: Fixture): Gate {
  return attendance(state, f, RngImpl.fromSeed(`gate:${state.meta.season}:${f.id}`));
}

/** Expected gate for a typical home match in a competition (no randomness), for the finance screen. */
export function estimateGate(state: GameState, club: Club, compId: string, prices: SectorPrices): Gate {
  const comp = state.comps[compId];
  const others = comp ? comp.clubs.filter((id) => id !== club.id) : [];
  const awayRep = others.length ? others.reduce((a, id) => a + (state.clubs[id]?.rep ?? 50), 0) / others.length : 50;
  return gateFor(club, matchInterest(club, awayRep, comp, false), prices, comp?.cfg.scope === 'continental');
}

/** Competitions of this season the club takes part in. */
export function clubComps(state: GameState, clubId: number): Competition[] {
  return Object.values(state.comps).filter((c) => c.clubs.includes(clubId));
}

// ---------- per-date running costs ----------

export const DATES_PER_SEASON = 78;

export const TC_UPKEEP = [0, 7_500, 18_500, 41_000, 83_000, 148_000];
export const TC_COST = [0, 0, 1_850_000, 4_600_000, 11_000_000, 26_000_000];
/** dates (rounds on the calendar, about 78 a season) the works for each level take */
export const TC_BUILD = [0, 0, 8, 12, 16, 20];
/** development multiplier per training-centre level */
export const TC_DEV = [0, 0.8, 0.9, 1.0, 1.15, 1.3];
/** recovery multiplier per training-centre level */
export const TC_REC = [0, 0.85, 0.93, 1.0, 1.1, 1.2];
/** chance per date that an injured player heals one extra day */
export const TC_INJ = [0, 0, 0.06, 0.12, 0.18, 0.24];

/** Everything a training-centre level does, for the structure screen. */
export function tcLevelInfo(club: Pick<Club, 'continent'>, lvl: number) {
  return {
    level: lvl,
    cost: TC_COST[lvl] * (club.continent === 'EU' ? 2 : 1),
    build: TC_BUILD[lvl],
    upkeep: TC_UPKEEP[lvl],
    dev: TC_DEV[lvl],
    rec: TC_REC[lvl],
    inj: TC_INJ[lvl],
    /** youth intake: força and potential bonus */
    youthStr: lvl,
    youthPot: lvl * 1.5,
  };
}

/** Dates an expansion of this many seats takes. */
export function stadiumBuildDates(seats: number): number {
  return 4 + Math.ceil(seats / 1000);
}

export function tcUpgradeCost(club: Club): number {
  const lvl = club.tc.level + 1;
  if (lvl > 5) return Infinity;
  return TC_COST[lvl] * (club.continent === 'EU' ? 2 : 1);
}

/** Share of a training-centre works the board pays for itself: half when it trusts the manager, a quarter when unsure. */
export function tcBoardShare(club: Club): number {
  return club.board.conf >= 60 ? 0.5 : club.board.conf >= 40 ? 0.25 : 0;
}

/** What the club itself pays for the next training-centre level, after the board's share. */
export function tcClubCost(club: Club): number {
  return Math.round(tcUpgradeCost(club) * (1 - tcBoardShare(club)));
}

export function seatCost(club: Club): number {
  return club.continent === 'EU' ? 4_600 : 2_200;
}

export function dailyFinances(state: GameState, squadWages: Map<number, number>) {
  for (const c of Object.values(state.clubs)) {
    const wages = Math.round(((squadWages.get(c.id) ?? 0) * 12) / DATES_PER_SEASON);
    const income = Math.round(c.baseIncome / DATES_PER_SEASON);
    const sponsors = Math.round(income * 0.55);
    const tv = income - sponsors;
    const upkeep = Math.round(c.capacity * 0.11 + TC_UPKEEP[c.tc.level] + pitchCareCost(c));
    c.balance += sponsors + tv - wages - upkeep;
    c.ledger.sponsors += sponsors;
    c.ledger.tv += tv;
    c.ledger.wages += wages;
    c.ledger.upkeep += upkeep;
    if (c.tc.building > 0) {
      c.tc.building--;
      if (c.tc.building === 0) {
        c.tc.level = Math.min(5, c.tc.level + 1);
        delete c.tc.total;
        if (c.managerId) addNews(state, 'info', `As obras terminaram: o CT do ${c.name} agora é nível ${c.tc.level}.`, [c.id], c.managerId);
      }
    }
    if (c.stadiumWork) {
      c.stadiumWork.left--;
      if (c.stadiumWork.left <= 0) {
        c.capacity += c.stadiumWork.seats;
        if (c.managerId)
          addNews(state, 'info', `Ampliação concluída: o ${c.stadium} agora tem ${c.capacity.toLocaleString('pt-BR')} lugares.`, [c.id], c.managerId);
        c.stadiumWork = null;
      }
    }
  }
}

// ---------- club budgets ----------

/** Home games per club and competition among this season's fixtures (cup rounds appear as they are drawn). */
export function homeGameCounts(state: GameState): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of Object.values(state.fixtures)) m.set(`${f.home}:${f.comp}`, (m.get(`${f.home}:${f.comp}`) ?? 0) + 1);
  return m;
}

/** Ticket money a club can expect in a season at its current prices (cups: a typical run). */
export function expectedTickets(state: GameState, club: Club, homes = homeGameCounts(state)): number {
  let total = 0;
  for (const comp of clubComps(state, club.id)) {
    let n = homes.get(`${club.id}:${comp.id}`) ?? 0;
    // knockout rounds are drawn as the season goes: assume a typical run
    if (!n) n = comp.cfg.kind === 'league' ? Math.max(1, comp.clubs.length - 1) : comp.cfg.scope === 'continental' ? 3.5 : 1.5;
    total += estimateGate(state, club, comp.id, pricesFor(club, comp.id)).revenue * n;
  }
  return total;
}

/** Quick estimate of a season's income (sponsors, TV and about 17 full-price home gates), for daily checks. */
export function roughIncome(club: Club): number {
  return club.baseIncome + club.capacity * defaultTicket(club) * 17;
}

/** Season costs besides wages: stadium and CT upkeep plus typical away trips. */
export function runningCosts(club: Club): number {
  const upkeep = (club.capacity * 0.11 + TC_UPKEEP[club.tc.level] + pitchCareCost(club)) * DATES_PER_SEASON;
  const travel = 19 * travelCost('comercial', club.continent === 'SA' ? 900 : 600);
  return upkeep + travel;
}

/**
 * Sponsors and TV money sized so a club with its current squad and stadium roughly breaks even before
 * prize money and cup runs: clubs that fill big stadiums need less of it. Never below 30% of the wage bill.
 */
export function calibrateIncome(state: GameState, club: Club, yearlyWages: number, homes?: Map<string, number>): number {
  const tickets = expectedTickets(state, club, homes);
  return Math.round(Math.max(yearlyWages * 0.3, (yearlyWages + runningCosts(club)) * 1.0 - tickets));
}

/** Set every club's income and starting cash from its real costs (new game). */
export function calibrateAll(state: GameState, rng: Rng) {
  const homes = homeGameCounts(state);
  const idx = squadIndex(state);
  for (const c of Object.values(state.clubs)) {
    const wages = (idx.get(c.id) ?? []).reduce((a, p) => a + p.wage, 0) * 12;
    c.baseIncome = Math.round(calibrateIncome(state, c, wages, homes) * rng.range(0.97, 1.03));
    c.balance = Math.round((c.baseIncome + expectedTickets(state, c, homes)) * rng.range(0.1, 0.3));
  }
}

/**
 * What an AI club can spend on wages per season: its income after running costs, plus a slice of any
 * savings above half a season's income (so rich clubs slowly spend their cash on better-paid players).
 */
export function wageBudget(state: GameState, club: Club, homes?: Map<string, number>): number {
  const income = club.baseIncome + expectedTickets(state, club, homes);
  const spare = Math.max(0, club.balance - 0.5 * income);
  return Math.max(0, (income - runningCosts(club)) * 1.02 + spare * 0.25);
}

/** AI clubs with plenty of cash invest in their training centre (checked once per date, a few clubs at a time). */
export function aiInvest(state: GameState, rng: Rng) {
  for (const c of Object.values(state.clubs)) {
    if (c.managerId || c.tc.building > 0 || c.tc.level >= 5 || !(c.league || c.contOnly)) continue;
    if (!rng.chance(0.03)) continue;
    const cost = tcUpgradeCost(c);
    if (c.balance < Math.max(cost * 2.5, c.baseIncome * 0.6)) continue;
    c.balance -= cost;
    c.ledger.works += cost;
    c.tc.building = TC_BUILD[c.tc.level + 1];
    c.tc.total = c.tc.building;
  }
}
