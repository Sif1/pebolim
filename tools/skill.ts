// How much does management skill matter? Plays real squads of similar strength against the AI coach with
// different kinds of manager in charge of one side, and reports points per game for each.
//   npx tsx tools/skill.ts [matches]
// Wanted: poor < passive < AI coach < good, with clear gaps.
import { readFileSync } from 'node:fs';
import { autoLineup, bestFormation, isAvailable } from '../src/engine/ai/lineup';
import { AI_COACH, aiPlan } from '../src/engine/ai/tactics';
import { matchRating, MAX_SUBS, MatchSim, talkFit, type MatchSetup, type TeamSetup } from '../src/engine/match/core';
import { FORMATIONS, slotsFor } from '../src/engine/match/formations';
import { effective } from '../src/engine/match/ratings';
import { aiPreMatchTactics, HOME_ADV } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import type { Club, Fixture, GameState, Lineup, Player, Tactics } from '../src/engine/types';
import { age, squadOf } from '../src/engine/util';
import { createWorld } from '../src/engine/world';

const N = Number(process.argv[2] ?? 2000);
let TALKS = true;
// experiments: npx tsx tools/skill.ts 2000 '{"drain":0.2}'
import { STYLE_TUNE } from '../src/engine/match/core';
import { FATIGUE } from '../src/engine/match/ratings';
{
  const cfg = JSON.parse(process.argv[3] ?? '{}');
  if (cfg.steep != null) FATIGUE.steep = cfg.steep;
  delete cfg.steep;
  // "talks": false = the good manager gives no half-time team talk
  if (cfg.talks != null) TALKS = cfg.talks;
  delete cfg.talks;
  // "lag": false = the AI coach answers the other bench's changes at once (as before 0.12)
  if (cfg.lag != null) AI_COACH.rules.lag = cfg.lag;
  delete cfg.lag;
  Object.assign(STYLE_TUNE, cfg);
}
const db = JSON.parse(readFileSync('public/db/base.json', 'utf8'));
const state: GameState = createWorld(db, { name: 'skill', seed: 'skill-1' });

function team(club: Club, squad: Player[], tactics: Tactics, lineup: Lineup, ai: boolean): TeamSetup {
  const ids = new Set([...lineup.xi.filter((x): x is number => x != null), ...lineup.bench]);
  return {
    clubId: club.id,
    name: club.name,
    short: club.short,
    colors: club.colors,
    tactics,
    xi: lineup.xi,
    bench: lineup.bench,
    ai,
    players: squad
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
        tire: age(p, state.meta.season) >= 32 ? 1.15 : age(p, state.meta.season) <= 21 ? 0.95 : 1,
      })),
  };
}

interface Ctx {
  f: Fixture;
  club: Club;
  squad: Player[];
  opp: Club;
  oppSquad: Player[];
}

interface Policy {
  name: string;
  ai: boolean;
  pre(c: Ctx): Tactics;
  live?(sim: MatchSim, side: 0 | 1, minute: number, mem: Record<string, number>): void;
}

const DEFAULT: Tactics = { formation: '4-4-2', mentality: 'equilibrada', marking: 'zona', style: 'toque', shape: null };

/** Substitute tired outfield players (below `limit`) with the best bench player for the slot. */
function tiredSubs(sim: MatchSim, side: 0 | 1, limit: number, max = MAX_SUBS) {
  const s = sim.sides[side];
  while (s.subs < max) {
    let worst: { id: number; slot: number; f: number } | null = null;
    s.onPitch.forEach((id, i) => {
      if (id == null || s.slots[i].pos === 'GOL') return;
      const p = s.players.get(id)!;
      if (p.fitness < limit && (!worst || p.fitness < worst.f)) worst = { id, slot: i, f: p.fitness };
    });
    if (!worst) return;
    const w = worst as { id: number; slot: number; f: number };
    let best: number | null = null;
    let bestE = 0;
    for (const id of s.bench) {
      const p = s.players.get(id)!;
      const e = effective(p, s.slots[w.slot].pos);
      if (!p.injured && e > bestE) {
        bestE = e;
        best = id;
      }
    }
    const out = s.players.get(w.id)!;
    if (best == null || bestE < effective(out, s.slots[w.slot].pos)) return;
    sim.sub(side, w.id, best);
  }
}

