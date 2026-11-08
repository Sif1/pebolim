import { DATES_PER_SEASON, TC_DEV, TC_INJ, TC_REC } from './economy';
import { declineMult, growthMult, scoutRound } from './potential';
import type { Rng } from './rng';
import type { Club, GameState, Player } from './types';
import { age } from './util';

/**
 * Energy back per day of rest until the next date (before training centre and focus; a little less the day after
 * playing). Dates alternate Sunday and Wednesday: Wednesday's match comes three days after Sunday's (6 back),
 * Sunday's four days after Wednesday's (8 back). A starter loses about 9.5 per match once the "match legs" are
 * gone, so a club that plays both ends of the week has to rotate; one that plays once a week recovers fully.
 */
export const REST = { perDay: 2, playedFactor: 0.85 };

/** Days between two dates of the current season's calendar. */
export function daysBetween(state: GameState, a: number, b: number): number {
  const t = (i: number) => {
    const c = state.calendar[Math.max(0, Math.min(state.calendar.length - 1, i))];
    return Date.UTC(state.meta.season, c.month - 1, c.day);
  };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Days of rest after a date: until the next date (a week after the season's last). */
export function restDays(state: GameState, date: number): number {
  return date + 1 < state.calendar.length ? daysBetween(state, date, date + 1) : 7;
}

/** Yearly strength change by age (before training-centre and playing-time factors). */
function yearlyDelta(a: number): number {
  if (a <= 20) return 4;
  if (a <= 23) return 2.2;
  if (a <= 27) return 0.5;
  if (a <= 30) return 0;
  if (a <= 32) return -1.5;
  if (a <= 34) return -3;
  return -5;
}

/** Years longer a player's career lasts before retirement: three for a keeper, one for a great player (força 80+). */
export function careerBonus(p: { pos: string; str: number }): number {
  return (p.pos === 'GOL' ? 3 : 0) + (p.str >= 80 ? 1 : 0);
}

/**
 * A player well above his club's level grows more slowly there (the training, the team-mates and the games are
 * not at his level): full growth up to 4 points above the club's best-XI strength, then less, down to 35% at 12
 * above. A promising player at a small club wants to move up, and the club has a reason to sell.
 */
export function clubGrowthFactor(p: Pick<Player, 'str' | 'junior'>, club: Pick<Club, 'power'>): number {
  if (p.junior) return 1;
  const over = p.str - club.power - 4;
  return over <= 0 ? 1 : Math.max(0.35, 1 - over / 12);
}

/** How much of the normal growth a young player keeps at this força: all of it up to 80, less and less above. */
export const ELITE_GROWTH = (str: number) => Math.min(1, Math.max(0.15, (93 - str) / 13));

/** Per-date player updates: recovery, injuries, development. */
export function dailyPlayers(state: GameState, rng: Rng, playedToday: Set<number>) {
  const season = state.meta.season;
  const date = Math.max(1, state.meta.date);
  const rest = restDays(state, state.meta.date);
  for (const id in state.players) {
    const p = state.players[id];
    const club = p.clubId != null ? state.clubs[p.clubId] : null;
    const lvl = club?.tc.level ?? 1;
    const focus = club?.focus ?? 'equilibrado';
    // recovery
    let rec = REST.perDay * rest * TC_REC[lvl] * (focus === 'fisico' ? 1.2 : focus === 'tecnico' ? 0.9 : 1);
    if (playedToday.has(p.id)) rec *= REST.playedFactor;
    if (p.injury > 0) {
      p.injury--;
      if (p.injury > 0 && rng.chance(TC_INJ[lvl])) p.injury--;
      p.fitness = Math.min(80, p.fitness + rec * 0.5);
    } else {
      p.fitness = Math.min(100, p.fitness + rec);
    }
    // morale drifts back toward 60
    p.morale += (60 - p.morale) * 0.03;
    // development
    if (!club) continue;
    scoutRound(p, season, lvl);
    const a = age(p, season);
    // keepers peak later: their decline starts two years after everyone else's
    let d = yearlyDelta(p.pos === 'GOL' && a >= 30 ? a - 2 : a);
    if (d > 0) {
      // growth: training centre, focus, playing time and potential stars (faster, and up to a higher ceiling)
      // youth-team players play youth matches every week
      const play = p.junior ? 0.6 : Math.min(1, p.s.apps / (date * 0.45 + 1));
      d *= TC_DEV[lvl] * (focus === 'tecnico' ? 1.15 : focus === 'fisico' ? 0.9 : 1) * (0.55 + 0.6 * play) * growthMult(p.stars ?? 2);
      // the last few points before the ceiling come slowly, and so does world class, for everyone: from 80 up
      // each point is harder (×0.6 at 85, ×0.25 at 89), so even the best prospects peak in their mid-twenties
      d *= Math.min(1, Math.max(0.1, (p.pot - p.str) / 6));
      d *= ELITE_GROWTH(p.str);
      d *= clubGrowthFactor(p, club);
    } else if (d < 0) {
      // decline after 30: more stars, slower decline
      d *= declineMult(p.stars ?? 2);
    }
    p.str = Math.max(25, Math.min(97, p.str + d / DATES_PER_SEASON + rng.range(-0.04, 0.04)));
  }
}
