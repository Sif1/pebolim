import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze } from 'immer';
import { describe, expect, it } from 'vitest';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { createCustomClub, createManager, runCommand } from '../src/engine/commands';
import { clubComps, sectorRefs } from '../src/engine/economy';
import { presetCells, slotsFor } from '../src/engine/match/formations';
import { aiPlan, type Situation } from '../src/engine/ai/tactics';
import { aiPreMatchTactics } from '../src/engine/matchday';
import { validClientMsg, validCommand } from '../src/net/validate';
import { roundRobin, tieWinner } from '../src/engine/competitions';
import { MatchSim } from '../src/engine/match/core';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import { gzip, loadFromBytes, packState, saveToBytes } from '../src/engine/save';
import type { GameState } from '../src/engine/types';
import { sortTable, squadOf } from '../src/engine/util';
import { createWorld } from '../src/engine/world';
import { synthSetup } from './helpers';
import { synthDb } from './synthDb';

enablePatches();
setAutoFreeze(false);

const world = () => createWorld(synthDb(), { name: 'test', seed: 'test-seed' });

function playDates(state: GameState, n: number, present = new Set<string>()) {
  for (let i = 0; i < n; i++) {
    const rng = new Rng(state.meta.rng);
    const plan = prepareMatchday(state, rng, present);
    state.meta.rng = rng.state();
    finishDate(state, Object.values(simulateBackground(plan)), present);
  }
}

describe('rng', () => {
  it('is deterministic for a seed and restorable from its state', () => {
    const a = Rng.fromSeed('x');
    const b = Rng.fromSeed('x');
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    const c = new Rng(a.state());
    expect(c.next()).toBe(a.next());
  });
});

describe('round robin', () => {
  it('pairs every club twice, once at home', () => {
    const clubs = Array.from({ length: 20 }, (_, i) => i + 1);
    const rounds = roundRobin(clubs, 2, Rng.fromSeed(1));
    expect(rounds).toHaveLength(38);
    const seen = new Map<string, number>();
    for (const r of rounds) {
      const playing = new Set<number>();
      for (const [h, a] of r) {
        expect(playing.has(h) || playing.has(a)).toBe(false);
        playing.add(h);
        playing.add(a);
        seen.set(`${h}-${a}`, (seen.get(`${h}-${a}`) ?? 0) + 1);
      }
    }
    expect(seen.size).toBe(20 * 19);
    for (const v of seen.values()) expect(v).toBe(1);
  });

  it('handles odd club counts with byes', () => {
    const rounds = roundRobin([1, 2, 3, 4, 5], 1, Rng.fromSeed(2));
    expect(rounds).toHaveLength(5);
    expect(rounds.flat()).toHaveLength(10);
  });
});

describe('match engine', () => {
  it('produces realistic averages and rewards strength', () => {
    let goals = 0;
    let strongWins = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const r = new MatchSim(synthSetup(80, 68, i)).runToEnd();
      goals += r.hg + r.ag;
      if (r.hg > r.ag) strongWins++;
    }
    expect(goals / N).toBeGreaterThan(2.2);
    expect(goals / N).toBeLessThan(3.4);
    expect(strongWins / N).toBeGreaterThan(0.6);
  });

  it('always finds a winner in a decider', () => {
    for (let i = 0; i < 200; i++) {
      const r = new MatchSim(synthSetup(70, 70, i, true)).runToEnd();
      if (r.hg === r.ag) {
        expect(r.pens).not.toBeNull();
        expect(r.pens![0]).not.toBe(r.pens![1]);
      }
    }
  });

  it('applies substitutions and rejects invalid ones', () => {
    const sim = new MatchSim(synthSetup(70, 70, 5));
    const out = sim.sides[0].onPitch[5]!;
    const inn = sim.sides[0].bench[2];
    expect(sim.sub(0, out, inn)).toBeNull();
    expect(sim.sides[0].onPitch[5]).toBe(inn);
    expect(sim.sub(0, out, sim.sides[0].bench[0])).toBe('Jogador não está em campo');
  });
});

