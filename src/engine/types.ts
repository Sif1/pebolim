import type { RngState } from './rng';

export const SAVE_FORMAT_VERSION = 2;

export type Pos = 'GOL' | 'LAT' | 'ZAG' | 'VOL' | 'MEI' | 'ATA';
export const POSITIONS: Pos[] = ['GOL', 'LAT', 'ZAG', 'VOL', 'MEI', 'ATA'];

export type Trait =
  | 'finalizacao'
  | 'cabeceio'
  | 'velocidade'
  | 'drible'
  | 'passe'
  | 'marcacao'
  | 'lideranca'
  | 'reflexos'
  | 'cobrancas';
export const TRAITS: Trait[] = [
  'finalizacao',
  'cabeceio',
  'velocidade',
  'drible',
  'passe',
  'marcacao',
  'lideranca',
  'reflexos',
  'cobrancas',
];

export interface SeasonStats {
  apps: number;
  goals: number;
  ast: number;
  yel: number;
  red: number;
  /** sum of match ratings ×10 (average = rt / apps / 10) */
  rt: number;
}

export interface Player {
  id: number;
  name: string;
  nat: string;
  pos: Pos;
  birth: number;
  /** força, 1-99 (kept as float, shown rounded) */
  str: number;
  /** hidden potential */
  pot: number;
  traits: Trait[];
  clubId: number | null;
  /** monthly wage in R$ */
  wage: number;
  /** last season covered by the contract */
  contractEnd: number;
  fitness: number;
  morale: number;
  /** dates out injured */
  injury: number;
  /** compId -> matches suspended */
  ban: Record<string, number>;
  /** compId -> yellow cards accumulated */
  yel: Record<string, number>;
  listed: boolean;
  loan: { from: number; until: number } | null;
  s: SeasonStats;
  c: { apps: number; goals: number };
  num: number;
  /** seasons spent without a club (free agents retire after a while) */
  idle: number;
}

export type Formation = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2' | '4-5-1' | '3-4-3';
export type Mentality = 'defensiva' | 'equilibrada' | 'ofensiva';
export type Marking = 'zona' | 'pressao';
export type Style = 'toque' | 'contra' | 'longa';

export interface Tactics {
  formation: Formation;
  mentality: Mentality;
  marking: Marking;
  style: Style;
  /**
   * Custom positions: grid cells (row * 5 + col) for slots 1..10 (slot 0 is the keeper).
   * Null/absent = the preset formation's positions.
   */
  shape?: number[] | null;
}

export interface Lineup {
  /** aligned with formation slots; null = empty slot */
  xi: (number | null)[];
  bench: number[];
}

export type TravelMode = 'onibus' | 'comercial' | 'fretado';

/** Ticket prices per stadium sector, cheapest first: geral, arquibancada, cadeiras, camarotes. */
export type SectorPrices = [number, number, number, number];

export interface TicketPrices {
  /** default prices per sector */
  base: SectorPrices;
  /** per-competition overrides (competition id -> prices) */
  comps: Record<string, SectorPrices>;
}
export type TrainingFocus = 'equilibrado' | 'fisico' | 'tecnico';
export type Objective = 'titulo' | 'continental' | 'meio' | 'rebaixamento' | 'acesso';

export interface Ledger {
  tickets: number;
  sponsors: number;
  tv: number;
  prizes: number;
  sales: number;
  wages: number;
  upkeep: number;
  travel: number;
  purchases: number;
  works: number;
}

export interface Club {
  id: number;
  key: string;
  name: string;
  short: string;
  country: string;
  state: string | null;
  city: string;
  lat: number;
  lon: number;
  colors: [string, string];
  stadium: string;
  capacity: number;
  /** reputation 1-100 */
  rep: number;
  /** current league competition id (null for estadual-only and continental-only clubs) */
  league: string | null;
  /** state code for estadual participation (Brazil only) */
  estadual: string | null;
  continent: 'SA' | 'EU';
  /** continental-only club: has squad but no simulated league */
  contOnly: boolean;
  balance: number;
  /** yearly sponsors + TV income baseline */
  baseIncome: number;
  tickets: TicketPrices;
  /** training centre: level 1-5; building = dates left on the next level's works, total = their full length */
  tc: { level: number; building: number; total?: number };
  stadiumWork: { seats: number; left: number; total?: number } | null;
  focus: TrainingFocus;
  tactics: Tactics;
  lineup: Lineup;
  autoLineup: boolean;
  travel: TravelMode | 'auto';
  managerId: string | null;
  upForSelection: boolean;
  custom: boolean;
  board: { conf: number; goal: Objective };
  /** cached best-XI strength, refreshed at season start and after transfers */
  power: number;
  ledger: Ledger;
  /** last results, most recent last: V/E/D */
  form: string;
}

export type CompKind = 'league' | 'cup' | 'groups';
export type Track = 'E' | 'L' | 'N' | 'C';

export type EntrantRule =
  | { from: string; pos?: [number, number] }
  | { winner: string }
  | { pool: string; n: number }
  | { contOnly: 'SA' | 'EU'; n?: number }
  | { state: string };

