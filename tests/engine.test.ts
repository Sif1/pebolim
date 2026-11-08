import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze } from 'immer';
import { describe, expect, it } from 'vitest';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { createCustomClub, createManager, PRE_CONTRACT_FROM, runCommand } from '../src/engine/commands';
import { clubComps, roughIncome, sectorRefs, tcClubCost, tcUpgradeCost } from '../src/engine/economy';
import { headToHead, isDerby, recordHeadToHead, rivalsOf } from '../src/engine/rivals';
import { objectiveDelta, recordCareer } from '../src/engine/review';
import { presetCells, slotsFor } from '../src/engine/match/formations';
import { aiPlan, type Situation } from '../src/engine/ai/tactics';
import { aiPreMatchTactics } from '../src/engine/matchday';
import { validClientMsg, validCommand, validMatchAction } from '../src/net/validate';
import { roundRobin, tieWinner } from '../src/engine/competitions';
import { MatchSim, TALK_TUNE, talkFit } from '../src/engine/match/core';
import { LiveMatch } from '../src/engine/match/live';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import { gzip, loadFromBytes, packState, saveToBytes } from '../src/engine/save';
import type { GameState } from '../src/engine/types';
import {
  aiTransfers,
  bidDeadline,
  datePlusMonths,
  deadlineDay,
  expireBids,
  refusesClub,
  resolveAuctions,
  returnLoans,
  STATURE_MAX_GAP,
  statureGap,
  wageDemand,
} from '../src/engine/transfers';
import { autoLineup, lineupIssues } from '../src/engine/ai/lineup';
import { autoShootout, Shootout } from '../src/engine/match/shootout';
import { age, kk, parseMoney, sortTable, squadIndex, squadOf } from '../src/engine/util';
import { aiPayRises, endSeason, ensureKeepers, seasonVerdict } from '../src/engine/season';
import { boardAfterMatch, boardChecks, fireManager, offerJob } from '../src/engine/board';
import { juniorsOf, youthMatches } from '../src/engine/youth';
import { careerBonus, clubGrowthFactor, dailyPlayers, ELITE_GROWTH, restDays } from '../src/engine/development';
import { potentialSeen, scoutRound } from '../src/engine/potential';
import { injuryAgeRisk, injuryLength } from '../src/engine/match/core';
import { banLength } from '../src/engine/advance';
import { cupRotation } from '../src/engine/matchday';
import { contractFactor, expectedWage, marketValue, playerValue } from '../src/engine/util';
import { coachRanking, matchWeight, rankAward, rankMatch, rankTitle, sackCoach, titleWeight } from '../src/engine/coaches';
import { PITCH_FX, pitchLevel, pitchRound } from '../src/engine/pitch';
import { effective, laneOf } from '../src/engine/match/ratings';
import { starsFor } from '../src/engine/potential';
import { academyLevel, fillerLevel } from '../src/engine/generator';
import { createWorld, setObjectives } from '../src/engine/world';
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
        // the managers go straight back out after the half-time break
        if (m.htBreak) m.resume(0);
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

describe('live commentary', () => {
  it('sends the action on screen with every frame, shots with how they end', () => {
    const m = new LiveMatch(synthSetup(74, 68, 21), [false, false]);
    const kinds = new Set<string>();
    const ends = new Set<string>();
    let goals = 0;
    while (!m.ended) {
      m.tick(100, 5700 / 300);
      const fr = m.frame();
      if (fr.ac) {
        kinds.add(fr.ac.k);
        if (fr.ac.r) ends.add(fr.ac.r);
        expect(fr.ac.u).toBeGreaterThanOrEqual(0);
        expect(fr.ac.u).toBeLessThanOrEqual(100);
      }
      goals = fr.sc[0] + fr.sc[1];
    }
    for (const k of ['pass', 'shot', 'goalkick']) expect(kinds.has(k)).toBe(true);
    expect(ends.size).toBeGreaterThan(1);
    if (goals > 0) expect(ends.has('goal')).toBe(true);
  });
});

