// Coaches: every club without a human manager has a named AI coach (real ones from the database, made-up ones
// otherwise). AI coaches are sacked, sit out of work and get hired again. Everyone in charge of a club, human or
// AI, builds a coaching-ranking record: results weighted by the competition, titles and awards.
import type { Database } from './db';
import { randomName } from './generator';
import type { Rng } from './rng';
import type { Club, Coach, CompConfig, GameState, Manager, RankRecord } from './types';
import { addNews, clamp } from './util';

export const emptyRank = (): RankRecord => ({ p: 0, w: 0, d: 0, l: 0, titles: 0, awards: 0, pts: 0, spts: 0 });

/** The main continental cups (the others are the second competitions). */
const MAIN_CONTINENTAL = new Set(['LIB', 'UCL']);

/** How much a country's own competitions weigh: winning the Premier League says more than winning in Uruguay. */
const COUNTRY_WEIGHT: Record<string, number> = { ENG: 1, ESP: 1, ITA: 1, GER: 1, FRA: 0.95, BRA: 0.9, ARG: 0.8, URU: 0.6 };
const countryWeight = (cfg: CompConfig) => (cfg.scope === 'continental' ? 1 : (COUNTRY_WEIGHT[cfg.country ?? ''] ?? 0.7));

/**
 * What a win is worth in the ranking in this competition (a draw is worth 35% of it): the top leagues and the
 * continental cups count most, the state championships least, and a country's competitions by its level.
 */
export function matchWeight(cfg: CompConfig): number {
  const base =
    cfg.scope === 'continental'
      ? MAIN_CONTINENTAL.has(cfg.id)
        ? 1.5
        : 1.2
      : cfg.scope === 'state'
        ? 0.4
        : cfg.kind === 'league'
          ? cfg.level === 1
            ? 1
            : cfg.level === 2
              ? 0.6
              : 0.35
          : 0.8;
  return base * countryWeight(cfg);
}

/** Ranking points for winning this competition. */
export function titleWeight(cfg: CompConfig): number {
  const base =
    cfg.scope === 'continental'
      ? MAIN_CONTINENTAL.has(cfg.id)
        ? 30
        : 15
      : cfg.scope === 'state'
        ? 5
        : cfg.kind === 'league'
          ? cfg.level === 1
            ? 25
            : cfg.level === 2
              ? 8
              : 4
          : 15;
  return base * countryWeight(cfg);
}

/** Ranking points for the monthly and the season coaching awards. */
export const AWARD_PTS = { month: 2, season: 8 };

const round = (v: number) => Math.round(v * 100) / 100;

function addPts(r: RankRecord, v: number) {
  r.pts = round(r.pts + v);
  r.spts = round(r.spts + v);
}

/** The AI coach of a club, if it has one. */
export function aiCoachOf(state: GameState, club: Club): Coach | null {
  return club.coachId != null ? (state.coaches?.[club.coachId] ?? null) : null;
}

/** Who is in charge of a club: its human manager, else its AI coach. */
export function inCharge(state: GameState, club: Club): { name: string; human: Manager | null; coach: Coach | null } | null {
  if (club.managerId) {
    const m = state.managers[club.managerId];
    if (m) return { name: m.name, human: m, coach: null };
  }
  const c = aiCoachOf(state, club);
  return c ? { name: c.name, human: null, coach: c } : null;
}

/** The ranking record of whoever is in charge of a club. */
export function rankRecordOf(state: GameState, club: Club): RankRecord | null {
  const who = inCharge(state, club);
  if (!who) return null;
  if (who.human) return (who.human.rank ??= emptyRank());
  return who.coach!.rec;
}

/** A match for the ranking: both coaches' records. */
export function rankMatch(state: GameState, f: { comp: string; home: number; away: number; hg: number | null; ag: number | null }) {
  const cfg = state.comps[f.comp]?.cfg;
  if (!cfg || f.hg == null || f.ag == null) return;
  const w = matchWeight(cfg);
  for (const [cid, gf, ga] of [
    [f.home, f.hg, f.ag],
    [f.away, f.ag, f.hg],
  ] as const) {
    const club = state.clubs[cid];
    const r = club ? rankRecordOf(state, club) : null;
    if (!r) continue;
    r.p++;
    if (gf > ga) {
      r.w++;
      addPts(r, w);
    } else if (gf === ga) {
      r.d++;
      addPts(r, w * 0.35);
    } else r.l++;
  }
}

/** A title for the ranking (and the AI coach's reputation). */
export function rankTitle(state: GameState, cfg: CompConfig, clubId: number) {
  const club = state.clubs[clubId];
  if (!club) return;
  const r = rankRecordOf(state, club);
  if (!r) return;
  r.titles++;
  addPts(r, titleWeight(cfg));
  const c = club.managerId ? null : aiCoachOf(state, club);
  if (c) c.rep = clamp(c.rep + (cfg.scope === 'continental' ? 8 : cfg.scope === 'state' ? 1 : 4), 5, 100);
}

