import type { Rng } from './rng';
import type { Club, Fixture, GameState, TravelMode } from './types';
import { clamp, distanceKm } from './util';
import { defaultTicket } from './world';

// ---------- travel ----------

export const TRAVEL_LABEL: Record<TravelMode, string> = {
  onibus: 'Ônibus',
  comercial: 'Voo comercial',
  fretado: 'Voo fretado',
};

export function travelCost(mode: TravelMode, km: number): number {
  if (km < 30) return 2_000;
  if (mode === 'onibus') return Math.round(8_000 + km * 35);
  if (mode === 'comercial') return Math.round(40_000 + km * 90);
  return Math.round(150_000 + km * 220);
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
  if (club.baseIncome > 150_000_000 && club.balance > 0) return 'fretado';
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

export function attendance(state: GameState, f: Fixture, rng: Rng): number {
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const comp = state.comps[f.comp];
  const wins = (home.form.match(/V/g) ?? []).length;
  let interest = 0.25 + home.rep / 120 + wins * 0.03 + away.rep / 400;
  if (comp?.cfg.scope === 'continental') interest += 0.15;
  if (comp?.cfg.scope === 'state') interest -= 0.1;
  if (f.stage != null && comp && f.stage >= comp.stages.length - 3) interest += 0.12;
  const ref = defaultTicket(home);
  const priceF = Math.pow(ref / Math.max(1, home.ticket), 0.8);
  const demand = home.capacity * clamp(interest, 0.08, 1.2) * priceF * rng.range(0.9, 1.1);
  return Math.round(clamp(demand, 300, home.capacity));
}

// ---------- per-date running costs ----------

export const DATES_PER_SEASON = 78;

export const TC_UPKEEP = [0, 40_000, 100_000, 220_000, 450_000, 800_000];
export const TC_COST = [0, 0, 10_000_000, 25_000_000, 60_000_000, 140_000_000];
export const TC_BUILD = [0, 0, 6, 8, 10, 12];
/** development multiplier per training-centre level */
export const TC_DEV = [0, 0.8, 0.9, 1.0, 1.15, 1.3];
/** recovery multiplier per training-centre level */
export const TC_REC = [0, 0.85, 0.93, 1.0, 1.1, 1.2];

export function tcUpgradeCost(club: Club): number {
  const lvl = club.tc.level + 1;
  if (lvl > 5) return Infinity;
  return TC_COST[lvl] * (club.continent === 'EU' ? 2 : 1);
}

export function seatCost(club: Club): number {
  return club.continent === 'EU' ? 25_000 : 12_000;
}

export function dailyFinances(state: GameState, squadWages: Map<number, number>) {
  for (const c of Object.values(state.clubs)) {
    const wages = Math.round(((squadWages.get(c.id) ?? 0) * 12) / DATES_PER_SEASON);
    const income = Math.round(c.baseIncome / DATES_PER_SEASON);
    const sponsors = Math.round(income * 0.55);
    const tv = income - sponsors;
    const upkeep = Math.round(c.capacity * 0.6 + TC_UPKEEP[c.tc.level]);
    c.balance += sponsors + tv - wages - upkeep;
    c.ledger.sponsors += sponsors;
    c.ledger.tv += tv;
    c.ledger.wages += wages;
    c.ledger.upkeep += upkeep;
    if (c.tc.building > 0) {
      c.tc.building--;
      if (c.tc.building === 0) c.tc.level = Math.min(5, c.tc.level + 1);
    }
    if (c.stadiumWork) {
      c.stadiumWork.left--;
      if (c.stadiumWork.left <= 0) {
        c.capacity += c.stadiumWork.seats;
        c.stadiumWork = null;
      }
    }
  }
}