describe('season-end housekeeping', () => {
  it('brings a loaned player whose contract ends back to his club before deciding on it', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const [a, b] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    const p = squadOf(s, a.id)[0];
    p.clubId = b.id;
    p.loan = { from: a.id, until: (s.meta.season + 1) * 100 + 30 };
    p.contractEnd = s.meta.season;
    endSeason(s, rng, new Set());
    expect(p.loan).toBeNull();
    // back at his club, which kept him or let him go (and then another club may have signed him as a free agent)
    expect(p.clubId === null || p.clubId === a.id || p.joined === s.meta.season).toBe(true);
    if (p.clubId != null) expect(p.contractEnd).toBeGreaterThanOrEqual(s.meta.season);
    // nobody starts the new season with an expired contract
    expect(Object.values(s.players).filter((x) => x.clubId != null && !x.junior && x.contractEnd < s.meta.season)).toHaveLength(0);
  });

  it('always leaves every club with two goalkeepers', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA2')!;
    for (const p of squadOf(s, club.id)) if (p.pos === 'GOL') p.clubId = null;
    for (const p of Object.values(s.players)) if (p.clubId == null && p.pos === 'GOL') delete s.players[p.id];
    ensureKeepers(s, rng, club);
    expect(squadOf(s, club.id).filter((p) => p.pos === 'GOL').length).toBeGreaterThanOrEqual(2);
  });

  it('settles a youth team left behind at a club the manager has left', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    expect(juniorsOf(s, club.id).length).toBeGreaterThan(0);
    fireManager(s, m, 'teste');
    endSeason(s, rng, new Set());
    expect(juniorsOf(s, club.id)).toHaveLength(0);
  });

  it('gives a manager who won a trophy at the club half the blame', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    m.since -= 300;
    s.history.push({ season: s.meta.season - 1, champions: { BRA1: club.id }, topScorers: {} });
    club.board.goal = 'titulo';
    club.board.conf = 45;
    seasonVerdict(s, club, 12, 20, new Set([m.id]));
    expect(m.clubId).toBe(club.id);
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
    Object.values(s.players)[10].joined = s.meta.season;
    s.h2h = { '1-2': [1, 0, 2, 3, 4] };
    const bytes = await saveToBytes(s);
    expect(bytes.length).toBeLessThan(600 * 1024);
    const back = await loadFromBytes(bytes);
    expect(Object.keys(back.players).length).toBe(Object.keys(s.players).length);
    expect(back.meta.date).toBe(s.meta.date);
    const p = Object.values(s.players)[10];
    expect(back.players[p.id].name).toBe(p.name);
    expect(back.players[p.id].s).toEqual(p.s);
    expect(back.players[p.id].joined).toBe(s.meta.season);
    expect(back.h2h).toEqual(s.h2h);
    const f = Object.values(s.fixtures).find((x) => x.hg != null)!;
    expect(back.fixtures[f.id].hg).toBe(f.hg);
  });

  it('rejects files that are not saves', async () => {
    await expect(loadFromBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe('derbies and career records', () => {
  it('makes the big clubs of a city rivals and keeps the head-to-head and career records', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const [a, b, c] = Object.values(s.clubs).filter((x) => x.league === 'BRA1');
    b.city = a.city;
    expect(isDerby(s, a.id, b.id)).toBe(true);
    expect(isDerby(s, a.id, c.id)).toBe(false);
    expect(rivalsOf(s, a.id).map((x) => x.id)).toContain(b.id);
    const m = createManager(s, rng, 'A', a.id);
    const base = Object.values(s.fixtures).find((f) => f.comp === 'BRA1')!;
    const fx = { ...base, home: a.id, away: b.id, hg: 3, ag: 1 };
    recordHeadToHead(s, fx);
    recordCareer(s, fx);
    expect(headToHead(s, a.id, b.id)).toEqual([1, 0, 0, 3, 1]);
    expect(headToHead(s, b.id, a.id)).toEqual([0, 0, 1, 1, 3]);
    expect(m.rec).toMatchObject({ p: 1, w: 1, gf: 3, ga: 1, derbies: [1, 0, 0] });
    expect(m.rec?.bigWin).toMatchObject({ gf: 3, ga: 1, opp: b.id });
  });

  it('a derby moves the fans more than an ordinary match', () => {
    const s = world();
    const [a, b, c] = Object.values(s.clubs).filter((x) => x.league === 'BRA1');
    b.city = a.city;
    const base = Object.values(s.fixtures).find((f) => f.comp === 'BRA1')!;
    a.fans = 60;
    boardAfterMatch(s, { ...base, home: a.id, away: c.id, hg: 0, ag: 2 });
    const ordinary = 60 - a.fans!;
    a.fans = 60;
    boardAfterMatch(s, { ...base, home: a.id, away: b.id, hg: 0, ag: 2 });
    const derby = 60 - a.fans!;
    expect(derby).toBeGreaterThan(ordinary * 1.8);
  });
});

describe('player stature', () => {
  it('a star refuses a much smaller club, and a veteran comes home', () => {
    const s = world();
    const season = s.meta.season;
    const eng = Object.values(s.clubs)
      .filter((x) => x.league === 'ENG1')
      .sort((x, y) => y.rep - x.rep);
    const small = Object.values(s.clubs)
      .filter((x) => x.league === 'BRA2')
      .sort((x, y) => x.rep - y.rep)[0];
    const star = squadOf(s, eng[0].id)[0];
    star.str = 88;
    star.birth = season - 26;
    star.nat = 'ENG';
    expect(refusesClub(s, star, small)).toBeTruthy();
    expect(statureGap(s, star, eng[0])).toBe(0);
    // a 34-year-old Brazilian, from a mid-table English club to a big club back home: no problem
    const vet = squadOf(s, eng[5].id)[1];
    vet.str = 76;
    vet.birth = season - 34;
    vet.nat = 'BRA';
    const bra = Object.values(s.clubs)
      .filter((x) => x.league === 'BRA1')
      .sort((x, y) => y.rep - x.rep)[3];
    expect(statureGap(s, vet, bra)).toBe(0);
    // a club a little below his standing: he comes, for a higher wage
    const mid = Object.values(s.clubs).find((x) => statureGap(s, star, x) > 2 && statureGap(s, star, x) <= STATURE_MAX_GAP);
    if (mid) {
      const plain = wageDemand(s, star, mid) / (1 + 0.05 * statureGap(s, star, mid));
      expect(wageDemand(s, star, mid)).toBeGreaterThan(plain);
    }
  });

  it('a pre-contract with a club far below the player is refused', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const small = Object.values(s.clubs)
      .filter((x) => x.league === 'BRA3')
      .sort((x, y) => x.rep - y.rep)[0];
    const m = createManager(s, rng, 'A', small.id);
    const big = Object.values(s.clubs)
      .filter((x) => x.league === 'ESP1')
      .sort((x, y) => y.rep - x.rep)[0];
    const star = squadOf(s, big.id)[0];
    star.str = 86;
    star.birth = s.meta.season - 27;
    star.contractEnd = s.meta.season;
    s.meta.date = PRE_CONTRACT_FROM;
    const r = runCommand(s, m.id, { c: 'preContract', pid: star.id, wage: star.wage * 5, years: 3 });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/clube maior/);
  });
});

