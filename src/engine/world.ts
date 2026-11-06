import { autoLineup, bestFormation, squadStrength } from './ai/lineup';
import { buildCalendar } from './calendar';
import { createSeasonComps } from './competitions';
import type { Database } from './db';
import { assignNumbers, fillSquad, potentialFor, randomTraits, strForRep } from './generator';
import { defaultNamePools } from './names';
import { Rng } from './rng';
import { SAVE_FORMAT_VERSION, type Club, type GameState, type Objective, type Player, type Settings } from './types';
import { clamp, emptyLedger, expectedWage, squadIndex } from './util';
import { sectorRefs } from './economy';

export const DEFAULT_SETTINGS: Settings = { matchMinutes: 5, windows: true };

export function defaultTicket(c: Pick<Club, 'country' | 'rep' | 'continent' | 'contOnly'>): number {
  if (c.continent === 'EU') return Math.round(c.contOnly ? 80 + c.rep * 1.5 : 110 + c.rep * 2.6);
  if (c.country === 'BRA') return Math.round(18 + c.rep * 0.9);
  return Math.round(14 + c.rep * 0.6);
}

export function foreignShareFor(c: Club): number {
  if (c.continent === 'EU') return 0.3;
  if (c.country === 'BRA') return 0.06;
  return 0.08;
}

export interface NewWorldOptions {
  name: string;
  seed: string;
  settings?: Partial<Settings>;
}

export function createWorld(db: Database, opts: NewWorldOptions): GameState {
  const rng = Rng.fromSeed(opts.seed);
  const season = db.season;
  const state: GameState = {
    v: SAVE_FORMAT_VERSION,
    meta: {
      name: opts.name,
      season,
      startSeason: season,
      date: 0,
      rng: rng.state(),
      next: { player: 1, fixture: 1, bid: 1, news: 1, club: 1 },
      settings: { ...DEFAULT_SETTINGS, ...opts.settings },
      created: new Date().toISOString(),
      seasonOver: false,
    },
    clubs: {},
    players: {},
    comps: {},
    fixtures: {},
    calendar: [],
    managers: {},
    bids: {},
    news: [],
    history: [],
    prev: { ranks: {}, winners: {} },
    config: db.comps,
    names: db.names ?? defaultNamePools(),
  };

  const keyToId = new Map<string, number>();
  for (const dc of db.clubs) {
    const id = state.meta.next.club++;
    keyToId.set(dc.key, id);
    state.clubs[id] = {
      id,
      key: dc.key,
      name: dc.name,
      short: dc.short || dc.name.slice(0, 3).toUpperCase(),
      country: dc.country,
      state: dc.state ?? null,
      city: dc.city,
      lat: dc.lat,
      lon: dc.lon,
      colors: dc.colors,
      stadium: dc.stadium,
      capacity: dc.capacity,
      rep: dc.rep,
      league: dc.league || null,
      estadual: dc.estadual || null,
      continent: dc.continent,
      contOnly: !!dc.contOnly,
      balance: 0,
      baseIncome: 0,
      tickets: { base: [0, 0, 0, 0], comps: {} },
      tc: { level: clamp(Math.round(dc.rep / 22), 1, 4), building: 0 },
      stadiumWork: null,
      focus: 'equilibrado',
      tactics: { formation: '4-4-2', mentality: 'equilibrada', marking: 'zona', style: 'toque' },
      lineup: { xi: [], bench: [] },
      autoLineup: true,
      travel: 'auto',
      managerId: null,
      upForSelection: false,
      custom: false,
      board: { conf: 60, goal: 'meio' },
      power: 0,
      ledger: emptyLedger(),
      form: '',
    };
    state.clubs[id].tickets.base = sectorRefs(state.clubs[id]);
  }

  // curated players
  for (const dp of db.players) {
    const clubId = dp.club ? (keyToId.get(dp.club) ?? null) : null;
    const club = clubId != null ? state.clubs[clubId] : null;
    const ageY = season - dp.birth;
    const p: Player = {
      id: state.meta.next.player++,
      name: dp.name,
      nat: dp.nat,
      pos: dp.pos,
      birth: dp.birth,
      str: dp.str,
      pot: dp.pot ?? potentialFor(dp.str, ageY, rng),
      traits: dp.traits ?? randomTraits(dp.pos, dp.str, rng),
      clubId,
      wage: 0,
      contractEnd: season + rng.int(0, 3),
      fitness: rng.int(90, 100),
      morale: rng.int(55, 70),
      injury: 0,
      ban: {},
      yel: {},
      listed: false,
      loan: null,
      s: { apps: 0, goals: 0, ast: 0, yel: 0, red: 0, rt: 0 },
      c: { apps: 0, goals: 0 },
      num: 0,
      idle: 0,
    };
    p.wage = expectedWage(p, season, club?.rep ?? 50);
    state.players[p.id] = p;
  }

  // fill every squad with generated players
  let idx = squadIndex(state);
  for (const club of Object.values(state.clubs)) {
    const existing = idx.get(club.id) ?? [];
    let level = strForRep(club.rep);
    if (existing.length >= 6) {
      const top = [...existing].sort((a, b) => b.str - a.str).slice(0, 11);
      const avg = top.reduce((a, p) => a + p.str, 0) / top.length;
      level = Math.min(level, avg - 4);
    }
    const target = club.league ? 25 : 22;
    fillSquad(state, rng, club.id, existing, level, foreignShareFor(club), target);
  }

  idx = squadIndex(state);
  for (const club of Object.values(state.clubs)) {
    const squad = idx.get(club.id) ?? [];
    assignNumbers(squad);
    const monthly = squad.reduce((a, p) => a + p.wage, 0);
    club.baseIncome = Math.round(((monthly * 12) / 0.85) * rng.range(0.9, 1.1));
    club.balance = Math.round(club.baseIncome * rng.range(0.12, 0.35));
    club.tactics.formation = bestFormation(squad);
    club.lineup = autoLineup(squad, club.tactics.formation, null);
  }

  startSeason(state, rng);
  state.meta.rng = rng.state();
  return state;
}

