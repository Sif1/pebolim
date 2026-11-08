// Potential: 0-5 stars. Each star raises the força a player can reach, speeds up his growth while young,
// and slows his decline once he is past 30.
import type { Rng } from './rng';

/** Highest força reachable with each number of stars (five stars: the very best in the world, about 91). */
export const STAR_CEILING = [58, 66, 73, 79, 85, 91];

/** Fewest stars whose ceiling covers this força (a player's stars are never below his current level). */
export function tierOf(str: number): number {
  for (let s = 0; s < STAR_CEILING.length; s++) if (STAR_CEILING[s] >= str - 0.5) return s;
  return STAR_CEILING.length - 1;
}

/** Stars for a player of this força and age: his level, plus upside the younger he is. */
export function starsFor(str: number, ageY: number, rng: Rng, academyBonus = 0): number {
  const base = tierOf(str);
  let bonus = 0;
  const r = rng.next();
  // a better academy (training centre) turns up fewer prospects with no upside; the rare three-star jump, a
  // future world-class player, stays rare everywhere
  const a = academyBonus * 0.03;
  if (ageY <= 19) bonus = r < 0.3 - a ? 0 : r < 0.72 - a ? 1 : r < 0.97 ? 2 : 3;
  else if (ageY <= 22) bonus = r < 0.4 ? 0 : r < 0.8 ? 1 : 2;
  else if (ageY <= 25) bonus = r < 0.65 ? 0 : 1;
  return Math.min(5, base + bonus);
}

export function ceilingFor(stars: number): number {
  return STAR_CEILING[Math.max(0, Math.min(5, Math.round(stars)))];
}

/** Growth speed while young: ×0.7 with no stars up to ×1.45 with five. */
export const growthMult = (stars: number) => 0.7 + 0.15 * stars;

/** Decline speed once old: ×1.3 with no stars down to ×0.7 with five. */
export const declineMult = (stars: number) => 1.3 - 0.12 * stars;

// ---------------------------------------------------------------- the scout's estimate

/** From this age a player's potential shows to everyone; before it, it is a scout's estimate. */
export const POT_CLEAR_AGE = 24;

/** A young player's hidden scouting bias: half of them look a star better or worse than they are. */
export function potErrFor(ageY: number, rng: Rng): number {
  if (ageY > 21) return 0;
  const r = rng.next();
  return r < 0.25 ? -1 : r < 0.5 ? 1 : 0;
}

/** What a club knows about a young player's potential, gained per round he spends there (faster with a better training centre). */
export function scoutRound(p: { clubId: number | null; birth: number; scouted?: number; scoutClub?: number }, season: number, tcLevel: number) {
  if (p.clubId == null || season - p.birth >= POT_CLEAR_AGE) return;
  if (p.scoutClub !== p.clubId) {
    p.scoutClub = p.clubId;
    p.scouted = 0;
  }
  if ((p.scouted ?? 0) < 100) p.scouted = Math.min(100, Math.round(((p.scouted ?? 0) + 0.8 + 0.25 * tcLevel) * 10) / 10);
}

/**
 * The potential a club sees: exact for players of 24 or more and for its own young players once it knows them
 * (knowledge 100), otherwise the scout's estimate, which can be a star off either way.
 */
export function potentialSeen(
  p: { stars: number; birth: number; clubId: number | null; potErr?: number; scouted?: number; scoutClub?: number },
  viewerClub: number | null,
  season: number,
): { stars: number; exact: boolean; known: number } {
  if (season - p.birth >= POT_CLEAR_AGE) return { stars: p.stars, exact: true, known: 100 };
  const known = p.clubId != null && p.clubId === viewerClub && p.scoutClub === p.clubId ? (p.scouted ?? 0) : 0;
  if (known >= 100) return { stars: p.stars, exact: true, known };
  return { stars: Math.max(0, Math.min(5, p.stars + (p.potErr ?? 0))), exact: false, known };
}