describe('transfer deadline day', () => {
  it('sends late bids on the eve, which can only be answered on deadline day', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const d = s.calendar.findIndex((_, i) => deadlineDay(s, i));
    expect(d).toBeGreaterThan(0);
    const club = Object.values(s.clubs)
      .filter((x) => x.league === 'BRA1')
      .sort((x, y) => y.rep - x.rep)[0];
    createManager(s, rng, 'A', club.id);
    s.meta.date = d - 1;
    for (let i = 0; i < 6; i++) aiTransfers(s, Rng.fromSeed(`eve${i}`));
    const late = Object.values(s.bids).filter((b) => b.seller === club.id);
    expect(late.length).toBeGreaterThan(0);
    for (const b of late) {
      expect(b.late).toBe(true);
      expect(b.date).toBe(d);
      expect(bidDeadline(b)).toBe(d);
    }
    // deadline day ends: they expire with the window
    s.meta.date = d;
    expireBids(s);
    expect(late.every((b) => b.status === 'expirada')).toBe(true);
  });
});

describe('season review and training centre', () => {
  it('writes a review of each human manager season, with a team of the season', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((x) => x.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    playDates(s, 12);
    endSeason(s, new Rng(s.meta.rng), new Set([m.id]));
    const r = s.reviews?.find((x) => x.manager === m.id);
    expect(r).toBeTruthy();
    expect(r!.clubId).toBe(club.id);
    expect(r!.pos).toBeGreaterThan(0);
    expect(r!.record[0] + r!.record[1] + r!.record[2]).toBeGreaterThan(0);
    expect(r!.team).toHaveLength(11);
    expect(r!.team.filter((p) => p.pos === 'GOL')).toHaveLength(1);
  });

  it('the board pays part of the training-centre works when it trusts the manager', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((x) => x.league === 'BRA1' && x.tc.level < 5)!;
    const m = createManager(s, rng, 'A', club.id);
    club.board.conf = 70;
    expect(tcClubCost(club)).toBe(Math.round(tcUpgradeCost(club) * 0.5));
    club.board.conf = 20;
    expect(tcClubCost(club)).toBe(tcUpgradeCost(club));
    club.board.conf = 70;
    club.balance = tcUpgradeCost(club);
    const before = club.balance;
    expect(runCommand(s, m.id, { c: 'upgradeTC' }).ok).toBe(true);
    expect(before - club.balance).toBe(Math.round(before * 0.5));
  });
});

describe('board ultimatum', () => {
  const setup = () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    return { s, rng, club, m, present: new Set([m.id]) };
  };

  it('a new manager is only warned; after the grace period the last warning is a points target', () => {
    const { s, rng, club, m, present } = setup();
    club.board.conf = 10;
    boardChecks(s, rng, present);
    expect(club.managerId).toBe(m.id);
    expect(club.board.ult).toBeUndefined();
    m.since = 0; // long past the grace period
    club.board.conf = 10;
    boardChecks(s, rng, present);
    // not sacked on the spot: an ultimatum first
    expect(club.managerId).toBe(m.id);
    const u = club.board.ult!;
    expect(u).toBeTruthy();
    expect(u.games).toBe(5);
    expect(u.need).toBeGreaterThanOrEqual(3);
    expect(u.need).toBeLessThanOrEqual(10);
    expect(s.news.some((n) => n.text.includes(`faça pelo menos ${u.need} pontos nos próximos 5 jogos`))).toBe(true);
    // still below the sacking line while it runs: no sack
    club.board.conf = 5;
    boardChecks(s, rng, present);
    expect(club.managerId).toBe(m.id);
    // he meets it: kept, with the board's trust back
    u.played = 3;
    u.pts = u.need;
    boardChecks(s, rng, present);
    expect(club.managerId).toBe(m.id);
    expect(club.board.ult).toBeUndefined();
    expect(club.board.conf).toBeGreaterThanOrEqual(32);
  });

  it('counts the matches as they are played and sacks the manager who misses the target', () => {
    const { s, rng, club, m, present } = setup();
    m.since = 0;
    club.board.conf = 10;
    boardChecks(s, rng, present);
    const u = club.board.ult!;
    const base = Object.values(s.fixtures).find((f) => f.comp === 'BRA1')!;
    const opp = Object.values(s.clubs).find((c) => c.league === 'BRA1' && c.id !== club.id)!;
    boardAfterMatch(s, { ...base, home: club.id, away: opp.id, hg: 2, ag: 0 });
    expect(u).toMatchObject({ played: 1, pts: 3 });
    for (let i = 0; i < 4; i++) boardAfterMatch(s, { ...base, home: club.id, away: opp.id, hg: 0, ag: 1 });
    expect(u).toMatchObject({ played: 5, pts: 3 });
    boardChecks(s, rng, present);
    expect(club.managerId).toBeNull();
    expect(m.history.at(-1)!.note).toMatch(/ultimato não cumprido/);
  });
});