export interface CompConfig {
  id: string;
  name: string;
  short: string;
  kind: CompKind;
  scope: 'national' | 'state' | 'continental';
  country?: string;
  continent?: 'SA' | 'EU';
  /** division level for leagues (1 = top) */
  level?: number;
  /** round-robin legs (league or groups) */
  legs?: 1 | 2;
  /** tracks the competition may be scheduled on */
  tracks: Track[];
  /** top n are promoted into `comp` */
  up?: { comp: string; n: number };
  /** bottom n are relegated into `comp` ('POOL' = estadual-only pool) */
  down?: { comp: string; n: number };
  /** cups: knockout ties with this many clubs or fewer are two-legged (0 = never) */
  twoLegFrom?: number;
  finalLegs?: 1 | 2;
  /** groups competitions */
  groups?: number;
  advance?: number;
  koLegs?: 1 | 2;
  entrants?: EntrantRule[];
  size?: number;
  /** champion prize money in R$ */
  prize: number;
  color?: string;
}

export interface TableRow {
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

export interface Tie {
  a: number;
  b: number | null;
  fixtures: number[];
  winner: number | null;
}

export interface Stage {
  name: string;
  legs: 1 | 2;
  dates: number[];
  ties: Tie[];
}

export interface Group {
  name: string;
  clubs: number[];
  table: Record<number, TableRow>;
}

export interface Competition {
  id: string;
  cfg: CompConfig;
  clubs: number[];
  /** league table (leagues only) */
  table: Record<number, TableRow>;
  groups: Group[];
  stages: Stage[];
  stageIdx: number;
  /** league rounds / group matchdays dates */
  dates: number[];
  champion: number | null;
  finished: boolean;
}

export interface GoalEvent {
  min: number;
  side: 0 | 1;
  pid: number;
  ast: number | null;
  pen?: boolean;
  og?: boolean;
}

export interface Fixture {
  id: number;
  comp: string;
  date: number;
  home: number;
  away: number;
  hg: number | null;
  ag: number | null;
  pens: [number, number] | null;
  stage: number | null;
  tie: number | null;
  leg: number;
  group: number | null;
  round: number;
  goals: GoalEvent[];
  att: number;
  /** red cards [home, away] for summary */
  reds?: [number, number];
}

export interface CalDate {
  idx: number;
  day: number;
  month: number;
  wd: 'dom' | 'qua';
  track: Track;
  window: boolean;
}

export interface JobOffer {
  clubId: number;
  until: number;
}

export interface Manager {
  id: string;
  name: string;
  clubId: number | null;
  rep: number;
  /** date index (absolute: season*100+date) when the current job started */
  since: number;
  history: { season: number; clubId: number; note: string }[];
  offers: JobOffer[];
  trophies: { season: number; comp: string; clubId: number }[];
}

export type BidStatus = 'pendente' | 'aceita' | 'recusada' | 'contraproposta' | 'expirada' | 'cancelada';

export interface Bid {
  id: number;
  player: number;
  buyer: number;
  seller: number | null;
  kind: 'compra' | 'emprestimo';
  fee: number;
  wage: number;
  years: number;
  status: BidStatus;
  counter: number | null;
  date: number;
  season: number;
  msg: string;
}

export type NewsKind =
  | 'transfer'
  | 'fired'
  | 'hired'
  | 'title'
  | 'promo'
  | 'releg'
  | 'injury'
  | 'info'
  | 'board'
  | 'offer'
  | 'bid'
  | 'contract'
  | 'finance';

export interface News {
  id: number;
  season: number;
  date: number;
  kind: NewsKind;
  text: string;
  clubs: number[];
  /** when set, only this manager sees it */
  to: string | null;
}

export interface SeasonHistory {
  season: number;
  champions: Record<string, number>;
  topScorers: Record<string, { pid: number; name: string; goals: number; clubId: number | null }>;
}

export interface Settings {
  /** real-time minutes a live match lasts */
  matchMinutes: number;
  windows: boolean;
}

export interface Meta {
  name: string;
  season: number;
  startSeason: number;
  /** index into calendar of the next date to be played */
  date: number;
  rng: RngState;
  next: { player: number; fixture: number; bid: number; news: number; club: number };
  settings: Settings;
  created: string;
  /** true while the season-end screen should be shown */
  seasonOver: boolean;
}

export interface GameState {
  v: number;
  meta: Meta;
  clubs: Record<number, Club>;
  players: Record<number, Player>;
  comps: Record<string, Competition>;
  fixtures: Record<number, Fixture>;
  calendar: CalDate[];
  managers: Record<string, Manager>;
  bids: Record<number, Bid>;
  news: News[];
  history: SeasonHistory[];
  /** last season's final league order and cup winners, used for qualification */
  prev: { ranks: Record<string, number[]>; winners: Record<string, number> };
  config: CompConfig[];
  /** name pools for generated players, keyed by nationality */
  names: Record<string, { first: string[]; last: string[] }>;
}