describe('season', () => {
  it('builds a consistent world and calendar', () => {
    const s = world();
    expect(Object.keys(s.comps).length).toBeGreaterThan(30);
    for (const f of Object.values(s.fixtures)) {
      expect(s.calendar[f.date]).toBeDefined();
    }
    // no club plays twice on the same date
    const byDate = new Map<string, number>();
    for (const f of Object.values(s.fixtures)) {
      for (const c of [f.home, f.away]) {
        const k = `${f.date}:${c}`;
        byDate.set(k, (byDate.get(k) ?? 0) + 1);
      }
    }
    for (const v of byDate.values()) expect(v).toBe(1);
  });

  it('plays a full season: champions, promotion and relegation', () => {
    const s = world();
    const a1 = sortTable(s.comps.BRA1.table, s.clubs);
    playDates(s, s.calendar.length);
    expect(s.meta.season).toBe(2027);
    expect(s.history).toHaveLength(1);
    const h = s.history[0];
    expect(Object.keys(h.champions).length).toBeGreaterThan(30);
    const ranks = s.prev.ranks.BRA1;
    expect(ranks).toHaveLength(20);
    // bottom 4 of Série A now play in Série B
    for (const cid of ranks.slice(16)) expect(s.clubs[cid].league).toBe('BRA2');
    expect(Object.values(s.clubs).filter((c) => c.league === 'BRA1')).toHaveLength(20);
    expect(a1).toHaveLength(20);
    for (const c of Object.values(s.clubs)) {
      if (c.league) expect(squadOf(s, c.id).length).toBeGreaterThanOrEqual(18);
    }
  }, 120000);
});

describe('knockout', () => {
  it('decides two-legged ties on aggregate', () => {
    const s = world();
    const cdb = s.comps.CDB;
    const tie = cdb.stages[0].ties.find((t) => t.b != null)!;
    expect(tieWinner(s, tie)).toBeNull();
    const f = s.fixtures[tie.fixtures[0]];
    f.hg = 2;
    f.ag = 1;
    expect(tieWinner(s, tie)).toBe(f.home);
  });
});

describe('commands', () => {
  it('validates money, ownership and windows', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA2')!;
    const m = createManager(s, rng, 'Teste', club.id);
    s.meta.rng = rng.state();
    expect(club.managerId).toBe(m.id);
    // a star player of another club is unaffordable
    const star = Object.values(s.players)
      .filter((p) => p.clubId != null && p.clubId !== club.id)
      .sort((a, b) => b.str - a.str)[0];
    const r = runCommand(s, m.id, { c: 'bid', pid: star.id, kind: 'compra', fee: club.balance * 10, wage: 1, years: 2 });
    expect(r.ok).toBe(false);
    // cannot renew someone else's player
    expect(runCommand(s, m.id, { c: 'renew', pid: star.id, wage: 1, years: 1 }).ok).toBe(false);
    // upgrading the training centre costs money
    const before = club.balance;
    club.balance = 1e12;
    expect(runCommand(s, m.id, { c: 'upgradeTC' }).ok).toBe(club.tc.level < 5);
    club.balance = before;
  });

  it('keeps a patched replica identical to the host state', () => {
    let host = world();
    let replica: GameState = structuredClone(host);
    const rng = new Rng(host.meta.rng);
    const club = Object.values(host.clubs).find((c) => c.league === 'BRA1')!;
    const [h1, p1] = produceWithPatches(host, (d) => {
      createManager(d as GameState, rng, 'A', club.id);
      d.meta.rng = rng.state();
    });
    host = h1;
    replica = applyPatches(replica, p1) as GameState;
    const mid = club.managerId ?? Object.keys(host.managers)[0];
    const [h2, p2] = produceWithPatches(host, (d) => {
      runCommand(d as GameState, mid, { c: 'setTickets', comp: null, prices: [20, 40, 70, 200] });
      runCommand(d as GameState, mid, { c: 'setTravel', mode: 'fretado' });
    });
    host = h2;
    replica = applyPatches(replica, p2) as GameState;
    expect(JSON.stringify(replica)).toBe(JSON.stringify(host));
  });
});