describe('player development and the AI squads', () => {
  it('world class comes slowly, even for the best prospects', () => {
    expect(ELITE_GROWTH(78)).toBe(1);
    expect(ELITE_GROWTH(85)).toBeCloseTo(8 / 13, 3);
    expect(ELITE_GROWTH(90)).toBeLessThan(0.25);
  });

  it('a better academy turns up more promising youngsters, and big academies start below the first team', () => {
    const r0 = Rng.fromSeed('acad');
    const r5 = Rng.fromSeed('acad');
    let plain = 0;
    let best = 0;
    for (let i = 0; i < 2000; i++) {
      plain += starsFor(60, 16, r0, 0);
      best += starsFor(60, 16, r5, 5);
    }
    expect(best).toBeGreaterThan(plain);
    const big = { rep: 97, country: 'ENG' };
    expect(academyLevel(big)).toBeLessThan(fillerLevel(big) - 4);
    const small = { rep: 40, country: 'BRA' };
    expect(academyLevel(small)).toBe(fillerLevel(small));
  });

  it('AI clubs keep nearly all their starters when their contracts end', () => {
    const s = world();
    const season = s.meta.season;
    const idx = squadIndex(s);
    const starters: { id: number; club: number }[] = [];
    for (const c of Object.values(s.clubs)) {
      if (!c.league) continue;
      for (const p of [...(idx.get(c.id) ?? [])].sort((a, b) => b.str - a.str).slice(0, 11)) {
        if (age(p, season) >= 32 || p.loan) continue;
        p.contractEnd = season;
        starters.push({ id: p.id, club: c.id });
      }
    }
    endSeason(s, new Rng(s.meta.rng), new Set());
    const kept = starters.filter((x) => s.players[x.id]?.clubId === x.club).length;
    expect(kept / starters.length).toBeGreaterThan(0.82);
  });
});

describe('coaches and the coaching ranking', () => {
  it('every club has a named coach, real ones from the database first', () => {
    const db = synthDb();
    db.clubs[0].coach = 'Fulano de Tal';
    db.clubs[0].coachNat = 'POR';
    const s = createWorld(db, { name: 'test', seed: 'coach-seed' });
    for (const c of Object.values(s.clubs)) {
      const coach = s.coaches![c.coachId!];
      expect(coach).toBeTruthy();
      expect(coach.clubId).toBe(c.id);
      expect(coach.name.length).toBeGreaterThan(3);
    }
    const first = Object.values(s.clubs).find((c) => c.key === db.clubs[0].key)!;
    expect(s.coaches![first.coachId!]).toMatchObject({ name: 'Fulano de Tal', nat: 'POR', real: true });
  });

  it('a human takes over from the AI coach, and results, titles and awards add up in the ranking', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const [club, opp] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    const old = s.coaches![club.coachId!];
    const m = createManager(s, rng, 'A', club.id);
    expect(club.coachId).toBeNull();
    expect(old.clubId).toBeNull();
    const cfg = s.comps.BRA1.cfg;
    const base = Object.values(s.fixtures).find((f) => f.comp === 'BRA1')!;
    rankMatch(s, { ...base, home: club.id, away: opp.id, hg: 2, ag: 0 });
    rankMatch(s, { ...base, home: opp.id, away: club.id, hg: 1, ag: 1 });
    expect(m.rank).toMatchObject({ p: 2, w: 1, d: 1, l: 0 });
    expect(m.rank!.pts).toBeCloseTo(matchWeight(cfg) * 1.35, 1);
    const oppCoach = s.coaches![opp.coachId!];
    expect(oppCoach.rec).toMatchObject({ p: 2, w: 0, d: 1, l: 1 });
    rankTitle(s, cfg, club.id);
    rankAward(s, club, 2);
    expect(m.rank).toMatchObject({ titles: 1, awards: 1 });
    expect(m.rank!.pts).toBeCloseTo(matchWeight(cfg) * 1.35 + titleWeight(cfg) + 2, 1);
    const ranking = coachRanking(s);
    expect(ranking[0].managerId).toBe(m.id);
    // the human is sacked: an AI coach takes over the club
    fireManager(s, m, 'teste');
    expect(club.coachId).not.toBeNull();
    expect(s.coaches![club.coachId!].clubId).toBe(club.id);
  });

  it('an AI club that sacks its coach hires another, and a played round counts for the ranking', () => {
    const s = world();
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const old = s.coaches![club.coachId!];
    sackCoach(s, new Rng(s.meta.rng), club);
    expect(old.clubId).toBeNull();
    expect(club.coachId).not.toBe(old.id);
    expect(s.coaches![club.coachId!].clubId).toBe(club.id);
    expect(s.news.some((n) => n.text.includes(`demite ${old.name}`))).toBe(true);
    playDates(s, 6);
    const ranking = coachRanking(s);
    expect(ranking.length).toBeGreaterThan(20);
    expect(ranking[0].rec.pts).toBeGreaterThan(0);
    expect(ranking.every((r, i) => i === 0 || ranking[i - 1].rec.pts >= r.rec.pts)).toBe(true);
  });
});

