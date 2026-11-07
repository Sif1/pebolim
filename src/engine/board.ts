import type { Rng } from './rng';
import type { Club, Fixture, GameState, Manager, Ultimatum } from './types';
import { absDate, addNews, clamp, sortTable } from './util';
import { roughIncome } from './economy';
import { isDerby } from './rivals';

const OFFER_DATES = 5;
/** rounds a new manager is safe from the sack */
const GRACE_DATES = 20;

/** Board confidence after a match. */
export function boardAfterMatch(state: GameState, f: Fixture) {
  const comp = state.comps[f.comp];
  if (!comp || f.hg == null || f.ag == null) return;
  // a derby counts for more, with the board and even more with the fans
  const derby = isDerby(state, f.home, f.away);
  const weight = (comp.cfg.kind === 'league' ? 1 : comp.cfg.scope === 'state' ? 0.4 : 0.7) * (derby ? 1.5 : 1);
  for (const side of [0, 1] as const) {
    const club = state.clubs[side === 0 ? f.home : f.away];
    const opp = state.clubs[side === 0 ? f.away : f.home];
    const gf = side === 0 ? f.hg : f.ag;
    const ga = side === 0 ? f.ag : f.hg;
    const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
    const expected = expectedPoints(club, opp, side === 0);
    club.board.conf = clamp(club.board.conf + (pts - expected) * 2.4 * weight, 0, 100);
    const ult = club.board.ult;
    if (ult && ult.played < ult.games) {
      ult.played++;
      ult.pts += pts;
    }
    fansAfterMatch(state, club, opp, pts, gf - ga, side === 0, derby);
  }
}

/** The points the board expects from a match, by the strength of the two sides and who is at home. */
function expectedPoints(club: Club, opp: Club, home: boolean): number {
  return clamp(1.35 + (club.power - opp.power + (home ? 3 : -3)) / 9, 0.35, 2.5);
}

/** The fans' mood after a match: results above all, more so at home, against bigger clubs, and in a derby. */
function fansAfterMatch(state: GameState, club: Club, opp: Club, pts: number, gd: number, home: boolean, derby = false) {
  const before = club.fans ?? 60;
  let d = pts === 3 ? 2.5 + (opp.power > club.power + 2 ? 1.5 : 0) : pts === 1 ? 0 : -2.5 - (home ? 1 : 0);
  if (gd <= -3) d -= 2;
  if (gd >= 3) d += 1;
  if (derby) d = d * 2 + (pts === 3 ? 2 : pts === 0 ? -2 : 0);
  const fans = clamp(before + d, 0, 100);
  club.fans = fans;
  if (!club.managerId) return;
  if (before >= 30 && fans < 30) addNews(state, 'board', `Protesto da torcida do ${club.name}: os torcedores cobram o time e o treinador.`, [club.id], club.managerId);
  else if (before <= 80 && fans > 80) addNews(state, 'board', `A torcida do ${club.name} está em festa: estádio cheio e confiança lá em cima.`, [club.id], club.managerId);
}

/** Fans' mood in words. */
export function fansLabel(v: number): string {
  return v >= 80 ? 'Em festa' : v >= 62 ? 'Animada' : v >= 45 ? 'Tranquila' : v >= 30 ? 'Impaciente' : 'Revoltada';
}

export function boardFinanceCheck(club: Club) {
  // in the red by more than ~3 months of income: the board loses patience a little every date
  if (club.balance < -0.25 * roughIncome(club)) club.board.conf = clamp(club.board.conf - 0.8, 0, 100);
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
  club.board.warned = 0;
  delete club.board.ult;
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
    // moods settle back slowly when nothing happens
    c.board.conf = clamp(c.board.conf + (55 - c.board.conf) * 0.01, 0, 100);
    c.fans = clamp((c.fans ?? 60) + (58 - (c.fans ?? 60)) * 0.015, 0, 100);
    // the fans' mood rubs off on the board
    c.board.conf = clamp(c.board.conf + ((c.fans ?? 60) - 55) * 0.004, 0, 100);
    const m = managerOf(state, c);
    if (m && present.has(m.id)) {
      if (c.board.ult && ultimatumOver(c.board.ult)) {
        if (settleUltimatum(state, c, m)) {
          vacancies.push(c);
          continue;
        }
      } else boardWarnings(state, c, m, now - m.since < GRACE_DATES);
      if (BOARD_MEETINGS.includes(state.meta.date)) boardMeeting(state, c, m);
    }
    if (c.board.conf >= 12) continue;
    if (m) {
      // a human manager is never sacked mid-season without the chance of an ultimatum first
      if (!present.has(m.id) || c.board.ult) continue;
      if (now - m.since < GRACE_DATES) continue;
      fireManager(state, m, 'maus resultados');
      vacancies.push(c);
    } else if (rng.chance(0.5)) {
      c.board.conf = 55;
      vacancies.push(c);
      addNews(state, 'fired', `${c.name} demite o treinador.`, [c.id]);
    }
  }
  for (const v of vacancies) offerJob(state, rng, v);
  // unemployed humans keep receiving offers: clubs around their reputation, at worst from a bottom division
  for (const m of Object.values(state.managers)) {
    m.offers = m.offers.filter((o) => o.until > state.meta.date && state.clubs[o.clubId] && !state.clubs[o.clubId].managerId);
    if (m.clubId == null && present.has(m.id) && m.offers.length === 0 && rng.chance(0.5)) {
      const free = Object.values(state.clubs).filter((c) => c.league && !c.managerId);
      const near = free.filter((c) => c.rep <= m.rep + 8);
      const cands = near.length >= 3 ? near : [...free].sort((a, b) => a.rep - b.rep).slice(0, 12);
      if (cands.length) {
        // mostly from the country he last worked in
        const last = [...m.history].reverse().find((h) => state.clubs[h.clubId])?.clubId;
        const home = last != null ? state.clubs[last].country : null;
        const c = rng.weighted(cands, (x) => Math.pow(x.rep, 2) * (x.country === home ? 5 : 1));
        giveOffer(state, m, c);
      }
    }
  }
}

