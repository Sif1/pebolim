import { resolveAuctions } from './transfers';
import { autoLineup, BENCH_SIZE, bestFormation, isAvailable, lineupRating, repairLineup } from './ai/lineup';
import { AI_COACH, aiPlan, naturalStyle, preferredFormations, strengthEdge } from './ai/tactics';
import { deciderFor } from './competitions';
import { applyTravel } from './economy';
import type { MatchSetup, MPlayerInit, TeamSetup } from './match/core';
import type { Rng } from './rng';
import type { Club, Fixture, GameState, Player, Tactics } from './types';
import { slotsFor } from './match/formations';
import { laneOf, laneStrengths } from './match/ratings';
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
 * and what the opponent usually does. Against a human it knows only how he lined up last time (Club.shown), never
 * the team sheet for this match: reading the AI's plan in the scouting report and answering it is the human's edge.
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
  const oppT = oppHuman && opp.shown ? opp.shown.tactics : { mentality: 'equilibrada' as const, style: oppNatural, marking: 'zona' as const };
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

/** Força gap from which an AI favourite rests starters in an early cup round or a state-championship match. */
export const ROTATE_GAP = 8;

/**
 * Rotation ("time misto"): an AI favourite in a national cup (before the semi-finals) or a state championship
 * (before its last two rounds), facing a side at least 8 força weaker, rests its 3 best outfield players (5 from
 * 14 weaker), as long as the squad has cover and the tie is not close. They start on the bench.
 */
export function cupRotation(state: GameState, f: Fixture, club: Club, squad: Player[], opp: Club): Player[] {
  const comp = state.comps[f.comp];
  if (!comp) return [];
  const cfg = comp.cfg;
  const cup = cfg.kind === 'cup' && cfg.scope === 'national';
  if (!cup && cfg.scope !== 'state') return [];
  if (f.stage != null && comp.stages.length && f.stage >= comp.stages.length - 2) return [];
  const gap = club.power - opp.power;
  if (gap < ROTATE_GAP) return [];
  // a second leg: only with a comfortable lead from the first
  const dec = f.leg === 2 ? deciderFor(state, f) : null;
  if (dec) {
    const lead = f.home === club.id ? dec.aggHome - dec.aggAway : dec.aggAway - dec.aggHome;
    if (lead < 2) return [];
  }
  const avail = squad.filter((p) => isAvailable(p, f.comp));
  const rest = avail
    .filter((p) => p.pos !== 'GOL')
    .sort((a, b) => b.str - a.str)
    .slice(0, gap >= 14 ? 5 : 3);
  return avail.length - rest.length >= 16 ? rest : [];
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
  // a human side: as it lined up last time (those still available), else as the AI would pick it
  const shown = oppHuman ? opp.shown : undefined;
  const oppShape = shown ? shown.tactics : { formation: bestFormation(oppAvail, comp) };
  const availIds = new Set(oppAvail.map((p) => p.id));
  const theirs = shown && shown.xi.filter((id) => id != null && availIds.has(id)).length >= 9 ? shown : autoLineup(oppAvail, oppShape, comp);
  const oppById = new Map(oppAvail.map((p) => [p.id, p]));
  const their = laneStrengths(slotsFor(oppShape), theirs.xi.map((id) => (id != null ? (oppById.get(id) ?? null) : null)));
  return focusFrom(my, their).focus;
}

/**
 * Which channel to attack, from both sides' lanes (each side's own view: 0 = its left): our left attacks their
 * right and the other way round. The flanks or the middle when one clearly beats the other (AI_FOCUS_EDGE).
 */
export function focusFrom(my: LaneStrengths, their: LaneStrengths): { focus: Tactics['focus']; flanks: number; middle: number } {
  const flanks = (my.att[0] / their.def[2] + my.att[2] / their.def[0]) / 2;
  const middle = my.att[1] / their.def[1];
  return { focus: flanks > middle * AI_FOCUS_EDGE ? 'lados' : middle > flanks * AI_FOCUS_EDGE ? 'meio' : undefined, flanks, middle };
}

type LaneStrengths = ReturnType<typeof laneStrengths>;

/**
 * The scout's read of the opponent's defence for a human manager: its weakest lane (their own view), the player
 * there, and the attack focus that would pay against it with your current line-up (the same judgement the AI
 * coach makes for itself).
 */