describe('flanks, attack focus and pitch condition', () => {
  it('a player on his wrong flank loses a little; in the middle it does not matter', () => {
    const p = { id: 1, pos: 'LAT' as const, str: 80, fitness: 100, morale: 60, traits: [], flank: 'L' as const };
    const left = effective(p, 'LAT', 0.12);
    const right = effective(p, 'LAT', 0.88);
    expect(laneOf(0.12)).toBe(0);
    expect(laneOf(0.88)).toBe(2);
    expect(right).toBeLessThan(left);
    expect(right / left).toBeGreaterThan(0.9);
    const c = { ...p, pos: 'ZAG' as const };
    expect(effective(c, 'ZAG', 0.37)).toBe(effective(c, 'ZAG', 0.63));
  });

  it('every player has a flank, and squads have full-backs for both sides', () => {
    const s = world();
    expect(Object.values(s.players).every((p) => p.flank === 'L' || p.flank === 'R' || p.flank === 'C')).toBe(true);
    const idx = squadIndex(s);
    for (const c of Object.values(s.clubs).filter((x) => x.league === 'BRA1')) {
      const lats = (idx.get(c.id) ?? []).filter((p) => p.pos === 'LAT');
      if (lats.length >= 2) expect(new Set(lats.map((p) => p.flank)).size).toBe(2);
    }
  });

  it('the attack focus steers most of the play in the final third through its channel', () => {
    const share = (focus: 'meio' | 'lados' | undefined) => {
      let wide = 0;
      let all = 0;
      for (let i = 0; i < 12; i++) {
        const st = synthSetup(70, 70, 900 + i);
        if (focus) st.home.tactics.focus = focus;
        const sim = new MatchSim(st);
        while (!sim.ended) {
          sim.step(1);
          if (sim.poss === 0 && sim.progress(0, sim.ball.x) > 0.7) {
            all++;
            if (Math.abs(sim.ball.y / 68 - 0.5) > 0.22) wide++;
          }
        }
      }
      return wide / all;
    };
    const free = share(undefined);
    const flanks = share('lados');
    const middle = share('meio');
    expect(flanks).toBeGreaterThan(free + 0.1);
    expect(middle).toBeLessThan(free - 0.1);
  });

  it('pitches wear with home matches and recover with care; a poor pitch tires the players more', () => {
    const s = world();
    const [a, b] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    for (const c of [a, b]) {
      c.pitch = 60;
      c.managerId = 'x';
    }
    a.pitchCare = 'premium';
    b.pitchCare = 'basico';
    pitchRound(s, new Set());
    expect(a.pitch! - 60).toBeGreaterThan(b.pitch! - 60);
    const before = a.pitch!;
    pitchRound(s, new Set([a.id]));
    expect(a.pitch!).toBeLessThan(before + 2);
    expect(pitchLevel(90)).toBe(0);
    expect(pitchLevel(20)).toBe(3);
    expect(PITCH_FX[3].drain).toBeGreaterThan(1);
    let good = 0;
    let bad = 0;
    for (let i = 0; i < 6; i++) {
      for (const pitch of [90, 20]) {
        const st = synthSetup(70, 70, 400 + i);
        st.pitch = pitch;
        // no coaches' changes: only the pitch differs (substitutes would muddy the energy totals)
        st.home.ai = false;
        st.away.ai = false;
        const r = new MatchSim(st).runToEnd();
        const fit = Object.values(r.players).reduce((x, p) => x + p.fitness, 0);
        if (pitch === 90) good += fit;
        else bad += fit;
      }
    }
    expect(bad).toBeLessThan(good);
  });
});

describe('contracts, growth, scouting, careers and injuries', () => {
  it('a player is worth less as his contract runs out; his wage demand does not change', () => {
    const s = world();
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const p = squadOf(s, club.id).sort((a, b) => b.str - a.str)[0];
    const season = s.meta.season;
    p.contractEnd = season + 3;
    const full = marketValue(p, s);
    expect(full).toBe(playerValue(p, season));
    p.contractEnd = season;
    s.meta.date = 70;
    const late = marketValue(p, s);
    expect(late / full).toBeLessThan(0.6);
    expect(late / full).toBeGreaterThan(0.45);
    expect(contractFactor(p, season, 0, 78)).toBeGreaterThan(contractFactor(p, season, 70, 78));
    expect(expectedWage(p, season, club.rep)).toBe(expectedWage({ ...p, contractEnd: season + 3 }, season, club.rep));
  });

  it('a talent well above his club grows more slowly there', () => {
    expect(clubGrowthFactor({ str: 70, junior: false }, { power: 70 })).toBe(1);
    expect(clubGrowthFactor({ str: 80, junior: false }, { power: 70 })).toBeCloseTo(0.5, 5);
    expect(clubGrowthFactor({ str: 90, junior: false }, { power: 70 })).toBe(0.35);
    const s = world();
    const clubs = Object.values(s.clubs).filter((c) => c.league);
    const big = clubs.sort((a, b) => b.power - a.power)[0];
    const small = clubs[clubs.length - 1];
    const [a, b] = [squadOf(s, big.id)[3], squadOf(s, small.id)[3]];
    for (const p of [a, b]) {
      p.str = big.power - 2;
      p.birth = s.meta.season - 18;
      p.stars = 5;
      p.pot = 91;
      p.s.apps = 0;
    }
    for (let i = 0; i < 30; i++) {
      s.meta.date = i + 1;
      dailyPlayers(s, Rng.fromSeed(`g${i}`), new Set());
    }
    expect(a.str - (big.power - 2)).toBeGreaterThan(b.str - (big.power - 2));
  });

  it("a young player's potential is a scout's estimate until his own club knows him", () => {
    const s = world();
    const season = s.meta.season;
    const [c1, c2] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    const p = squadOf(s, c1.id)[5];
    p.birth = season - 18;
    p.stars = 3;
    p.potErr = 1;
    // another club sees the estimate
    expect(potentialSeen(p, c2.id, season)).toMatchObject({ stars: 4, exact: false });
    // his own club learns him round by round (faster with a better training centre)
    let rounds = 0;
    while (!potentialSeen(p, c1.id, season).exact && rounds < 200) {
      scoutRound(p, season, 5);
      rounds++;
    }
    expect(rounds).toBeGreaterThan(30);
    expect(rounds).toBeLessThan(60);
    expect(potentialSeen(p, c1.id, season)).toMatchObject({ stars: 3, exact: true });
    // a move starts it again
    p.clubId = c2.id;
    scoutRound(p, season, 1);
    expect(potentialSeen(p, c2.id, season).exact).toBe(false);
    // from 24 everyone sees it
    p.birth = season - 24;
    expect(potentialSeen(p, c1.id, season)).toMatchObject({ stars: 3, exact: true });
  });

  it('keepers and great players have longer careers; older and tired players get longer injuries', () => {
    expect(careerBonus({ pos: 'GOL', str: 70 })).toBe(3);
    expect(careerBonus({ pos: 'ATA', str: 85 })).toBe(1);
    expect(careerBonus({ pos: 'GOL', str: 85 })).toBe(4);
    expect(careerBonus({ pos: 'MEI', str: 70 })).toBe(0);
    expect(injuryAgeRisk(28)).toBe(1);
    expect(injuryAgeRisk(35)).toBeCloseTo(1.3, 5);
    expect(injuryLength(25, 90)).toBe(1);
    expect(injuryLength(33, 50)).toBeCloseTo(1.2 * 1.3, 5);
  });
});