const scout = (c: Ctx): Tactics => {
  // read the opponent's plan in the scouting report, then plan against it (the AI only knows how you lined up
  // last time, so it cannot answer)
  const oppPlan = aiPreMatchTactics(state, c.f, c.opp, c.oppSquad, c.club, c.squad, true);
  const saved = c.opp.shown;
  c.opp.shown = { tactics: oppPlan, xi: autoLineup(c.oppSquad, oppPlan, c.f.comp).xi };
  const t = aiPreMatchTactics(state, c.f, c.club, c.squad, c.opp, c.oppSquad, true);
  c.opp.shown = saved;
  return t;
};
const aiPre = (c: Ctx) => aiPreMatchTactics(state, c.f, c.club, c.squad, c.opp, c.oppSquad, false);
const freshLegs: Policy['live'] = (sim, side, minute, mem) => {
  if (minute >= 60 && minute - (mem.lastSub ?? 0) >= 5) {
    const before = sim.sides[side].subs;
    tiredSubs(sim, side, 82);
    if (sim.sides[side].subs > before) mem.lastSub = minute;
  }
};
const everyMinute: Policy['live'] = (sim, side, minute) => {
  const plan = aiPlan(sim.situation(side, minute));
  const t = sim.sides[side].tactics;
  if (plan.mentality !== t.mentality || plan.style !== t.style || plan.marking !== t.marking) {
    sim.setTactics(side, { ...t, mentality: plan.mentality, style: plan.style, marking: plan.marking });
  }
};
/**
 * A good human: plans against the opponent before kick-off, uses half-time, and pauses at most 3 times —
 * right after something that changes the match (a goal that changes the result, a red card), otherwise
 * around 62' and 75'. Each stop: re-plan, fresh legs, close any hole left by a red card.
 */
const goodManager: Policy['live'] = (sim, side, minute, mem) => {
  const s = sim.sides[side];
  // the half-time team talk that fits the moment (the rules are on the talk buttons' tips), none if none fits
  if (TALKS && sim.half === 2 && !mem.talked) {
    mem.talked = 1;
    const sitHT = sim.situation(side, 45);
    const best = (['elogiar', 'cobrar', 'incentivar'] as const)
      .map((k) => ({ k, fit: talkFit(k, sitHT.diff, sitHT.edge, sim.sideRating(side)) }))
      .sort((a, b) => b.fit - a.fit)[0];
    if (best.fit > 0) sim.teamTalk(side, best.k);
  }
  const sit = sim.situation(side, minute);
  const state = Math.sign(sit.diff) * 10 + sit.men;
  const reds = sim.stats[0].red + sim.stats[1].red;
  const event = mem.state !== undefined && (state !== mem.state || reds !== mem.reds);
  mem.state = state;
  mem.reds = reds;
  const halfTime = minute === 46;
  const scheduled = minute === 62 || minute === 75;
  const pauses = mem.pauses ?? 0;
  if (!halfTime && !((event || scheduled) && pauses < 3 && minute >= 10)) return;
  if (!halfTime) mem.pauses = pauses + 1;

  (sim as unknown as { aiReorganise(s: 0 | 1): void }).aiReorganise(side);
  const plan = aiPlan(sim.situation(side, minute));
  const t = s.tactics;
  if (plan.mentality !== t.mentality || plan.style !== t.style || plan.marking !== t.marking) {
    sim.setTactics(side, { ...t, mentality: plan.mentality, style: plan.style, marking: plan.marking });
  }
  if (minute >= 55) ratingSubs(sim, side);
  if (minute >= 46) tiredSubs(sim, side, minute >= 70 ? 84 : 80);
};

/** Take off outfield players having a poor day (live rating ≤ 6.1) when the bench has someone similar. */
function ratingSubs(sim: MatchSim, side: 0 | 1) {
  const s = sim.sides[side];
  const cands = s.onPitch
    .map((id, i) => ({ id, i }))
    .filter(({ id, i }) => id != null && s.slots[i].pos !== 'GOL' && matchRating(s.players.get(id!)!) <= 6.1)
    .sort((a, b) => matchRating(s.players.get(a.id!)!) - matchRating(s.players.get(b.id!)!));
  for (const { id, i } of cands) {
    if (s.subs >= MAX_SUBS) return;
    const out = s.players.get(id!)!;
    const pos = s.slots[i].pos;
    // the manager knows força, not form: compare like for like
    const known = (p: typeof out) => effective({ ...p, str: p.str / p.form }, pos);
    let best: number | null = null;
    let bestE = 0;
    for (const b of s.bench) {
      const p = s.players.get(b)!;
      const e = known(p);
      if (!p.injured && e > bestE) {
        bestE = e;
        best = b;
      }
    }
    if (best != null && bestE >= known(out) * 0.93) sim.sub(side, id!, best);
  }
}
const EXTRA = process.argv.includes('--levers');
const LEVERS: Policy[] = [
  { name: 'AI + scouting the opponent', ai: true, pre: scout },
  { name: 'AI + fresh legs from 60\'', ai: true, pre: aiPre, live: freshLegs },
  { name: 'AI + re-reading every minute', ai: true, pre: aiPre, live: everyMinute },
  { name: 'AI + scouting + re-reading every minute', ai: true, pre: scout, live: everyMinute },
];

