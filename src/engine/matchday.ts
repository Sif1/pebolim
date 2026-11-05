import { autoLineup, repairLineup } from './ai/lineup';
import { deciderFor } from './competitions';
import { applyTravel } from './economy';
import type { MatchSetup, MPlayerInit, TeamSetup } from './match/core';
import type { Rng } from './rng';
import type { Club, Fixture, GameState, Player } from './types';
import { age, squadIndex } from './util';

export const HOME_ADV = 1.07;

export function fixturesOnDate(state: GameState, date: number): Fixture[] {
  return Object.values(state.fixtures).filter((f) => f.date === date && f.hg == null);
}

/** A club is controlled by a present human manager. */
export function isHumanClub(state: GameState, clubId: number, present: Set<string>): boolean {
  const c = state.clubs[clubId];
  return !!c.managerId && present.has(c.managerId);
}

function teamSetup(state: GameState, club: Club, squad: Player[], compId: string, human: boolean): TeamSetup {
  const lineup =
    human && !club.autoLineup
      ? repairLineup(squad, club.lineup, club.tactics.formation, compId)
      : autoLineup(squad, club.tactics.formation, compId);
  if (human) club.lineup = lineup;
  const ids = new Set([...lineup.xi.filter((x): x is number => x != null), ...lineup.bench]);
  const season = state.meta.season;
  const players: MPlayerInit[] = squad
    .filter((p) => ids.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      num: p.num,
      pos: p.pos,
      str: p.str,
      fitness: p.fitness,
      morale: p.morale,
      traits: p.traits,
      tire: age(p, season) >= 32 ? 1.15 : age(p, season) <= 21 ? 0.95 : 1,
    }));
  return {
    clubId: club.id,
    name: club.name,
    short: club.short,
    colors: club.colors,
    tactics: { ...club.tactics },
    xi: lineup.xi,
    bench: lineup.bench,
    players,
    ai: !human,
  };
}

export interface MatchdayPlan {
  date: number;
  setups: MatchSetup[];
  /** fixtures with at least one present human club: played live */
  live: number[];
  travel: Record<number, { km: number; mode: string; cost: number; loss: number }>;
}

/**
 * Prepare every fixture of the current date: apply travel, pick lineups, build engine setups.
 * Mutates state (travel costs, fatigue, human lineups repaired), so run it on the host inside a producer.
 */
export function prepareMatchday(state: GameState, rng: Rng, present: Set<string>): MatchdayPlan {
  const date = state.meta.date;
  const fixtures = fixturesOnDate(state, date);
  const idx = squadIndex(state);
  const plan: MatchdayPlan = { date, setups: [], live: [], travel: {} };
  for (const f of fixtures) {
    const awaySquad = idx.get(f.away) ?? [];
    plan.travel[f.id] = applyTravel(state, f, awaySquad.map((p) => p.id));
  }
  for (const f of fixtures) {
    const home = state.clubs[f.home];
    const away = state.clubs[f.away];
    const hHuman = isHumanClub(state, home.id, present);
    const aHuman = isHumanClub(state, away.id, present);
    const setup: MatchSetup = {
      fixtureId: f.id,
      compId: f.comp,
      home: teamSetup(state, home, idx.get(home.id) ?? [], f.comp, hHuman),
      away: teamSetup(state, away, idx.get(away.id) ?? [], f.comp, aHuman),
      seed: rng.fork(),
      homeAdv: HOME_ADV,
      decider: deciderFor(state, f),
    };
    plan.setups.push(setup);
    if (hHuman || aHuman) plan.live.push(f.id);
  }
  return plan;
}