describe('match engine: keepers, routs, own goals, cards and cup rotation', () => {
  it('keepers barely tire, routs are rarer, and about 3% of goals are own goals', () => {
    let gkFit = 0;
    let outFit = 0;
    let goals = 0;
    let og = 0;
    let routs = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const st = synthSetup(85, 60, 7000 + i);
      const sim = new MatchSim(st);
      const r = sim.runToEnd();
      gkFit += r.players[st.home.players[0].id].fitness;
      outFit += r.players[st.home.players[5].id].fitness;
      goals += r.hg + r.ag;
      og += sim.goals.filter((g) => g.og).length;
      if (r.hg - r.ag >= 7) routs++;
      // an own goal is credited to a player of the side that conceded, and not as his goal
      for (const g of sim.goals.filter((x) => x.og)) {
        const p = sim.player(g.pid)!;
        expect(p.side).toBe(1 - g.side);
        expect(r.players[g.pid].goals).toBe(sim.goals.filter((x) => x.pid === g.pid && !x.og).length);
      }
    }
    expect(gkFit / n).toBeGreaterThan(outFit / n + 4);
    expect(og / goals).toBeGreaterThan(0.01);
    expect(og / goals).toBeLessThan(0.07);
    expect(routs / n).toBeLessThan(0.03);
  });

  it('a second yellow is a one-match ban; a straight red usually one or two, rarely more', () => {
    const rng = Rng.fromSeed('bans');
    const bans = Array.from({ length: 4000 }, () => banLength(rng));
    const share = (k: number) => bans.filter((b) => b === k).length / bans.length;
    expect(share(1)).toBeGreaterThan(0.5);
    expect(share(2)).toBeGreaterThan(0.2);
    expect(share(4) + share(5)).toBeGreaterThan(0.02);
    expect(share(4) + share(5)).toBeLessThan(0.1);
    expect(Math.max(...bans)).toBe(5);
  });

  it('an AI favourite rests starters early in a national cup against a much weaker side', () => {
    const s = world();
    const cup = Object.values(s.comps).find((c) => c.cfg.kind === 'cup' && c.cfg.scope === 'national')!;
    const big = Object.values(s.clubs).filter((c) => c.league === 'BRA1').sort((a, b) => b.power - a.power)[0];
    const small = Object.values(s.clubs).filter((c) => c.league === 'BRA3').sort((a, b) => a.power - b.power)[0];
    const base = Object.values(s.fixtures).find((f) => f.comp === cup.id) ?? Object.values(s.fixtures)[0];
    const f = { ...base, comp: cup.id, home: small.id, away: big.id, stage: 0 };
    const squad = squadOf(s, big.id);
    expect(big.power - small.power).toBeGreaterThanOrEqual(8);
    const rested = cupRotation(s, f, big, squad, small);
    expect(rested.length).toBeGreaterThanOrEqual(3);
    expect(rested.every((p) => p.pos !== 'GOL')).toBe(true);
    // the best players are the ones rested
    const best = [...squad].filter((p) => p.pos !== 'GOL').sort((a, b) => b.str - a.str)[0];
    expect(rested).toContain(best);
    // not in a league match, and not when the sides are close
    expect(cupRotation(s, { ...f, comp: 'BRA1' }, big, squad, small)).toHaveLength(0);
    const near = Object.values(s.clubs).filter((c) => c.league === 'BRA1').sort((a, b) => b.power - a.power)[1];
    expect(cupRotation(s, { ...f, home: near.id }, big, squad, near)).toHaveLength(0);
  });
});

