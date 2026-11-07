import type { CompConfig, Pos, Trait } from './types';

/** Compiled database shipped with the game (public/db/base.json) or imported by the user. */
export interface DbClub {
  key: string;
  name: string;
  short: string;
  country: string;
  state?: string;
  city: string;
  lat: number;
  lon: number;
  colors: [string, string];
  stadium: string;
  capacity: number;
  rep: number;
  /** league competition id, empty for estadual-only / continental-only clubs */
  league: string;
  /** state code if the club plays an estadual */
  estadual?: string;
  continent: 'SA' | 'EU';
  contOnly?: boolean;
  /** crest image URL (from data/db/crests.csv or a crest column) */
  crest?: string;
  /** the club's coach (from data/db/coaches.csv or coach / coach_nat columns); made up when absent */
  coach?: string;
  coachNat?: string;
}

export interface DbPlayer {
  club: string;
  name: string;
  pos: Pos;
  birth: number;
  str: number;
  nat: string;
  traits?: Trait[];
  pot?: number;
  /** potential stars 0-5 (wins over pot) */
  stars?: number;
  /** preferred side: L, R or C (E/D also accepted); assigned in the game when absent */
  side?: 'L' | 'R' | 'C';
}

export interface Database {
  version: number;
  season: number;
  clubs: DbClub[];
  players: DbPlayer[];
  comps: CompConfig[];
  names?: Record<string, { first: string[]; last: string[] }>;
}

export async function loadDefaultDb(): Promise<Database> {
  const url = new URL('db/base.json', document.baseURI).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('Não foi possível carregar o banco de dados');
  return (await res.json()) as Database;
}
