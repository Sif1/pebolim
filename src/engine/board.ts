import type { Rng } from './rng';
import type { Club, Fixture, GameState, Manager } from './types';
import { absDate, addNews, clamp } from './util';

const OFFER_DATES = 5;

/** Board confidence after a match. */
export function boardAfterMatch(state: GameState, f: Fixture) {
  const comp = state.comps[f.comp];
  if (!comp || f.hg == null || f.ag == null) return;
  const weight = comp.cfg.kind === 'league' ? 1 : comp.cfg.scope === 'state' ? 0.4 : 0.7;
  for (const side of [0, 1] as const) {
    const club = state.clubs[side === 0 ? f.home : f.away];
    const opp = state.clubs[side === 0 ? f.away : f.home];
    const gf = side === 0 ? f.hg : f.ag;
    const ga = side === 0 ? f.ag : f.hg;
    const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
    const diff = club.power - opp.power + (side === 0 ? 3 : -3);
    const expected = clamp(1.35 + diff / 9, 0.35, 2.5);
    club.board.conf = clamp(club.board.conf + (pts - expected) * 3.2 * weight, 0, 100);
  }
}

export function boardFinanceCheck(club: Club) {
  if (club.balance < -0.25 * club.baseIncome) club.board.conf = clamp(club.board.conf - 0.8, 0, 100);
}

export function managerOf(state: GameState, club: Club): Manager | null {
  return club.managerId ? (state.managers[club.managerId] ?? null) : null;
}

/** Fire a human manager. */
export function fireManager(state: GameState, m: Manager, reason: string) {
  const club = m.clubId != null ? state.clubs[m.clubId] : null;
  if (!club) return;
  m.history.push({ season: state.meta.season, clubId: club.id, note: `Demitido: ${reason}` });
  m.clubId = null;
  m.rep = clamp(m.rep - 6, 5, 100);
  m.offers = [];
  club.managerId = null;
  club.upForSelection = true;
  club.autoLineup = true;
  club.board.conf = 55;
  addNews(state, 'fired', `${m.name} foi demitido do ${club.name} (${reason}).`, [club.id]);
}

/**
 * Board firing checks for every league club. Absent human managers are never fired.
 * AI clubs "fire" their implicit coach and open a vacancy (offers to humans).
 */
export function boardChecks(state: GameState, rng: Rng, present: Set<string>) {
  const now = absDate(state.meta.season, state.meta.date);
  const vacancies: Club[] = [];
  for (const c of Object.values(state.clubs)) {
    if (!c.league) continue;
    if (c.board.conf >= 12) continue;
    const m = managerOf(state, c);
    if (m) {
      if (!present.has(m.id)) continue;
      if (now - m.since < 8) continue;
      fireManager(state, m, 'maus resultados');
      vacancies.push(c);
    } else if (rng.chance(0.5)) {
      c.board.conf = 55;
      vacancies.push(c);
      addNews(state, 'fired', `${c.name} demite o treinador.`, [c.id]);
    }
  }
  for (const v of vacancies) offerJob(state, rng, v);
  // unemployed humans keep receiving offers from smaller clubs
  for (const m of Object.values(state.managers)) {
    m.offers = m.offers.filter((o) => o.until > state.meta.date && state.clubs[o.clubId] && !state.clubs[o.clubId].managerId);
    if (m.clubId == null && present.has(m.id) && m.offers.length === 0 && rng.chance(0.4)) {
      const cands = Object.values(state.clubs).filter((c) => c.league && !c.managerId && c.rep <= m.rep + 8);
      if (cands.length) {
        const c = rng.weighted(cands, (x) => Math.pow(x.rep, 2));
        giveOffer(state, m, c);
      }
    }
  }
}

function giveOffer(state: GameState, m: Manager, c: Club) {
  if (m.offers.some((o) => o.clubId === c.id)) return;
  m.offers.push({ clubId: c.id, until: Math.min(state.calendar.length, state.meta.date + OFFER_DATES) });
  addNews(state, 'offer', `Proposta de emprego: o ${c.name} quer contratar você.`, [c.id], m.id);
}

/** A vacancy at club c: offer it to suitable human managers. */
export function offerJob(state: GameState, rng: Rng, c: Club) {
  for (const m of Object.values(state.managers)) {
    if (m.clubId === c.id) continue;
    if (m.clubId == null) {
      if (c.rep <= m.rep + 15) giveOffer(state, m, c);
    } else {
      const cur = state.clubs[m.clubId];
      if (c.rep >= cur.rep + 8 && m.rep >= c.rep - 12 && rng.chance(0.6)) giveOffer(state, m, c);
    }
  }
}

/** Human manager takes a job (accepting an offer, or claiming a club in the lobby). */
export function takeJob(state: GameState, m: Manager, clubId: number) {
  const club = state.clubs[clubId];
  if (m.clubId != null && m.clubId !== clubId) {
    const old = state.clubs[m.clubId];
    m.history.push({ season: state.meta.season, clubId: old.id, note: `Saiu para o ${club.name}` });
    old.managerId = null;
    old.upForSelection = true;
    old.autoLineup = true;
    addNews(state, 'hired', `${m.name} deixa o ${old.name} e assume o ${club.name}.`, [old.id, club.id]);
  } else {
    addNews(state, 'hired', `${m.name} é o novo treinador do ${club.name}.`, [club.id]);
  }
  m.clubId = clubId;
  m.since = absDate(state.meta.season, state.meta.date);
  m.offers = [];
  club.managerId = m.id;
  club.upForSelection = false;
  club.board.conf = 60;
}
