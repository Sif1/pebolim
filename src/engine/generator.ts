import { ceilingFor, starsFor } from './potential';
import type { Rng } from './rng';
import { poolFor } from './names';
import type { Club, GameState, Player, Pos, Trait } from './types';
import { clamp, expectedWage } from './util';

const TRAITS_BY_POS: Record<Pos, Trait[]> = {
  GOL: ['reflexos', 'lideranca', 'reflexos'],
  ZAG: ['cabeceio', 'marcacao', 'lideranca', 'velocidade'],
  LAT: ['velocidade', 'passe', 'marcacao', 'drible'],
  VOL: ['marcacao', 'passe', 'lideranca', 'cobrancas'],
  MEI: ['passe', 'drible', 'cobrancas', 'finalizacao', 'velocidade'],
  ATA: ['finalizacao', 'cabeceio', 'velocidade', 'drible'],
};

export function randomTraits(pos: Pos, str: number, rng: Rng): Trait[] {
  const p1 = clamp((str - 52) / 35, 0.05, 0.9);
  const out: Trait[] = [];
  if (rng.chance(p1)) out.push(rng.pick(TRAITS_BY_POS[pos]));
  if (rng.chance(p1 * 0.45)) {
    const t = rng.pick(TRAITS_BY_POS[pos]);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function randomName(state: Pick<GameState, 'names'>, nat: string, rng: Rng): string {
  const pool = state.names[poolFor(nat)] ?? state.names.ENG ?? Object.values(state.names)[0];
  return `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
}


export interface GenOpts {
  pos: Pos;
  str: number;
  nat: string;
  ageY: number;
  clubId: number | null;
  clubRep: number;
}

export function generatePlayer(state: GameState, rng: Rng, o: GenOpts): Player {
  const season = state.meta.season;
  const p: Player = {
    id: state.meta.next.player++,
    name: randomName(state, o.nat, rng),
    nat: o.nat,
    pos: o.pos,
    birth: season - o.ageY,
    str: clamp(Math.round(o.str), 25, 95),
    stars: 0,
    pot: 0,
    traits: [],
    clubId: o.clubId,
    wage: 0,
    contractEnd: season + rng.int(0, 3),
    fitness: rng.int(88, 100),
    morale: rng.int(50, 70),
    injury: 0,
    ban: {},
    yel: {},
    salePrice: null,
    loanListed: null,
    auction: null,
    loan: null,
    s: { apps: 0, goals: 0, ast: 0, yel: 0, red: 0, rt: 0 },
    c: { apps: 0, goals: 0 },
    num: 0,
    idle: 0,
  };
  p.stars = starsFor(p.str, o.ageY, rng);
  p.pot = ceilingFor(p.stars);
  p.traits = randomTraits(o.pos, p.str, rng);
  p.wage = expectedWage(p, season, o.clubRep);
  return p;
}

/** Squad composition target. */
export const SQUAD_SHAPE: Record<Pos, number> = { GOL: 3, ZAG: 4, LAT: 4, VOL: 4, MEI: 5, ATA: 5 };

/**
 * Young and veteran fillers are a bit weaker than prime-age ones. At a big club the gap for the young ones is
 * wider: a teenager at the level of a top European first team is a once-in-a-generation prodigy, not squad depth.
 */
export function ageAdjust(ageY: number, level = 70): number {
  const young = 1 + Math.max(0, level - 70) / 25;
  if (ageY <= 19) return -8 * young;
  if (ageY <= 21) return -5 * young;
  if (ageY <= 23) return -2 * young;
  if (ageY >= 34) return -3;
  return 0;
}

export function randomAge(rng: Rng): number {
  return clamp(Math.round(rng.normal(25.5, 4)), 17, 36);
}

/** Expected squad level for a club reputation. */
export const strForRep = (rep: number) => 44 + rep * 0.42;

/**
 * Invented players by country, relative to the generic level for a reputation: the same reputation means a
 * smaller football economy outside Brazil and the big European leagues (a top Uruguayan club is not Flamengo).
 */
const COUNTRY_LEVEL: Record<string, number> = {
  URU: -6,
  ARG: -3,
  PAR: -6,
  CHI: -6,
  COL: -5,
  ECU: -5,
  PER: -7,
  BOL: -8,
  VEN: -8,
  POR: -1,
  NED: -1,
  BEL: -2,
  TUR: -2,
  SCO: -3,
  AUT: -3,
  SUI: -3,
  GRE: -3,
  CZE: -3,
  DEN: -3,
  UKR: -3,
  CRO: -3,
  SRB: -3,
  NOR: -4,
  SWE: -4,
};

/** Level of the invented players that fill a club's squad. */
export const fillerLevel = (club: Pick<Club, 'rep' | 'country'>) => strForRep(club.rep) + (COUNTRY_LEVEL[club.country ?? ''] ?? 0);

/**
 * The level a club's academy works from: its filler level, compressed at the top, so the biggest academies turn
 * out good prospects rather than teenagers who are already world class.
 */
export function academyLevel(club: Pick<Club, 'rep' | 'country'>): number {
  const l = fillerLevel(club);
  return l - Math.max(0, l - 72) * 0.4;
}

/** Fill a club's squad up to the target shape with generated players around `level`. */
export function fillSquad(state: GameState, rng: Rng, clubId: number, existing: Player[], level: number, foreignShare: number, target = 25) {
  const club = state.clubs[clubId];
  const homeNat = natOfCountry(club.country);
  const counts: Record<Pos, number> = { GOL: 0, ZAG: 0, LAT: 0, VOL: 0, MEI: 0, ATA: 0 };
  for (const p of existing) counts[p.pos]++;
  let total = existing.length;
  const scale = target / 25;
  for (const pos of Object.keys(SQUAD_SHAPE) as Pos[]) {
    const want = Math.max(pos === 'GOL' ? 2 : 1, Math.round(SQUAD_SHAPE[pos] * scale));
    while (counts[pos] < want && total < target + 3) {
      const nat = rng.chance(foreignShare) ? foreignNat(club.continent, homeNat, rng) : homeNat;
      const ageY = randomAge(rng);
      const p = generatePlayer(state, rng, {
        pos,
        // squad depth: around the club's level, never a made-up star above its real ones
        str: Math.min(level + 5, rng.normal(level + ageAdjust(ageY, level), 4)),
        nat,
        ageY,
        clubId,
        clubRep: club.rep,
      });
      state.players[p.id] = p;
      counts[pos]++;
      total++;
    }
  }
}

export function natOfCountry(country: string): string {
  return country;
}

export function foreignNat(continent: 'SA' | 'EU', home: string, rng: Rng): string {
  const sa = ['BRA', 'ARG', 'URU', 'COL', 'PAR', 'CHI', 'ECU'];
  const eu = ['BRA', 'ARG', 'FRA', 'ESP', 'POR', 'NED', 'GER', 'ITA', 'ENG', 'BEL', 'URU', 'COL'];
  const list = (continent === 'SA' ? sa : eu).filter((n) => n !== home);
  return rng.pick(list);
}

/** Assign unique shirt numbers within a club by position order. */
export function assignNumbers(players: Player[]) {
  const order: Pos[] = ['GOL', 'LAT', 'ZAG', 'VOL', 'MEI', 'ATA'];
  const pref: Record<Pos, number[]> = {
    GOL: [1, 12, 23, 40],
    LAT: [2, 6, 13, 16, 26],
    ZAG: [3, 4, 5, 14, 15, 24, 33],
    VOL: [5, 8, 15, 18, 25, 28],
    MEI: [10, 8, 7, 11, 17, 20, 22, 30],
    ATA: [9, 11, 7, 19, 21, 27, 29, 99],
  };
  const used = new Set(players.filter((p) => p.num > 0).map((p) => p.num));
  const sorted = [...players].sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos) || b.str - a.str);
  for (const p of sorted) {
    if (p.num > 0) continue;
    let n = pref[p.pos].find((x) => !used.has(x));
    if (n == null) {
      n = 2;
      while (used.has(n)) n++;
    }
    p.num = n;
    used.add(n);
  }
}