/** Build competitions, calendar and objectives for state.meta.season. */
export function startSeason(state: GameState, rng: Rng) {
  state.calendar = buildCalendar(state.meta.season);
  state.fixtures = {};
  state.meta.date = 0;
  for (const p of Object.values(state.players)) {
    p.s = { apps: 0, goals: 0, ast: 0, yel: 0, red: 0, rt: 0 };
    p.yel = {};
    p.ban = {};
  }
  for (const b of Object.values(state.bids)) if (b.status === 'pendente' || b.status === 'contraproposta') b.status = 'expirada';
  createSeasonComps(state, rng);
  const idx = squadIndex(state);
  for (const c of Object.values(state.clubs)) {
    c.ledger = emptyLedger();
    c.form = '';
    const squad = idx.get(c.id) ?? [];
    c.power = squadStrength(squad);
    if (!c.managerId) {
      c.tactics.formation = bestFormation(squad);
      c.lineup = autoLineup(squad, c.tactics.formation, null);
    }
  }
  setObjectives(state);
}

export function setObjectives(state: GameState) {
  const byLeague = new Map<string, Club[]>();
  for (const c of Object.values(state.clubs)) {
    if (!c.league) continue;
    let arr = byLeague.get(c.league);
    if (!arr) byLeague.set(c.league, (arr = []));
    arr.push(c);
  }
  for (const [lid, clubs] of byLeague) {
    const comp = state.comps[lid];
    const level = comp?.cfg.level ?? 1;
    const hasUp = !!comp?.cfg.up;
    const hasDown = !!comp?.cfg.down;
    const n = clubs.length;
    clubs.sort((a, b) => b.power - a.power || b.rep - a.rep);
    clubs.forEach((c, i) => {
      const pos = i + 1;
      let goal: Objective = 'meio';
      if (level === 1) {
        if (pos <= 2) goal = 'titulo';
        else if (pos <= Math.round(n * 0.3)) goal = 'continental';
        else if (hasDown && pos > n - 6) goal = 'rebaixamento';
      } else {
        if (hasUp && pos <= 5) goal = 'acesso';
        else if (hasDown && pos > n - 5) goal = 'rebaixamento';
      }
      c.board.goal = goal;
      c.board.conf = Math.round((c.board.conf + 60) / 2);
    });
  }
}

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  titulo: 'Brigar pelo título',
  continental: 'Vaga continental',
  meio: 'Campanha segura no meio da tabela',
  rebaixamento: 'Evitar o rebaixamento',
  acesso: 'Conquistar o acesso',
};
