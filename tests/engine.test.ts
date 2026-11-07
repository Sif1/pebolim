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
import { LiveMatch } from '../src/engine/match/live';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import { gzip, loadFromBytes, packState, saveToBytes } from '../src/engine/save';
import type { GameState } from '../src/engine/types';
import { datePlusMonths, resolveAuctions, returnLoans } from '../src/engine/transfers';
import { autoLineup, lineupIssues } from '../src/engine/ai/lineup';
import { autoShootout, Shootout } from '../src/engine/match/shootout';
import { kk, parseMoney, sortTable, squadOf } from '../src/engine/util';
import { endSeason, seasonVerdict } from '../src/engine/season';
import { boardChecks, fireManager } from '../src/engine/board';
import { juniorsOf, youthMatches } from '../src/engine/youth';
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

describe('money shorthand', () => {
  it('reads and writes 2,5kk / 300k', () => {
    expect(kk(2_500_000)).toBe('2,5kk');
    expect(kk(2_000_000)).toBe('2kk');
    expect(kk(300_000)).toBe('300k');
    expect(kk(1_250_000_000)).toBe('1,25kkk');
    for (const [t, v] of [
      ['2,5kk', 2_500_000],
      ['2.5kk', 2_500_000],
      ['2,5 mi', 2_500_000],
      ['US$ 300k', 300_000],
      ['300 mil', 300_000],
      ['2.000.000', 2_000_000],
      ['2000000', 2_000_000],
      ['1,2', 1],
      ['750', 750],
    ] as const)
      expect(parseMoney(t)).toBe(v);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
});

describe('penalty shootout', () => {
  it('follows the five-each then sudden-death rules', () => {
    const so = new Shootout(0, [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);
    // home scores three, away misses three: away cannot catch up
    for (let i = 0; i < 3; i++) {
      so.record({ side: 0, taker: so.next()!.taker, dir: 0, dive: 2, out: 0 });
      so.record({ side: 1, taker: so.next()!.taker, dir: 0, dive: 0, out: 1 });
    }
    expect(so.decided()).toBe(true);
    expect(so.next()).toBeNull();
    // level after five each goes to sudden death, alternating
    const sd = new Shootout(1, [[1, 2, 3, 4, 5, 11], [6, 7, 8, 9, 10, 12]]);
    for (let i = 0; i < 10; i++) {
      const n = sd.next()!;
      expect(n.side).toBe(i % 2 === 0 ? 1 : 0);
      sd.record({ side: n.side, taker: n.taker, dir: 0, dive: 2, out: 0 });
    }
    expect(sd.decided()).toBe(false);
    expect(sd.next()!.taker).toBe(12);
  });

  it('converts about three kicks in four with AI choices', () => {
    const rng = Rng.fromSeed('pk');
    let goals = 0;
    let kicks = 0;
    for (let i = 0; i < 400; i++) {
      const takers = new Map(Array.from({ length: 22 }, (_, k) => [k + 1, { id: k + 1, name: '', str: 72, pen: false, gk: false }]));
      const so = new Shootout(0, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]]);
      autoShootout(so, takers, [72, 72], rng);
      kicks += so.kicks.length;
      goals += so.kicks.filter((k) => k.out === 0).length;
    }
    expect(goals / kicks).toBeGreaterThan(0.68);
    expect(goals / kicks).toBeLessThan(0.82);
  });

  it('waits for the managers in a live match and ends with the shootout score', () => {
    let m: LiveMatch | null = null;
    for (let seed = 1; seed < 80 && !m; seed++) {
      const lm = new LiveMatch(synthSetup(70, 70, seed, true), [true, false]);
      lm.sim.step(99999);
      // penalties during the match are taken automatically here: this test is about the shootout
      while (lm.sim.spotPending) {
        lm.sim.autoSpotKick();
        lm.sim.step(99999);
      }
      if (lm.sim.pkPending) m = lm;
    }
    expect(m).not.toBeNull();
    const live = m!;
    live.tick(100, 60);
    const fr = live.frame().pk!;
    expect(fr.phase).toBe('order');
    expect(fr.wait).toEqual([true, false]);
    expect(live.pkOrder(0, fr.order[0].slice(0, 5).reverse())).toBeNull();
    live.tick(100, 60);
    expect(live.frame().pk!.phase).toBe('aim');
    // the human picks every time it is asked; the clock runs the animations
    for (let i = 0; i < 400 && !live.ended; i++) {
      live.pkAim(0, (i % 3) as 0 | 1 | 2);
      live.tick(500, 60);
    }
    expect(live.ended).toBe(true);
    const r = live.sim.result();
    expect(r.pens).not.toBeNull();
    expect(r.pens![0]).not.toBe(r.pens![1]);
  });
});

describe('in-match penalties', () => {
  it('turn into the mini-game when a human is playing, and the match goes on', () => {
    let seen = 0;
    for (let seed = 1; seed < 60 && seen < 2; seed++) {
      const m = new LiveMatch(synthSetup(70, 70, 500 + seed), [true, true]);
      let spots = 0;
      let guard = 0;
      while (!m.ended && guard++ < 20000) {
        m.tick(200, 19);
        const pk = m.frame().pk;
        if (pk?.mode === 'spot') {
          if (pk.phase === 'order') {
            spots += pk.wait[pk.first] ? 1 : 0;
            m.pkOrder(pk.first, [pk.order[pk.first][1]]);
          }
          if (pk.phase === 'aim') {
            m.pkAim(0, 2);
            m.pkAim(1, 0);
          }
        }
      }
      expect(m.ended).toBe(true);
      expect(m.sim.spotPending).toBeNull();
      seen += spots;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('market', () => {
  /** Two human clubs in the same league, transfer windows always open. */
  function twoManagers() {
    const s = world();
    s.meta.settings.windows = false;
    const rng = new Rng(s.meta.rng);
    const [ca, cb] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    const a = createManager(s, rng, 'A', ca.id);
    const b = createManager(s, rng, 'B', cb.id);
    s.meta.rng = rng.state();
    cb.balance = 1e9;
    const p = squadOf(s, ca.id).sort((x, y) => x.str - y.str)[5];
    return { s, ca, cb, a, b, p };
  }

  it('a listed price closes the deal at once', () => {
    const { s, ca, cb, a, b, p } = twoManagers();
    expect(runCommand(s, a.id, { c: 'setSale', pid: p.id, price: 1_500_000 }).ok).toBe(true);
    expect(p.salePrice).toBe(1_500_000);
    const before = ca.balance;
    const r = runCommand(s, b.id, { c: 'bid', pid: p.id, kind: 'compra', fee: 1_500_000, wage: p.wage * 3, years: 3 });
    expect(r.ok).toBe(true);
    expect(p.clubId).toBe(cb.id);
    expect(p.salePrice).toBeNull();
    expect(ca.balance).toBe(before + 1_500_000);
  });

  it('loans last 6 or 12 months, the borrower pays the wage, then the player returns', () => {
    const { s, ca, cb, a, b, p } = twoManagers();
    expect(runCommand(s, a.id, { c: 'setLoanList', pid: p.id, months: 6 }).ok).toBe(true);
    const r = runCommand(s, b.id, { c: 'bid', pid: p.id, kind: 'emprestimo', fee: 0, wage: 1, years: 1 });
    expect(r.ok).toBe(true);
    expect(p.clubId).toBe(cb.id);
    expect(p.loan?.from).toBe(ca.id);
    // half a season later he is back
    const until = p.loan!.until;
    expect(until).toBe(datePlusMonths(s, 6));
    s.meta.season = Math.floor(until / 100);
    s.meta.date = until % 100;
    returnLoans(s);
    expect(p.clubId).toBe(ca.id);
    expect(p.loan).toBeNull();
  });

  it('auctions go to the highest sealed bid at the next match day', () => {
    const { s, cb, a, b, p } = twoManagers();
    expect(runCommand(s, a.id, { c: 'startAuction', pid: p.id, min: 100_000 }).ok).toBe(true);
    // no regular bids while in auction, and the owner cannot bid
    expect(runCommand(s, b.id, { c: 'bid', pid: p.id, kind: 'compra', fee: 1e6, wage: 1e5, years: 2 }).ok).toBe(false);
    expect(runCommand(s, a.id, { c: 'auctionBid', pid: p.id, amount: 200_000 }).ok).toBe(false);
    expect(runCommand(s, b.id, { c: 'auctionBid', pid: p.id, amount: 50_000 }).ok).toBe(false);
    const huge = 50_000_000;
    expect(runCommand(s, b.id, { c: 'auctionBid', pid: p.id, amount: huge }).ok).toBe(true);
    // closes only once a date has passed
    resolveAuctions(s, Rng.fromSeed(1));
    expect(p.auction).not.toBeNull();
    s.meta.date++;
    const before = cb.balance;
    resolveAuctions(s, Rng.fromSeed(1));
    expect(p.clubId).toBe(cb.id);
    expect(p.auction).toBeNull();
    expect(cb.balance).toBe(before - huge);
    expect(s.auctionBids[p.id]).toBeUndefined();
    // and it shows in the auction history, with the human bid
    const last = s.auctionLog!.at(-1)!;
    expect(last).toMatchObject({ pid: p.id, to: cb.id, amount: huge });
    expect(last.human[cb.id]).toBe(huge);
  });

  it('flags injured or suspended players in a manual lineup for today', () => {
    const s = world();
    const f = Object.values(s.fixtures).find((x) => x.date === s.meta.date)!;
    const club = s.clubs[f.home];
    const squad = squadOf(s, club.id);
    club.autoLineup = false;
    club.lineup = autoLineup(squad, club.tactics, f.comp);
    expect(lineupIssues(s, club.id)).toEqual([]);
    const [a, b] = club.lineup.xi.filter((x): x is number => x != null).map((id) => s.players[id]);
    a.injury = 2;
    b.ban[f.comp] = 1;
    const issues = lineupIssues(s, club.id);
    expect(issues.some((t) => t.includes(a.name) && t.includes('lesionado'))).toBe(true);
    expect(issues.some((t) => t.includes(b.name) && t.includes('suspenso'))).toBe(true);
    // picking the team automatically sidesteps them
    club.autoLineup = true;
    expect(lineupIssues(s, club.id)).toEqual([]);
  });

  it('renews marked contracts automatically at the end of the season', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    const season = s.meta.season;
    const [kept, gone, old] = squadOf(s, club.id).filter((p) => !p.loan && season - p.birth < 33);
    for (const p of [kept, gone, old]) {
      p.contractEnd = season;
      p.morale = 70;
    }
    old.birth = season - 36;
    expect(runCommand(s, m.id, { c: 'setAutoRenew', pids: [kept.id, old.id], on: true }).ok).toBe(true);
    endSeason(s, rng, new Set([m.id]));
    expect(kept.clubId).toBe(club.id);
    expect(kept.contractEnd).toBeGreaterThan(season);
    expect(s.news.some((n) => n.text === `${gone.name} deixa o ${club.name} ao fim do contrato.`)).toBe(true);
    // 35 and older: no automatic renewal
    expect(s.news.some((n) => n.text.startsWith(`${old.name} (36 anos) não renova`))).toBe(true);
    expect(s.news.some((n) => n.text.startsWith(`Renovação automática: ${kept.name}`))).toBe(true);
  });

  it('signs pre-contracts in the final six months and moves the player at season end', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    const p = Object.values(s.players).find((x) => x.clubId != null && x.clubId !== club.id && !x.loan)!;
    p.contractEnd = s.meta.season;
    expect(runCommand(s, m.id, { c: 'preContract', pid: p.id, wage: 1e7, years: 2 }).ok).toBe(false); // too early
    s.meta.date = 40;
    expect(runCommand(s, m.id, { c: 'preContract', pid: p.id, wage: 1e7, years: 2 }).ok).toBe(true);
    endSeason(s, rng, new Set([m.id]));
    expect(p.clubId).toBe(club.id);
    expect(p.contractEnd).toBe(s.meta.season + 1);
    expect(p.pre).toBeNull();
  });

  it('keeps offering jobs to a sacked manager, even with a low reputation', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA2')!;
    const m = createManager(s, rng, 'A', club.id);
    fireManager(s, m, 'teste');
    m.rep = 5;
    for (let i = 0; i < 12 && !m.offers.length; i++) boardChecks(s, rng, new Set([m.id]));
    expect(m.offers.length).toBeGreaterThan(0);
  });

  it("only tops a human club's short squad up to a playable size, at its own level", () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA2')!;
    const m = createManager(s, rng, 'A', club.id);
    // most of the squad leaves; a star is free on the market
    const squad = squadOf(s, club.id).sort((a, b) => a.str - b.str);
    for (const p of squad.slice(0, squad.length - 10)) p.clubId = null;
    const star = Object.values(s.players).sort((a, b) => b.str - a.str)[0];
    star.clubId = null;
    endSeason(s, rng, new Set([m.id]));
    const after = squadOf(s, club.id);
    expect(after.length).toBeGreaterThanOrEqual(18);
    expect(star.clubId).not.toBe(club.id);
    expect(s.news.some((n) => n.to === m.id && n.text.startsWith('A diretoria completou o elenco'))).toBe(true);
  });

  it('gives a manager in his first season half the blame for a missed objective', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const [a, b] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    const fresh = createManager(s, rng, 'Novo', a.id);
    const old = createManager(s, rng, 'Antigo', b.id);
    old.since -= 100; // hired a season ago
    for (const c of [a, b]) {
      c.board.goal = 'titulo';
      c.board.conf = 45;
    }
    const present = new Set([fresh.id, old.id]);
    seasonVerdict(s, a, 12, 20, present);
    seasonVerdict(s, b, 12, 20, present);
    expect(fresh.clubId).toBe(a.id); // 45 − 17.5: kept, with a message
    expect(s.news.some((n) => n.to === fresh.id && n.text.includes('mantém você no cargo'))).toBe(true);
    expect(old.clubId).toBeNull(); // 45 − 35: sacked
  });

  it('keeps a youth team apart from the first team, with hidden força until promoted', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    const youth = juniorsOf(s, club.id);
    expect(youth.length).toBeGreaterThanOrEqual(7);
    // not in the squad, not in line-ups
    const squad = squadOf(s, club.id);
    expect(squad.some((p) => p.junior)).toBe(false);
    const j = youth[0];
    expect(runCommand(s, m.id, { c: 'renameYouth', pid: j.id, name: 'Pebolinho' }).ok).toBe(true);
    expect(j.name).toBe('Pebolinho');
    expect(runCommand(s, m.id, { c: 'promoteYouth', pid: j.id }).ok).toBe(true);
    expect(squadOf(s, club.id).some((p) => p.id === j.id)).toBe(true);
    expect(j.junior).toBe(false);
    // youth matches give them stats over a few weekends
    for (let d = 0; d < 6; d++) {
      s.meta.date = d;
      youthMatches(s, rng);
    }
    expect(juniorsOf(s, club.id).some((p) => (p.ys?.[0] ?? 0) > 0)).toBe(true);
  });

  it('checks the new market commands from clients', () => {
    expect(validCommand({ c: 'setSale', pid: 1, price: 5e5 })).not.toBeNull();
    expect(validCommand({ c: 'setSale', pid: 1, price: -1 })).toBeNull();
    expect(validCommand({ c: 'setLoanList', pid: 1, months: 9 })).toBeNull();
    expect(validCommand({ c: 'setLoanList', pid: 1, months: 6 })).not.toBeNull();
    expect(validCommand({ c: 'auctionBid', pid: 1, amount: null })).not.toBeNull();
    expect(validCommand({ c: 'bid', pid: 1, kind: 'emprestimo', fee: 0, wage: 1, years: 1, months: 7 })).toBeNull();
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

  it('gives a realistic number of penalties (about 0.3 a match)', () => {
    let pens = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const sim = new MatchSim(synthSetup(78, 64, 9000 + i));
      const orig = (sim as unknown as { doShot: (t: string, ...r: unknown[]) => void }).doShot.bind(sim);
      (sim as unknown as { doShot: (t: string, ...r: unknown[]) => void }).doShot = (t: string, ...r: unknown[]) => {
        if (t === 'penalty') pens++;
        return orig(t, ...r);
      };
      sim.runToEnd();
    }
    expect(pens / N).toBeGreaterThan(0.15);
    expect(pens / N).toBeLessThan(0.5);
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

  it('plans before kick-off: favourites keep their shape, weak sides away sit deep', () => {
    const s = world();
    playDates(s, 2);
    const league = Object.values(s.clubs).filter((c) => c.league === 'BRA1').sort((a, b) => b.power - a.power);
    const strong = league[0];
    const weak = league[league.length - 1];
    const f = Object.values(s.fixtures).find((x) => x.comp === 'BRA1')!;
    const fake = { ...f, home: strong.id, away: weak.id };
    const tStrong = aiPreMatchTactics(s, fake, strong, squadOf(s, strong.id), weak, squadOf(s, weak.id), false);
    const tWeak = aiPreMatchTactics(s, fake, weak, squadOf(s, weak.id), strong, squadOf(s, strong.id), false);
    // measured (tools/skill.ts): all-out attack from kick-off gets punished on the counter
    expect(tStrong.mentality).toBe('equilibrada');
    expect(tWeak.mentality).toBe('defensiva');
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

describe('momentum', () => {
  it('builds per-minute pressure that follows the stronger side', () => {
    let strong = 0;
    let weak = 0;
    for (let i = 0; i < 30; i++) {
      const sim = new MatchSim(synthSetup(80, 62, 700 + i));
      sim.runToEnd();
      expect(sim.momentum[0]).toHaveLength(90);
      strong += sim.momentum[0].reduce((a, b) => a + b, 0);
      weak += sim.momentum[1].reduce((a, b) => a + b, 0);
      // a goal always shows up as pressure in its minute
      expect(sim.momentum[0].some((v) => v > 0) && sim.momentum[1].some((v) => v > 0)).toBe(true);
    }
    expect(strong).toBeGreaterThan(weak * 1.2);
  });
});

describe('live highlights', () => {
  it('shows every goal as a highlight at a followable speed and idles in between', () => {
    const base = 5700 / 300;
    let goals = 0;
    let shown = 0;
    let idle = 0;
    let hlFast = 0;
    for (const seed of [11, 12, 13]) {
      const m = new LiveMatch(synthSetup(74, 68, seed), [false, false]);
      while (!m.ended) {
        const before = m.frame();
        m.tick(100, base);
        const fr = m.frame();
        const g = fr.sc[0] + fr.sc[1] - (before.sc[0] + before.sc[1]);
        goals += g;
        if (fr.hl || before.hl) shown += g;
        if (!fr.hl) idle++;
        if (fr.hl && m.speedNow > 4) hlFast++;
      }
    }
    expect(goals).toBeGreaterThan(0);
    expect(shown).toBe(goals);
    expect(idle).toBeGreaterThan(0);
    expect(hlFast).toBe(0);
  });
});

describe('live match pacing', () => {
  it('slows key moments down and still lasts about the chosen length', () => {
    for (const minutes of [2, 5]) {
      const base = 5700 / (minutes * 60);
      let real = 0;
      let slowest = Infinity;
      const m = new LiveMatch(synthSetup(70, 70, 4242), [false, false]);
      while (!m.ended && real < 3600) {
        const key = m.tier() === 2;
        m.tick(100, base);
        real += 0.1;
        if (key) slowest = Math.min(slowest, m.speedNow);
      }
      expect(real).toBeGreaterThan(minutes * 60 * 0.85);
      expect(real).toBeLessThan(minutes * 60 * 1.15);
      expect(slowest).toBeLessThan(base / 3);
    }
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
    expect(back.v).toBe(3);
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
