import { HOME_ADV } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import type { Formation, Pos, Tactics } from '../src/engine/types';
import { FORMATIONS } from '../src/engine/match/formations';
import type { MatchSetup, MPlayerInit, TeamSetup } from '../src/engine/match/core';

let nextId = 1;

export function synthTeam(str: number, rng: Rng, formation: Formation = '4-4-2', tactics?: Partial<Tactics>): TeamSetup {
  const slots = FORMATIONS[formation];
  const players: MPlayerInit[] = [];
  const mk = (pos: Pos): MPlayerInit => ({
    id: nextId++,
    name: `J${nextId}`,
    num: players.length + 1,
    pos,
    str: Math.max(30, Math.min(95, rng.normal(str, 4))),
    fitness: 95,
    morale: 60,
    traits: [],
    tire: 1,
  });
  // starters on their natural flank, so a baseline team has no side penalty
  for (const sl of slots) players.push({ ...mk(sl.pos), flank: sl.y < 0.3 ? 'L' : sl.y > 0.7 ? 'R' : 'C' });
  const benchPos: Pos[] = ['GOL', 'ZAG', 'LAT', 'VOL', 'MEI', 'ATA', 'MEI', 'ATA', 'ZAG'];
  for (const p of benchPos) players.push(mk(p));
  return {
    clubId: nextId++,
    name: `Time ${str}`,
    short: `T${str}`,
    colors: ['#fff', '#000'],
    tactics: { formation, mentality: 'equilibrada', marking: 'zona', style: 'toque', ...tactics },
    xi: players.slice(0, 11).map((p) => p.id),
    bench: players.slice(11).map((p) => p.id),
    players,
    ai: true,
  };
}

export function synthSetup(hs: number, as: number, seed: number, decider = false): MatchSetup {
  const rng = Rng.fromSeed(seed);
  return {
    fixtureId: seed,
    compId: 'TEST',
    home: synthTeam(hs, rng),
    away: synthTeam(as, rng),
    seed: rng.fork(),
    homeAdv: HOME_ADV,
    decider: decider ? { aggHome: 0, aggAway: 0 } : null,
  };
}