describe('new features', () => {
  it('custom positions keep the keeper and give each cell a role', () => {
    const shape = presetCells('4-4-2');
    shape[9] = 12; // second striker drops to the middle of the pitch
    const slots = slotsFor({ formation: '4-4-2', shape });
    expect(slots[0].pos).toBe('GOL');
    expect(slots[10].pos).toBe('MEI');
    expect(slotsFor({ formation: '4-4-2', shape: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9] })[1]).toEqual(slotsFor({ formation: '4-4-2' })[1]);
  });

  it('keeps the playing styles balanced (no dominant style)', () => {
    const ppg = (style: 'toque' | 'contra' | 'longa') => {
      let pts = 0;
      for (let i = 0; i < 700; i++) {
        const s = synthSetup(70, 70, 5000 + i);
        s.home.tactics.style = style;
        s.home.ai = false; // keep the style all match, against the AI coach
        const r = new MatchSim(s).runToEnd();
        pts += r.hg > r.ag ? 3 : r.hg === r.ag ? 1 : 0;
      }
      return pts / 700;
    };
    const base = ppg('toque');
    expect(Math.abs(ppg('contra') - base)).toBeLessThan(0.2);
    expect(Math.abs(ppg('longa') - base)).toBeLessThan(0.2);
  });

  it('records passes, tackles, xG and ratings in a match', () => {
    const r = new MatchSim(synthSetup(72, 68, 11)).runToEnd();
    for (const s of r.stats) {
      expect(s.passes).toBeGreaterThan(100);
      expect(s.passFail).toBeGreaterThan(10);
      expect(s.tackles).toBeGreaterThan(0);
      expect(s.xg).toBeGreaterThan(0);
    }
    for (const p of Object.values(r.players)) {
      expect(p.rt).toBeGreaterThanOrEqual(3);
      expect(p.rt).toBeLessThanOrEqual(10);
    }
  });

  it('sets ticket prices per competition and keeps them in bounds', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'T', club.id);
    const comp = clubComps(s, club.id)[0].id;
    expect(runCommand(s, m.id, { c: 'setTickets', comp, prices: [1, 1e6, 50, 100] }).ok).toBe(true);
    const refs = sectorRefs(club);
    expect(club.tickets.comps[comp][0]).toBe(Math.round(refs[0] * 0.2));
    expect(club.tickets.comps[comp][1]).toBe(Math.round(refs[1] * 5));
    expect(runCommand(s, m.id, { c: 'setTickets', comp: 'NOPE', prices: [1, 1, 1, 1] }).ok).toBe(false);
    expect(runCommand(s, m.id, { c: 'setTickets', comp, prices: null }).ok).toBe(true);
    expect(club.tickets.comps[comp]).toBeUndefined();
  });

  it('builds the training centre over several dates', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1' && c.tc.level < 5)!;
    const m = createManager(s, rng, 'T', club.id);
    club.balance = 1e12;
    const lvl = club.tc.level;
    expect(runCommand(s, m.id, { c: 'upgradeTC' }).ok).toBe(true);
    expect(club.tc.building).toBeGreaterThanOrEqual(8);
    playDates(s, 2);
    expect(club.tc.level).toBe(lvl);
    playDates(s, club.tc.building);
    expect(club.tc.level).toBe(lvl + 1);
  });

  it('creates a club mid-career without breaking the squad pool', () => {
    const s = world();
    playDates(s, 5);
    const rng = new Rng(s.meta.rng);
    const bottom = Object.values(s.clubs).find((c) => c.league === 'BRA3' && !c.managerId) ?? Object.values(s.clubs).find((c) => c.league === 'BRA2')!;
    const oldSquad = squadOf(s, bottom.id).map((p) => p.id);
    const err = createCustomClub(s, rng, { name: 'Pebolim FC', short: 'PEB', colors: ['#112233', '#ffffff'], city: 'X', stadium: 'Y', replaceClubId: bottom.id }, false);
    expect(err).toBeNull();
    for (const id of oldSquad) expect(s.players[id]).toBeDefined();
    expect(squadOf(s, bottom.id).length).toBeGreaterThanOrEqual(20);
  });
});

describe('AI coach', () => {
  const sit = (o: Partial<Situation>): Situation => ({
    minute: 30,
    diff: 0,
    men: 0,
    edge: 0,
    home: true,
    decider: false,
    energy: 90,
    opp: { mentality: 'equilibrada', style: 'toque', marking: 'zona' },
    natural: 'toque',
    ...o,
  });

  it('adapts to the score, the clock, numbers and the opponent', () => {
    expect(aiPlan(sit({ minute: 85, diff: -1 }))).toMatchObject({ mentality: 'ofensiva', style: 'longa' });
    expect(aiPlan(sit({ minute: 65, diff: 1, edge: -6, home: false }))).toMatchObject({ mentality: 'defensiva', style: 'contra' });
    expect(aiPlan(sit({ men: -1 }))).toMatchObject({ mentality: 'defensiva', style: 'contra' });
    expect(aiPlan(sit({ men: 1, minute: 60 }))).toMatchObject({ mentality: 'ofensiva', style: 'toque', marking: 'pressao' });
    // a favourite doesn't throw everyone forward against a counter-attacking side
    expect(aiPlan(sit({ edge: 8, opp: { mentality: 'defensiva', style: 'contra', marking: 'zona' } })).mentality).toBe('equilibrada');
    // against an opponent pushing forward, a side that isn't chasing goes for the counter
    expect(aiPlan(sit({ edge: 0, opp: { mentality: 'ofensiva', style: 'toque', marking: 'zona' } })).style).toBe('contra');
    // a knockout tie that needs a goal
    expect(aiPlan(sit({ minute: 62, diff: 0, decider: true })).mentality).toBe('ofensiva');
  });

  it('plans before kick-off: favourites at home attack, weak sides away sit deep', () => {
    const s = world();
    playDates(s, 2);
    const league = Object.values(s.clubs).filter((c) => c.league === 'BRA1').sort((a, b) => b.power - a.power);
    const strong = league[0];
    const weak = league[league.length - 1];
    const f = Object.values(s.fixtures).find((x) => x.comp === 'BRA1')!;
    const fake = { ...f, home: strong.id, away: weak.id };
    const tStrong = aiPreMatchTactics(s, fake, strong, squadOf(s, strong.id), weak, squadOf(s, weak.id), false);
    const tWeak = aiPreMatchTactics(s, fake, weak, squadOf(s, weak.id), strong, squadOf(s, strong.id), false);
    expect(tStrong.mentality).not.toBe('defensiva');
    expect(tWeak.mentality).toBe('defensiva');
    expect(tWeak.style).toBe('contra');
  });

  it('changes tactics during a match and reorganises after a red card', () => {
    let changed = 0;
    for (let i = 0; i < 40; i++) {
      const r = new MatchSim(synthSetup(78, 64, 900 + i));
      r.runToEnd();
      changed += r.events.filter((e) => e.kind === 'tactic' && e.text.includes('muda')).length;
    }
    expect(changed).toBeGreaterThan(20);
    const sim = new MatchSim(synthSetup(70, 70, 77));
    const side = sim.sides[0];
    const hole = side.slots.findIndex((sl) => sl.pos === 'ZAG');
    side.onPitch[hole] = null;
    (sim as unknown as { aiReorganise(s: 0 | 1): void }).aiReorganise(0);
    expect(side.onPitch[hole]).not.toBeNull();
    expect(side.onPitch.filter((x) => x == null)).toHaveLength(1);
  });
});

