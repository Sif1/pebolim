import { resolveAuctions } from './transfers';
import { autoLineup, bestFormation, lineupRating, repairLineup } from './ai/lineup';
import { AI_COACH, aiPlan, naturalStyle, preferredFormations, strengthEdge } from './ai/tactics';
import { deciderFor } from './competitions';
import { applyTravel } from './economy';
import type { MatchSetup, MPlayerInit, TeamSetup } from './match/core';
import type { Rng } from './rng';
import type { Club, Fixture, GameState, Player, Tactics } from './types';
import { slotsFor } from './match/formations';
import { laneStrengths } from './match/ratings';
import { age, squadIndex } from './util';

export const HOME_ADV = 1.055;

export function fixturesOnDate(state: GameState, date: number): Fixture[] {
  return Object.values(state.fixtures).filter((f) => f.date === date && f.hg == null);
}

/** A club is controlled by a present human manager. */
export function isHumanClub(state: GameState, clubId: number, present: Set<string>): boolean {
  const c = state.clubs[clubId];
  return !!c.managerId && present.has(c.managerId);
}

/** Squad strength for this match: the club's rating scaled by how fresh its best players are. */
function matchPower(state: GameState, club: Club, squad: Player[]): number {
  const top = squad.filter((p) => p.injury === 0).sort((a, b) => b.str - a.str).slice(0, 14);
  const fit = top.length ? top.reduce((a, p) => a + p.fitness, 0) / top.length : 90;
  return club.power * (0.7 + 0.3 * (fit / 100));
}

/**
 * The AI coach's plan for a match: favourite or underdog, home or away, a knockout aggregate to chase or protect,
 * and what the opponent usually does.
 */
export function aiPreMatchTactics(
  state: GameState,
  f: Fixture,
  club: Club,
  squad: Player[],
  opp: Club,
  oppSquad: Player[],
  oppHuman: boolean,
): Tactics {
  const home = f.home === club.id;
  const dec = deciderFor(state, f);
  const diff = dec ? (home ? dec.aggHome - dec.aggAway : dec.aggAway - dec.aggHome) : 0;
  const avail = squad.filter((p) => p.injury === 0 && !(p.ban[f.comp] > 0));
  const top = [...avail].sort((a, b) => b.str - a.str).slice(0, 11);
  const energy = top.length ? top.reduce((a, p) => a + p.fitness, 0) / top.length : 90;
  const natural = naturalStyle(top);
  const oppNatural = naturalStyle([...oppSquad].sort((a, b) => b.str - a.str).slice(0, 11));
  const oppT = oppHuman ? opp.tactics : { mentality: 'equilibrada' as const, style: oppNatural, marking: 'zona' as const };
  const plan = aiPlan({
    minute: 0,
    diff,
    men: 0,
    edge: strengthEdge(matchPower(state, club, squad), matchPower(state, opp, oppSquad), home),
    home,
    decider: !!dec,
    energy,
    opp: oppT,
    natural,
  });
  // best formation for the squad, nudged toward the plan when it costs little
  let formation = bestFormation(avail, f.comp);
  const base = { formation, mentality: plan.mentality, marking: plan.marking, style: plan.style } as Tactics;
  const rate = (fm: Tactics['formation']) => lineupRating(avail, autoLineup(avail, fm, f.comp), fm, { ...base, formation: fm });
  const bestR = rate(formation);
  for (const fm of preferredFormations(plan, 0)) {
    if (fm !== formation && rate(fm) >= bestR - 0.8) {
      formation = fm;
      break;
    }
  }
  const focus = aiFocus(state, avail, formation, f.comp, opp, oppSquad, oppHuman);
  return { formation, mentality: plan.mentality, style: plan.style, marking: plan.marking, shape: null, ...(focus ? { focus } : {}) };
}

/** How much better one channel must look than the other before the AI coach concentrates its attacks there. */
export const AI_FOCUS_EDGE = 1.08;

/**
 * The AI coach's attack focus: its own lanes against the opponent's likely line-up. The flanks when its wide
 * attack beats their full-backs clearly more than its middle beats their centre, the middle the other way round,
 * otherwise no focus (a focus is also easier to read, so it needs a real edge).
 */
export function aiFocus(state: GameState, avail: Player[], formation: Tactics['formation'], comp: string, opp: Club, oppSquad: Player[], oppHuman: boolean): Tactics['focus'] {
  const mine = autoLineup(avail, formation, comp);
  const slots = slotsFor({ formation });
  const byId = new Map(avail.map((p) => [p.id, p]));
  const my = laneStrengths(slots, mine.xi.map((id) => (id != null ? (byId.get(id) ?? null) : null)));
  const oppAvail = oppSquad.filter((p) => p.injury === 0 && !(p.ban[comp] > 0));
  const oppForm = oppHuman ? opp.tactics.formation : bestFormation(oppAvail, comp);
  const theirs = oppHuman && !opp.autoLineup ? opp.lineup : autoLineup(oppAvail, oppForm, comp);
  const oppById = new Map(oppSquad.map((p) => [p.id, p]));
  const their = laneStrengths(slotsFor(oppHuman ? opp.tactics : { formation: oppForm }), theirs.xi.map((id) => (id != null ? (oppById.get(id) ?? null) : null)));
  // our left attacks their right, and the other way round
  const flanks = (my.att[0] / their.def[2] + my.att[2] / their.def[0]) / 2;
  const middle = my.att[1] / their.def[1];
  if (flanks > middle * AI_FOCUS_EDGE) return 'lados';
  if (middle > flanks * AI_FOCUS_EDGE) return 'meio';
  return undefined;
}

function teamSetup(state: GameState, club: Club, squad: Player[], compId: string, human: boolean, aiTactics?: Tactics): TeamSetup {
  const tactics = !human && aiTactics ? aiTactics : club.tactics;
  const lineup =
    human && !club.autoLineup
      ? repairLineup(squad, club.lineup, club.tactics, compId)
      : autoLineup(squad, tactics, compId);
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
      flank: p.flank,
      tire: age(p, season) >= 32 ? 1.15 : age(p, season) <= 21 ? 0.95 : 1,
    }));
  return {
    clubId: club.id,
    name: club.name,
    short: club.short,
    colors: club.colors,
    tactics: { ...tactics, shape: tactics.shape ? [...tactics.shape] : null },
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
  // auctions opened before this match day close now
  resolveAuctions(state, rng);
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
    const hSquad = idx.get(home.id) ?? [];
    const aSquad = idx.get(away.id) ?? [];
    const hT = hHuman || !AI_COACH.enabled ? undefined : aiPreMatchTactics(state, f, home, hSquad, away, aSquad, aHuman);
    const aT = aHuman || !AI_COACH.enabled ? undefined : aiPreMatchTactics(state, f, away, aSquad, home, hSquad, hHuman);
    const setup: MatchSetup = {
      fixtureId: f.id,
      compId: f.comp,
      home: teamSetup(state, home, hSquad, f.comp, hHuman, hT),
      away: teamSetup(state, away, aSquad, f.comp, aHuman, aT),
      seed: rng.fork(),
      homeAdv: HOME_ADV,
      decider: deciderFor(state, f),
      pitch: home.pitch,
    };
    plan.setups.push(setup);
    if (hHuman || aHuman) plan.live.push(f.id);
  }
  return plan;
}