describe('five-season check fixes', () => {
  it('a club that sacked a manager does not offer him its job again for a season', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const club = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', club.id);
    m.rep = 90;
    fireManager(s, m, 'teste');
    offerJob(s, rng, club);
    expect(m.offers.some((o) => o.clubId === club.id)).toBe(false);
    for (let i = 0; i < 40; i++) boardChecks(s, rng, new Set([m.id]));
    expect(m.offers.some((o) => o.clubId === club.id)).toBe(false);
    // two seasons on, the club may call again
    s.meta.season += 2;
    offerJob(s, rng, club);
    expect(m.offers.some((o) => o.clubId === club.id)).toBe(true);
  });

  it('does not blame a manager who arrived after the halfway point for the season objective', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const [late, early] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    const ml = createManager(s, rng, 'A', late.id);
    const me = createManager(s, rng, 'B', early.id);
    ml.since = s.meta.season * 100 + Math.ceil(s.calendar.length * 0.6);
    me.since = s.meta.season * 100 + 10;
    for (const c of [late, early]) {
      c.board.goal = 'titulo';
      c.board.conf = 30;
    }
    seasonVerdict(s, late, 15, 20, new Set([ml.id, me.id]));
    seasonVerdict(s, early, 15, 20, new Set([ml.id, me.id]));
    expect(ml.clubId).toBe(late.id);
    expect(late.board.conf).toBe(30);
    // one who was there from early on still answers for it (half the blame in his first season)
    expect(me.clubId).toBeNull();
  });

  it('AI clubs extend their young core players before the final year of a contract, not the rest', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const next = s.meta.season + 1;
    const core: number[] = [];
    const rest: number[] = [];
    for (const c of Object.values(s.clubs).filter((x) => x.league === 'BRA1' || x.league === 'ENG1')) {
      const sq = squadOf(s, c.id).filter((p) => !p.loan).sort((a, b) => b.str - a.str);
      const star = sq.find((p) => age(p, s.meta.season) < 29);
      const fringe = sq[sq.length - 3];
      if (!star || !fringe || star === fringe) continue;
      star.contractEnd = next;
      fringe.contractEnd = next;
      core.push(star.id);
      rest.push(fringe.id);
    }
    endSeason(s, rng, new Set());
    const extended = (ids: number[]) => ids.filter((id) => s.players[id] && s.players[id].contractEnd > next).length / ids.length;
    expect(extended(core)).toBeGreaterThan(0.5);
    expect(extended(rest)).toBe(0);
  });

  it('a new world starts with few young core players in the final year of a contract', () => {
    const s = world();
    let core = 0;
    let lastYear = 0;
    for (const sq of squadIndex(s).values()) {
      for (const p of [...sq].sort((a, b) => b.str - a.str).slice(0, 6)) {
        if (age(p, s.meta.season) >= 30) continue;
        core++;
        if (p.contractEnd === s.meta.season) lastYear++;
      }
    }
    // a quarter of all contracts end in the first season; for the young core, a quarter of that
    expect(core).toBeGreaterThan(100);
    expect(lastYear / core).toBeLessThan(0.12);
  });

  it('asks the weakest clubs of a division with nothing below it for a respectable season, not mid-table', () => {
    const s = world();
    setObjectives(s);
    const lg = s.config.find((c) => c.kind === 'league' && (c.level ?? 1) > 1 && !c.down && Object.values(s.clubs).some((x) => x.league === c.id))!;
    const clubs = Object.values(s.clubs).filter((c) => c.league === lg.id).sort((a, b) => a.power - b.power || a.rep - b.rep);
    expect(clubs[0].board.goal).toBe('digno');
    expect(Object.values(s.clubs).some((c) => c.league === 'BRA3' && c.board.goal === 'rebaixamento')).toBe(true);
    const n = clubs.length;
    expect(objectiveDelta('digno', n - 2, n)).toBeGreaterThan(0);
    expect(objectiveDelta('digno', n, n)).toBeLessThan(0);
  });

  it('keeps a club with a human manager in Série C, the last national division, and sends the next club down', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const bra3 = Object.values(s.clubs).filter((c) => c.league === 'BRA3');
    const club = bra3[0];
    const m = createManager(s, rng, 'A', club.id);
    // the human's club last, everyone else in table order
    bra3.forEach((c, i) => {
      const w = c.id === club.id ? 0 : 30 - i;
      s.comps.BRA3.table[c.id] = { p: 30, w, d: 0, l: 30 - w, gf: w, ga: 30 - w, pts: 3 * w };
    });
    club.board.conf = 100;
    endSeason(s, rng, new Set([m.id]));
    expect(m.clubId).toBe(club.id);
    expect(club.league).toBe('BRA3');
    // still four clubs out and four in, so the division keeps its size
    expect(bra3.filter((c) => c.league == null)).toHaveLength(4);
    expect(Object.values(s.clubs).filter((c) => c.league === 'BRA3')).toHaveLength(20);
    expect(s.news.some((n) => n.to === m.id && n.text.includes('Não há divisão nacional abaixo'))).toBe(true);
  });
});