export function scoutLanes(
  state: GameState,
  f: Fixture,
  club: Club,
  squad: Player[],
  opp: Club,
  oppSquad: Player[],
  oppPlan: Pick<Tactics, 'formation' | 'shape'>,
): { focus: Tactics['focus']; weak: 0 | 1 | 2; player: Player | null } {
  const comp = f.comp;
  const avail = squad.filter((p) => p.injury === 0 && !(p.ban[comp] > 0));
  const lineup = club.autoLineup ? autoLineup(avail, club.tactics, comp) : repairLineup(squad, club.lineup, club.tactics, comp);
  const byId = new Map(avail.map((p) => [p.id, p]));
  const mySlots = slotsFor(club.tactics);
  const my = laneStrengths(mySlots, lineup.xi.map((id) => (id != null ? (byId.get(id) ?? null) : null)));
  const oppAvail = oppSquad.filter((p) => p.injury === 0 && !(p.ban[comp] > 0));
  const theirs = autoLineup(oppAvail, oppPlan, comp);
  const oppById = new Map(oppAvail.map((p) => [p.id, p]));
  const oppSlots = slotsFor(oppPlan);
  const xi = theirs.xi.map((id) => (id != null ? (oppById.get(id) ?? null) : null));
  const their = laneStrengths(oppSlots, xi);
  const weak = ([0, 1, 2] as const).reduce((a, b) => (their.def[b] < their.def[a] ? b : a));
  // the weakest defender in that lane
  let player: Player | null = null;
  oppSlots.forEach((sl, i) => {
    const p = xi[i];
    if (!p || sl.pos === 'GOL' || laneOf(sl.y) !== weak || !['ZAG', 'LAT', 'VOL'].includes(sl.pos)) return;
    if (!player || p.str < player.str) player = p;
  });
  return { focus: focusFrom(my, their).focus, weak, player };
}

function teamSetup(state: GameState, club: Club, squad: Player[], compId: string, human: boolean, aiTactics?: Tactics, rested: Player[] = []): TeamSetup {
  const tactics = !human && aiTactics ? aiTactics : club.tactics;
  let lineup =
    human && !club.autoLineup
      ? repairLineup(squad, club.lineup, club.tactics, compId)
      : autoLineup(rested.length ? squad.filter((p) => !rested.includes(p)) : squad, tactics, compId);
  // rested starters sit on the bench, ready if the match goes wrong
  if (rested.length) {
    const gk = lineup.bench.find((id) => squad.find((p) => p.id === id)?.pos === 'GOL');
    const bench = [...rested.map((p) => p.id), ...lineup.bench.filter((id) => id !== gk)].slice(0, BENCH_SIZE - (gk != null ? 1 : 0));
    lineup = { ...lineup, bench: gk != null ? [...bench, gk] : bench };
  }
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
      age: age(p, season),
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
    // an AI favourite may rest starters in an early cup round or a state championship
    const hRest = hHuman ? [] : cupRotation(state, f, home, hSquad, away);
    const aRest = aHuman ? [] : cupRotation(state, f, away, aSquad, home);
    const without = (sq: Player[], rest: Player[]) => (rest.length ? sq.filter((p) => !rest.includes(p)) : sq);
    const hT = hHuman || !AI_COACH.enabled ? undefined : aiPreMatchTactics(state, f, home, without(hSquad, hRest), away, aSquad, aHuman);
    const aT = aHuman || !AI_COACH.enabled ? undefined : aiPreMatchTactics(state, f, away, without(aSquad, aRest), home, hSquad, hHuman);
    const setup: MatchSetup = {
      fixtureId: f.id,
      compId: f.comp,
      home: teamSetup(state, home, hSquad, f.comp, hHuman, hT, hRest),
      away: teamSetup(state, away, aSquad, f.comp, aHuman, aT, aRest),
      seed: rng.fork(),
      homeAdv: HOME_ADV,
      decider: deciderFor(state, f),
      pitch: home.pitch,
    };
    plan.setups.push(setup);
    if (hHuman || aHuman) plan.live.push(f.id);
    // what the next opponents' coaches will know about the human sides
    for (const [club, ts, human] of [[home, setup.home, hHuman], [away, setup.away, aHuman]] as const) {
      if (human) club.shown = { tactics: { ...ts.tactics, shape: ts.tactics.shape ? [...ts.tactics.shape] : null }, xi: [...ts.xi] };
    }
  }
  return plan;
}
