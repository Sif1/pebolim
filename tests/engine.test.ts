import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze } from 'immer';
import { describe, expect, it } from 'vitest';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { createManager, runCommand } from '../src/engine/commands';
import { roundRobin, tieWinner } from '../src/engine/competitions';
import { MatchSim } from '../src/engine/match/core';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import { loadFromBytes, saveToBytes } from '../src/engine/save';
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
      runCommand(d as GameState, mid, { c: 'setTicket', price: 77 });
      runCommand(d as GameState, mid, { c: 'setTravel', mode: 'fretado' });
    });
    host = h2;
    replica = applyPatches(replica, p2) as GameState;
    expect(JSON.stringify(replica)).toBe(JSON.stringify(host));
  });
});

describe('save', () => {
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