/** Rounds at which the board meets the manager (about a third and two thirds into the season). */
const BOARD_MEETINGS = [30, 55];

const GOAL_TEXT: Record<string, string> = {
  titulo: 'brigar pelo título',
  continental: 'uma vaga nas copas continentais',
  meio: 'uma temporada tranquila no meio da tabela',
  rebaixamento: 'escapar do rebaixamento',
  acesso: 'conseguir o acesso',
};

/** Highest league position that meets the season's objective. */
export function goalPosition(goal: string, n: number): number {
  if (goal === 'titulo') return 1;
  if (goal === 'continental') return Math.round(n * 0.3);
  if (goal === 'acesso') return 4;
  return n - 4;
}

/** Mid-season board meeting: the objective, where the club stands, and the board's mood. */
function boardMeeting(state: GameState, c: Club, m: Manager) {
  const comp = c.league ? state.comps[c.league] : null;
  if (!comp || (comp.table[c.id]?.p ?? 0) < 4) return;
  const order = sortTable(comp.table, state.clubs);
  const pos = order.indexOf(c.id) + 1;
  const target = goalPosition(c.board.goal, order.length);
  const verdict =
    pos <= target
      ? 'a diretoria está satisfeita e pede para manter o ritmo'
      : pos <= target + 3
        ? 'ainda dá, mas a diretoria quer ver o time subir na tabela'
        : 'a diretoria está insatisfeita e cobra resultados já';
  c.board.conf = clamp(c.board.conf + (pos <= target ? 4 : pos <= target + 3 ? 0 : -3), 0, 100);
  addNews(
    state,
    'board',
    `Reunião da diretoria: o objetivo é ${GOAL_TEXT[c.board.goal] ?? c.board.goal}. O ${c.name} está em ${pos}º no ${comp.cfg.short}: ${verdict}. Torcida: ${fansLabel(c.fans ?? 60).toLowerCase()}.`,
    [c.id],
    m.id,
  );
}

/**
 * Written warnings before a sacking: below 30 the board is worried; below 18 (once the new manager's grace period
 * is over) it is the last warning, an ultimatum with a points target for the next few matches.
 */
function boardWarnings(state: GameState, c: Club, m: Manager, grace: boolean) {
  if (c.board.ult) return;
  if (c.board.conf >= 40) c.board.warned = 0;
  const warned = c.board.warned ?? 0;
  if (c.board.conf < 18 && !grace && warned < 2) {
    c.board.warned = 2;
    const ult = ultimatumFor(state, c);
    if (ult) {
      c.board.ult = ult;
      addNews(
        state,
        'board',
        `Último aviso da diretoria do ${c.name}: faça pelo menos ${ult.need} pontos nos próximos ${ult.games} jogos, ou você será demitido.`,
        [c.id],
        m.id,
      );
    } else addNews(state, 'board', `Último aviso da diretoria do ${c.name}: sem reação imediata, você será demitido.`, [c.id], m.id);
  } else if (c.board.conf < 30 && warned < 1) {
    c.board.warned = 1;
    addNews(state, 'board', `A diretoria do ${c.name} está preocupada com os resultados e espera uma reação.`, [c.id], m.id);
  }
}

/** Matches in an ultimatum, and the least that can be asked for. */
const ULT_GAMES = 5;
const ULT_MIN_GAMES = 3;

/**
 * The ultimatum for a club: its next (up to 5) scheduled matches, and a fair points target, 85% of the points
 * the board would expect from those opponents (at least 60% of the games, at most 2 points a game).
 * None when the season has fewer than 3 known matches left: the end-of-season verdict decides then.
 */
export function ultimatumFor(state: GameState, c: Club): Ultimatum | null {
  const next = Object.values(state.fixtures)
    .filter((f) => (f.home === c.id || f.away === c.id) && f.hg == null && f.date >= state.meta.date)
    .sort((a, b) => a.date - b.date)
    .slice(0, ULT_GAMES);
  if (next.length < ULT_MIN_GAMES) return null;
  const games = next.length;
  const exp = next.reduce((s, f) => s + expectedPoints(c, state.clubs[f.home === c.id ? f.away : f.home], f.home === c.id), 0);
  const need = clamp(Math.round(exp * 0.85), Math.ceil(games * 0.6), games * 2);
  return { need, games, played: 0, pts: 0 };
}

/** Decided: the target is reached, or can no longer be (or all the matches are played). */
export function ultimatumOver(u: Ultimatum): boolean {
  return u.pts >= u.need || u.pts + (u.games - u.played) * 3 < u.need || u.played >= u.games;
}

/** Settle a finished ultimatum: the manager keeps the job and the board's trust, or is sacked (returns true). */
function settleUltimatum(state: GameState, c: Club, m: Manager): boolean {
  const u = c.board.ult!;
  delete c.board.ult;
  if (u.pts >= u.need) {
    c.board.conf = Math.max(c.board.conf, 32);
    c.board.warned = 1;
    addNews(state, 'board', `Ultimato cumprido: ${u.pts} pontos em ${u.played} jogos. A diretoria do ${c.name} renova a confiança em você.`, [c.id], m.id);
    return false;
  }
  fireManager(state, m, `ultimato não cumprido, ${u.pts} de ${u.need} pontos`);
  return true;
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
    old.board.warned = 0;
    delete old.board.ult;
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
  club.board.warned = 0;
  delete club.board.ult;
}