describe('host input checks', () => {
  it('drops malformed commands and messages', () => {
    expect(validCommand({ c: 'bid', pid: 1, kind: 'compra', fee: NaN, wage: 1000, years: 2 })).toBeNull();
    expect(validCommand({ c: 'renew', pid: 1, wage: 'lots', years: 2 })).toBeNull();
    expect(validCommand({ c: 'setTickets', comp: null, prices: [1, 2, 3] })).toBeNull();
    expect(validCommand({ c: 'expandStadium', seats: 1e9 })).toBeNull();
    expect(validCommand({ c: 'setTactics', tactics: { formation: '4-4-2', mentality: 'x', marking: 'zona', style: 'toque' } })).toBeNull();
    expect(validCommand({ c: 'nope' })).toBeNull();
    expect(validClientMsg({ t: 'match', fixtureId: 1, action: { a: 'swap', s1: 0, s2: 99 } })).toBeNull();
    expect(validClientMsg({ t: 'settings', matchMinutes: 0.01 })).toBeNull();
    expect(validClientMsg('hello')).toBeNull();
    expect(validClientMsg({ t: 'cmd', seq: 1, cmd: { c: 'bid', pid: 3, kind: 'compra', fee: 10, wage: 100, years: 2 } })).not.toBeNull();
  });

  it('never lets NaN reach the state', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'T', club.id);
    runCommand(s, m.id, { c: 'setTickets', comp: null, prices: [NaN, NaN, NaN, NaN] });
    expect(club.tickets.base.every((p) => Number.isFinite(p))).toBe(true);
  });
});

describe('save', () => {
  it('migrates version 1 saves (single ticket price)', async () => {
    const s = world();
    const club = Object.values(s.clubs)[0];
    const old = structuredClone(s) as any;
    old.v = 1;
    for (const c of Object.values(old.clubs) as any[]) {
      c.ticket = 50;
      delete c.tickets;
    }
    const bytes = await gzip(JSON.stringify({ app: 'pebolim-manager', format: 1, state: packState(old) }));
    const back = await loadFromBytes(bytes);
    expect(back.v).toBe(2);
    expect(back.clubs[club.id].tickets.base).toHaveLength(4);
    expect((back.clubs[club.id] as any).ticket).toBeUndefined();
  });

  it('round-trips and stays small', async () => {
    const s = world();
    playDates(s, 3);
    const bytes = await saveToBytes(s);
    expect(bytes.length).toBeLessThan(600 * 1024);
    const back = await loadFromBytes(bytes);
    expect(Object.keys(back.players).length).toBe(Object.keys(s.players).length);
    expect(back.meta.date).toBe(s.meta.date);
    const p = Object.values(s.players)[10];
    expect(back.players[p.id].name).toBe(p.name);
    expect(back.players[p.id].s).toEqual(p.s);
    const f = Object.values(s.fixtures).find((x) => x.hg != null)!;
    expect(back.fixtures[f.id].hg).toBe(f.hg);
  });

  it('rejects files that are not saves', async () => {
    await expect(loadFromBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