const POLICIES: Policy[] = EXTRA ? [{ name: 'AI coach', ai: true, pre: aiPre }, ...LEVERS] : [
  {
    name: 'Poor (3-4-3, attacks and presses all match, no subs)',
    ai: false,
    pre: () => ({ formation: '3-4-3', mentality: 'ofensiva', marking: 'pressao', style: 'longa', shape: null }),
  },
  { name: 'Passive (4-4-2, never touches anything)', ai: false, pre: () => DEFAULT },
  {
    name: 'AI coach',
    ai: true,
    pre: (c) => aiPreMatchTactics(state, c.f, c.club, c.squad, c.opp, c.oppSquad, false),
  },
  { name: 'Good (scouts, half-time + 3 pauses, fresh legs)', ai: false, pre: scout, live: goodManager },
];

// fixtures: clubs of the same league within 4 points of strength
const leagues = ['BRA1', 'ENG1', 'ESP1', 'ITA1', 'GER1', 'FRA1'];
const pairs: [Club, Club][] = [];
const rng = Rng.fromSeed('pairs');
while (pairs.length < N) {
  const lg = rng.pick(leagues);
  const clubs = Object.values(state.clubs).filter((c) => c.league === lg);
  const a = rng.pick(clubs);
  const b = rng.pick(clubs);
  if (a.id !== b.id && Math.abs(a.power - b.power) <= 4) pairs.push([a, b]);
}

const results: string[] = [];
for (const pol of POLICIES) {
  let pts = 0;
  let gd = 0;
  for (let i = 0; i < N; i++) {
    const [x, y] = pairs[i];
    const policyHome = i % 2 === 0;
    const [home, away] = policyHome ? [x, y] : [y, x];
    const f = { id: i, comp: x.league!, date: 5, home: home.id, away: away.id, hg: null, ag: null, pens: null, stage: null, tie: null, leg: 1, group: null, round: 1, goals: [], att: 0 } as Fixture;
    const me = x;
    const opp = y;
    const mySquad = squadOf(state, me.id);
    const oppSquad = squadOf(state, opp.id);
    const myT = pol.pre({ f, club: me, squad: mySquad, opp, oppSquad });
    const oppT = aiPreMatchTactics(state, f, opp, oppSquad, me, mySquad, !pol.ai);
    const myTeam = team(me, mySquad, myT, autoLineup(mySquad, myT, f.comp), pol.ai);
    const oppTeam = team(opp, oppSquad, oppT, autoLineup(oppSquad, oppT, f.comp), true);
    const setup: MatchSetup = {
      fixtureId: i,
      compId: f.comp,
      home: policyHome ? myTeam : oppTeam,
      away: policyHome ? oppTeam : myTeam,
      seed: Rng.fromSeed(`m${i}`).state(),
      homeAdv: HOME_ADV,
      decider: null,
    };
    const sim = new MatchSim(setup);
    const side: 0 | 1 = policyHome ? 0 : 1;
    const mem: Record<string, number> = {};
    let minute = -1;
    while (!sim.ended) {
      sim.step(20);
      const m = sim.minute();
      if (pol.live && m !== minute) {
        minute = m;
        pol.live(sim, side, m, mem);
      }
    }
    const r = sim.result();
    const mine = side === 0 ? r.hg : r.ag;
    const theirs = side === 0 ? r.ag : r.hg;
    pts += mine > theirs ? 3 : mine === theirs ? 1 : 0;
    gd += mine - theirs;
  }
  results.push(`${pol.name.padEnd(62)} ${(pts / N).toFixed(3)} pts/game  ${(gd / N >= 0 ? '+' : '') + (gd / N).toFixed(2)} goal diff`);
}
console.log(`${N} matches per manager, real squads within 4 points of each other, half at home, against the AI coach:\n`);
for (const r of results) console.log(r);
void FORMATIONS;
void slotsFor;
void bestFormation;
void isAvailable;
