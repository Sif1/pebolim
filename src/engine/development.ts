import { DATES_PER_SEASON, TC_DEV, TC_INJ, TC_REC } from './economy';
import { declineMult, growthMult } from './potential';
import type { Rng } from './rng';
import type { GameState } from './types';
import { age } from './util';

/**
 * Energy back per date (before training centre and focus). A starter loses about 9.5 per match once the "match
 * legs" are gone, so a club that plays every date has to rotate; one that plays every other date recovers fully.
 */
export const REST = { base: 8, playedFactor: 0.85 };

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

/** How much of the normal growth a young player keeps at this força: all of it up to 80, less and less above. */
export const ELITE_GROWTH = (str: number) => Math.min(1, Math.max(0.15, (93 - str) / 13));

/** Per-date player updates: recovery, injuries, development. */
export function dailyPlayers(state: GameState, rng: Rng, playedToday: Set<number>) {
  const season = state.meta.season;
  const date = Math.max(1, state.meta.date);
  for (const id in state.players) {
    const p = state.players[id];
    const club = p.clubId != null ? state.clubs[p.clubId] : null;
    const lvl = club?.tc.level ?? 1;
    const focus = club?.focus ?? 'equilibrado';
    // recovery
    let rec = REST.base * TC_REC[lvl] * (focus === 'fisico' ? 1.2 : focus === 'tecnico' ? 0.9 : 1);
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
    const a = age(p, season);
    let d = yearlyDelta(a);
    if (d > 0) {
      // growth: training centre, focus, playing time and potential stars (faster, and up to a higher ceiling)
      // youth-team players play youth matches every week
      const play = p.junior ? 0.6 : Math.min(1, p.s.apps / (date * 0.45 + 1));
      d *= TC_DEV[lvl] * (focus === 'tecnico' ? 1.15 : focus === 'fisico' ? 0.9 : 1) * (0.55 + 0.6 * play) * growthMult(p.stars ?? 2);
      // the last few points before the ceiling come slowly, and so does world class, for everyone: from 80 up
      // each point is harder (×0.6 at 85, ×0.25 at 89), so even the best prospects peak in their mid-twenties
      d *= Math.min(1, Math.max(0.1, (p.pot - p.str) / 6));
      d *= ELITE_GROWTH(p.str);
    } else if (d < 0) {
      // decline after 30: more stars, slower decline
      d *= declineMult(p.stars ?? 2);
    }
    p.str = Math.max(25, Math.min(97, p.str + d / DATES_PER_SEASON + rng.range(-0.04, 0.04)));
  }
}