describe('management, AI spending and congestion', () => {
  it('the AI coach plans against how a human lined up last time, never his team sheet for the match', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const league = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
    const me = league[0];
    const m = createManager(s, rng, 'A', me.id);
    const f = Object.values(s.fixtures).find((x) => x.comp === 'BRA1' && (x.home === me.id || x.away === me.id))!;
    const opp = s.clubs[f.home === me.id ? f.away : f.home];
    const plan = () => aiPreMatchTactics(s, f, opp, squadOf(s, opp.id), me, squadOf(s, me.id), true);
    const before = plan();
    // the human changes his team sheet: the AI's plan does not move
    me.tactics = { ...me.tactics, mentality: 'ofensiva', marking: 'pressao', style: 'toque' };
    expect(plan()).toEqual(before);
    // once he has played that way, the next coach knows it: against a side that pushes forward, it counter-attacks
    me.shown = { tactics: { ...me.tactics, mentality: 'ofensiva', style: 'toque', marking: 'zona' }, xi: me.lineup.xi };
    expect(plan().style).toBe('contra');
    void m;
  });

  it('records how a human side lined up for the next opponents', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const me = Object.values(s.clubs).find((c) => c.league === 'BRA1')!;
    const m = createManager(s, rng, 'A', me.id);
    me.tactics = { ...me.tactics, mentality: 'defensiva', style: 'contra' };
    const first = Math.min(...Object.values(s.fixtures).filter((x) => x.home === me.id || x.away === me.id).map((x) => x.date));
    playDates(s, first + 1, new Set([m.id]));
    expect(me.shown?.tactics).toMatchObject({ mentality: 'defensiva', style: 'contra' });
    expect(me.shown?.xi.filter((x) => x != null).length).toBe(11);
  });

  it('recovers energy by days of rest: less before a Wednesday match than before a Sunday one', () => {
    const s = world();
    const sun = s.calendar.findIndex((c, i) => c.wd === 'dom' && restDays(s, i) === 3);
    const wed = s.calendar.findIndex((c, i) => c.wd === 'qua' && restDays(s, i) === 4);
    expect(sun).toBeGreaterThanOrEqual(0);
    expect(wed).toBeGreaterThanOrEqual(0);
    const gain = (date: number) => {
      s.meta.date = date;
      const p = Object.values(s.players).find((x) => x.clubId != null && x.injury === 0)!;
      p.fitness = 50;
      dailyPlayers(s, Rng.fromSeed('rest'), new Set());
      return p.fitness - 50;
    };
    expect(gain(sun)).toBeLessThan(gain(wed));
    // a week off (the break after the state championships) brings much more back
    const brk = s.calendar.findIndex((_, i) => restDays(s, i) >= 7);
    expect(gain(brk)).toBeGreaterThan(gain(wed) * 1.5);
  });

  it('rich AI clubs raise their core players to what they are worth', () => {
    const s = world();
    const club = Object.values(s.clubs).find((c) => c.league === 'ENG1')!;
    club.balance = 50 * roughIncome(club);
    const core = squadOf(s, club.id).sort((a, b) => b.str - a.str).slice(0, 6);
    for (const p of core) p.wage = 1000;
    aiPayRises(s, squadIndex(s), s.meta.season + 1);
    for (const p of core) expect(p.wage).toBeGreaterThan(1000);
    // a club without money in the bank does not
    const poor = Object.values(s.clubs).find((c) => c.league === 'BRA3')!;
    poor.balance = 0;
    const p0 = squadOf(s, poor.id).sort((a, b) => b.str - a.str)[0];
    p0.wage = 1000;
    aiPayRises(s, squadIndex(s), s.meta.season + 1);
    expect(p0.wage).toBe(1000);
  });

  it('rich AI clubs sign players who walk into their first team', () => {
    const s = world();
    const rng = new Rng(s.meta.rng);
    const rich = Object.values(s.clubs).filter((c) => c.league === 'ENG1').sort((a, b) => b.power - a.power).slice(0, 6);
    for (const c of rich) c.balance = 40 * roughIncome(c);
    const before = new Map(rich.map((c) => [c.id, new Set(squadOf(s, c.id).map((p) => p.id))]));
    const weakest = new Map(rich.map((c) => [c.id, Math.min(...autoLineup(squadOf(s, c.id), c.tactics, null).xi.map((id) => s.players[id!].str))]));
    for (let d = 0; d < 20 && s.calendar[d]?.window; d++) {
      s.meta.date = d;
      aiTransfers(s, rng);
    }
    const signed = rich.flatMap((c) => squadOf(s, c.id).filter((p) => !before.get(c.id)!.has(p.id) && p.str > weakest.get(c.id)! + 1));
    expect(signed.length).toBeGreaterThan(0);
  });
});

describe('half-time team talk', () => {
  it('fits the moment: praise a side doing well, demand more from an underperforming favourite, encourage an underdog', () => {
    // winning without playing poorly
    expect(talkFit('elogiar', 1, 0, 6.7)).toBe(1);
    expect(talkFit('cobrar', 1, 0, 6.7)).toBe(-1);
    // a favourite level at the break
    expect(talkFit('cobrar', 0, 5, 6.6)).toBe(1);
    expect(talkFit('elogiar', 0, 5, 6.6)).toBe(-1);
    // behind against a stronger side
    expect(talkFit('incentivar', -1, -4, 6.5)).toBe(1);
    expect(talkFit('cobrar', -1, -4, 6.5)).toBe(-1);
    // a poor half without the lead: demand more, not praise
    expect(talkFit('cobrar', 0, 0, 6.2)).toBe(1);
    expect(talkFit('elogiar', 0, 0, 6.2)).toBe(-1);
  });

  it('is given once, at half-time, and changes the side for the second half', () => {
    const sim = new MatchSim(synthSetup(72, 72, 41));
    expect(sim.teamTalk(0, 'incentivar')).not.toBeNull();
    while (sim.half === 1) sim.step(20);
    const before = sim.sides[0].ratings.mid;
    expect(sim.teamTalk(0, 'elogiar')).toBeNull();
    expect(sim.teamTalk(0, 'cobrar')).not.toBeNull();
    const fx = sim.sides[0].talkFx;
    expect([TALK_TUNE.good, 1, TALK_TUNE.bad]).toContain(fx);
    expect(sim.sides[0].ratings.mid).toBeCloseTo(before * fx, 5);
    expect(sim.events.some((e) => e.kind === 'tactic' && e.text.startsWith('Preleção'))).toBe(true);
  });

  it('a live match with a human stops for the half-time break, which the talks end', () => {
    const m = new LiveMatch(synthSetup(72, 72, 43), [true, false]);
    let guard = 0;
    while (!m.paused && !m.ended && guard++ < 20000) m.tick(200, 60);
    expect(m.paused).toBe(true);
    expect(m.htBreak).toBe(true);
    expect(m.frame().ht).toBe(true);
    expect(m.talk(0, 'incentivar')).toBeNull();
    expect(m.paused).toBe(false);
    expect(m.detail().sides[0].talk).toBe('incentivar');
    expect(validMatchAction({ a: 'talk', kind: 'cobrar' })).toEqual({ a: 'talk', kind: 'cobrar' });
    expect(validMatchAction({ a: 'talk', kind: 'gritar' })).toBeNull();
  });
});