/** A coaching award (of the month, of the season) for whoever is in charge of the club. */
export function rankAward(state: GameState, club: Club, pts: number) {
  const r = rankRecordOf(state, club);
  if (!r) return;
  r.awards++;
  addPts(r, pts);
}

/** One row of the coaching ranking. */
export interface RankRow {
  name: string;
  nat: string | null;
  clubId: number | null;
  human: boolean;
  managerId: string | null;
  rec: RankRecord;
}

/** Everyone in the ranking (humans and AI coaches who have coached at least one match), best first. */
export function coachRanking(state: GameState, by: 'pts' | 'spts' = 'pts'): RankRow[] {
  const rows: RankRow[] = [];
  for (const m of Object.values(state.managers)) {
    const rec = m.rank ?? emptyRank();
    rows.push({ name: m.name, nat: null, clubId: m.clubId, human: true, managerId: m.id, rec });
  }
  for (const c of Object.values(state.coaches ?? {})) {
    if (!c.rec.p && c.clubId == null) continue;
    rows.push({ name: c.name, nat: c.nat, clubId: c.clubId, human: false, managerId: null, rec: c.rec });
  }
  return rows.sort((a, b) => b.rec[by] - a.rec[by] || b.rec.titles - a.rec.titles || b.rec.w - a.rec.w || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- hiring and sacking

function newCoach(state: GameState, rng: Rng, name: string, nat: string, rep: number, real: boolean): Coach {
  state.coaches ??= {};
  state.meta.next.coach ??= 1;
  const c: Coach = { id: state.meta.next.coach++, name, nat, clubId: null, rep: clamp(Math.round(rep), 5, 100), ...(real ? { real } : {}), rec: emptyRank() };
  state.coaches[c.id] = c;
  return c;
}

/** A made-up coach for a club: a local name, a reputation a little below the club's. */
function madeUpCoach(state: GameState, rng: Rng, club: Club): Coach {
  return newCoach(state, rng, randomName(state, club.country, rng), club.country, club.rep - 4 + rng.range(-6, 6), false);
}

function appoint(club: Club, c: Coach) {
  c.clubId = club.id;
  club.coachId = c.id;
}

/** Every club gets a coach at the start of a new game: the real one from the database, or a made-up one. */
export function setupCoaches(state: GameState, db: Database, rng: Rng, keyToId: Map<string, number>) {
  state.coaches = {};
  state.meta.next.coach = 1;
  for (const dc of db.clubs) {
    const club = state.clubs[keyToId.get(dc.key)!];
    if (!club) continue;
    const c = dc.coach ? newCoach(state, rng, dc.coach, dc.coachNat ?? dc.country, club.rep + rng.range(-3, 5), true) : madeUpCoach(state, rng, club);
    appoint(club, c);
  }
}

/** Saves from before named coaches: made-up coaches for every club that needs one. */
export function ensureCoaches(state: GameState, rng: Rng) {
  state.coaches ??= {};
  for (const club of Object.values(state.clubs)) {
    if (club.coachId != null && state.coaches[club.coachId]) continue;
    if (club.managerId) {
      club.coachId = null;
      continue;
    }
    appoint(club, madeUpCoach(state, rng, club));
  }
}

/**
 * A club without a coach hires one: an out-of-work coach of about its standing (from its own country more
 * often), or a new name.
 */
export function hireCoach(state: GameState, rng: Rng, club: Club, exclude: number | null = null): Coach {
  const free = Object.values(state.coaches ?? {}).filter((c) => c.clubId == null && c.id !== exclude && c.rep >= club.rep - 15 && c.rep <= club.rep + 12);
  const c = free.length
    ? rng.weighted(free, (x) => (x.nat === club.country ? 3 : 1) / (1 + Math.abs(x.rep - club.rep) / 5))
    : madeUpCoach(state, rng, club);
  appoint(club, c);
  return c;
}

/** A human takes over a club: its AI coach is out of work. */
export function releaseCoach(state: GameState, club: Club) {
  const c = aiCoachOf(state, club);
  if (c) c.clubId = null;
  club.coachId = null;
}

/** An AI club sacks its coach and hires another (the news names both). */
export function sackCoach(state: GameState, rng: Rng, club: Club) {
  const old = aiCoachOf(state, club);
  if (old) {
    old.clubId = null;
    old.rep = clamp(old.rep - 5, 5, 100);
  }
  club.coachId = null;
  const c = hireCoach(state, rng, club, old?.id ?? null);
  addNews(state, 'fired', old ? `${club.name} demite ${old.name}. ${c.name} é o novo técnico.` : `${c.name} é o novo técnico do ${club.name}.`, [club.id]);
}

/** A new season: the season's ranking points start again. */
export function resetSeasonRank(state: GameState) {
  for (const c of Object.values(state.coaches ?? {})) c.rec.spts = 0;
  for (const m of Object.values(state.managers)) if (m.rank) m.rank.spts = 0;
}
