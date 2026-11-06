// Potential: 0-5 stars. Each star raises the força a player can reach, speeds up his growth while young,
// and slows his decline once he is past 30.
import type { Rng } from './rng';

/** Highest força reachable with each number of stars. */
export const STAR_CEILING = [58, 66, 74, 81, 88, 95];

/** Fewest stars whose ceiling covers this força (a player's stars are never below his current level). */
export function tierOf(str: number): number {
  for (let s = 0; s < STAR_CEILING.length; s++) if (STAR_CEILING[s] >= str - 0.5) return s;
  return STAR_CEILING.length - 1;
}

/** Stars for a player of this força and age: his level, plus upside the younger he is. */
export function starsFor(str: number, ageY: number, rng: Rng, academyBonus = 0): number {
  const base = tierOf(str);
  let bonus = 0;
  const r = rng.next() - academyBonus * 0.04;
  if (ageY <= 19) bonus = r < 0.25 ? 0 : r < 0.6 ? 1 : r < 0.88 ? 2 : 3;
  else if (ageY <= 22) bonus = r < 0.4 ? 0 : r < 0.8 ? 1 : 2;
  else if (ageY <= 25) bonus = r < 0.65 ? 0 : 1;
  return Math.min(5, base + bonus);
}

export function ceilingFor(stars: number): number {
  return STAR_CEILING[Math.max(0, Math.min(5, Math.round(stars)))];
}

/** Growth speed while young: ×0.6 with no stars up to ×1.6 with five. */
export const growthMult = (stars: number) => 0.6 + 0.2 * stars;

/** Decline speed once old: ×1.3 with no stars down to ×0.7 with five. */
export const declineMult = (stars: number) => 1.3 - 0.12 * stars;
