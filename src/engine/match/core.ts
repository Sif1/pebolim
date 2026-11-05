import { Rng, type RngState } from '../rng';
import type { GoalEvent, Pos, Tactics, Trait } from '../types';
import { FORMATIONS, type Slot } from './formations';
import { computeRatings, effective, type RatedPlayer, type SectorRatings } from './ratings';

export const PITCH_W = 105;
export const PITCH_H = 68;
const HALF = 2700;
const FULL = 5400;

export interface MPlayerInit {
  id: number;
  name: string;
  num: number;
  pos: Pos;
  str: number;
  fitness: number;
  morale: number;
  traits: Trait[];
  /** fatigue multiplier (older players tire faster) */
  tire: number;
}

export interface MPlayer extends RatedPlayer {
  name: string;
  num: number;
  side: 0 | 1;
  tire: number;
  yellow: number;
  red: boolean;
  injured: boolean;
  injDates: number;
  goals: number;
  ast: number;
  /** game second the player came on, or null if never played */
  on: number | null;
  off: number | null;
}

export interface TeamSetup {
  clubId: number;
  name: string;
  short: string;
  colors: [string, string];
  tactics: Tactics;
  xi: (number | null)[];
  bench: number[];
  players: MPlayerInit[];
  /** true when the AI makes in-match decisions for this side */
  ai: boolean;
}

export interface MatchSetup {
  fixtureId: number;
  compId: string;
  home: TeamSetup;
  away: TeamSetup;
  seed: RngState;
  homeAdv: number;
  /** when set, a winner is required; aggregate goals from earlier legs, from this fixture's home/away view */
  decider: { aggHome: number; aggAway: number } | null;
}

export type MatchEventKind =
  | 'goal'
  | 'yellow'
  | 'red'
  | 'sub'
  | 'injury'
  | 'ht'
  | 'ft'
  | 'pens'
  | 'kickoff'
  | 'miss'
  | 'save'
  | 'tactic';

export interface MatchEvent {
  t: number;
  kind: MatchEventKind;
  side: 0 | 1;
  pid?: number;
  pid2?: number;
  text: string;
}

export type ActionKind =
  | 'pass'
  | 'back'
  | 'dribble'
  | 'long'
  | 'cross'
  | 'shot'
  | 'header'
  | 'kickoff'
  | 'goalkick'
  | 'throw'
  | 'corner'
  | 'freekick'
  | 'penalty'
  | 'celebrate'
  | 'save'
  | 'halftime';

export interface Vec {
  x: number;
  y: number;
}

export interface Action {
  kind: ActionKind;
  side: 0 | 1;
  actor: number | null;
  target: number | null;
  from: Vec;
  to: Vec;
  t0: number;
  t1: number;
  lofted: boolean;
}

type SetPiece = 'kickoff' | 'goalkick' | 'throw' | 'corner' | 'freekick' | 'penalty' | null;

interface Effects {
  poss: 0 | 1;
  carrier: number | null;
  ball: Vec;
  setPiece: SetPiece;
  goal?: { side: 0 | 1; pid: number; ast: number | null; pen?: boolean };
  events?: MatchEvent[];
  shot?: { side: 0 | 1; onTarget: boolean };
  corner?: 0 | 1;
  lastPasser?: number | null;
}

export interface SideStats {
  poss: number;
  shots: number;
  onTarget: number;
  corners: number;
  fouls: number;
  yel: number;
  red: number;
}

export interface MatchResult {
  fixtureId: number;
  hg: number;
  ag: number;
  pens: [number, number] | null;
  goals: GoalEvent[];
  players: Record<number, { side: 0 | 1; mins: number; goals: number; ast: number; yel: number; red: boolean; inj: number; fitness: number }>;
  stats: [SideStats, SideStats];
}

export interface SideState {
  setup: TeamSetup;
  tactics: Tactics;
  slots: Slot[];
  onPitch: (number | null)[];
  bench: number[];
  subs: number;
  players: Map<number, MPlayer>;
  ratings: SectorRatings;
  ai: boolean;
}

export const MAX_SUBS = 5;

const emptyStats = (): SideStats => ({ poss: 0, shots: 0, onTarget: 0, corners: 0, fouls: 0, yel: 0, red: 0 });

export class MatchSim {
  readonly setup: MatchSetup;
  readonly rng: Rng;
  sides: [SideState, SideState];
  t = 0;
  half: 1 | 2 = 1;
  added: [number, number];
  poss: 0 | 1 = 0;
  ball: Vec = { x: PITCH_W / 2, y: PITCH_H / 2 };
  carrier: number | null = null;
  score: [number, number] = [0, 0];
  pens: [number, number] | null = null;
  stats: [SideStats, SideStats] = [emptyStats(), emptyStats()];
  events: MatchEvent[] = [];
  goals: GoalEvent[] = [];
  action: Action | null = null;
  ended = false;
  private effects: Effects | null = null;
  private setPiece: SetPiece = 'kickoff';
  private lastPasser: number | null = null;
  private lastMinute = -1;

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.rng = new Rng(setup.seed);
    this.sides = [this.makeSide(setup.home, 0), this.makeSide(setup.away, 1)];
    this.added = [this.rng.int(0, 3) * 60, this.rng.int(2, 6) * 60];
    for (const s of this.sides) {
      for (const pid of s.onPitch) if (pid != null) s.players.get(pid)!.on = 0;
    }
    this.recalc();
    this.carrier = this.pickByPos(0, ['ATA', 'MEI']);
  }

  private makeSide(ts: TeamSetup, side: 0 | 1): SideState {
    const players = new Map<number, MPlayer>();
    for (const p of ts.players) {
      players.set(p.id, {
        ...p,
        traits: [...p.traits],
        side,
        yellow: 0,
        red: false,
        injured: false,
        injDates: 0,
        goals: 0,
        ast: 0,
        on: null,
        off: null,
      });
    }
    const slots = FORMATIONS[ts.tactics.formation];
    return {
      setup: ts,
      tactics: { ...ts.tactics },
      slots,
      onPitch: slots.map((_, i) => ts.xi[i] ?? null),
      bench: [...ts.bench],
      subs: 0,
      players,
      ratings: { gk: 50, def: 50, mid: 50, att: 50 },
      ai: ts.ai,
    };
  }

  // ---------- geometry ----------
  dir(side: 0 | 1): 1 | -1 {
    return (side === 0) === (this.half === 1) ? 1 : -1;
  }
  progress(side: 0 | 1, x: number): number {
    return this.dir(side) > 0 ? x / PITCH_W : 1 - x / PITCH_W;
  }
  toX(side: 0 | 1, u: number): number {
    const c = Math.min(0.995, Math.max(0.005, u));
    return this.dir(side) > 0 ? c * PITCH_W : (1 - c) * PITCH_W;
  }
  private clampY(y: number) {
    return Math.min(PITCH_H - 1, Math.max(1, y));
  }

  // ---------- public helpers ----------
  get clock(): number {
    return this.t;
  }
  minute(): number {
    return Math.floor(this.t / 60) + 1;
  }
  player(pid: number): MPlayer | undefined {
    return this.sides[0].players.get(pid) ?? this.sides[1].players.get(pid);
  }
  playersOnPitch(side: 0 | 1): MPlayer[] {
    const s = this.sides[side];
    return s.onPitch.filter((x): x is number => x != null).map((id) => s.players.get(id)!);
  }
  slotOf(side: 0 | 1, pid: number): number {
    return this.sides[side].onPitch.indexOf(pid);
  }

  recalc() {
    for (const s of this.sides) {
      s.ratings = computeRatings(
        s.slots,
        s.onPitch.map((id) => (id != null ? s.players.get(id)! : null)),
        s.tactics,
      );
    }
  }

  // ---------- control ----------
  /** Substitute; returns error message or null. */
  sub(side: 0 | 1, outId: number, inId: number): string | null {
    const s = this.sides[side];
    if (this.ended) return 'Partida encerrada';
    if (s.subs >= MAX_SUBS) return 'Limite de substituições atingido';
    const slot = s.onPitch.indexOf(outId);
    if (slot < 0) return 'Jogador não está em campo';
    const bi = s.bench.indexOf(inId);
    if (bi < 0) return 'Jogador não está no banco';
    const pin = s.players.get(inId)!;
    const pout = s.players.get(outId)!;
    s.onPitch[slot] = inId;
    s.bench.splice(bi, 1);
    s.subs++;
    pout.off = this.t;
    pin.on = this.t;
    if (this.carrier === outId) this.carrier = inId;
    this.events.push({ t: this.t, kind: 'sub', side, pid: inId, pid2: outId, text: `Sai ${pout.name}, entra ${pin.name}` });
    this.recalc();
    return null;
  }

  /** Move a player already on the pitch to another slot (swap). */
  swapSlots(side: 0 | 1, a: number, b: number) {
    const s = this.sides[side];
    [s.onPitch[a], s.onPitch[b]] = [s.onPitch[b], s.onPitch[a]];
    this.recalc();
  }

  setTactics(side: 0 | 1, t: Tactics) {
    const s = this.sides[side];
    if (t.formation !== s.tactics.formation) {
      const newSlots = FORMATIONS[t.formation];
      const current = s.onPitch.filter((x): x is number => x != null).map((id) => s.players.get(id)!);
      const assigned: (number | null)[] = newSlots.map(() => null);
      const pairs: { si: number; p: MPlayer; e: number }[] = [];
      newSlots.forEach((sl, si) => current.forEach((p) => pairs.push({ si, p, e: effective(p, sl.pos) })));
      pairs.sort((x, y) => y.e - x.e);
      const used = new Set<number>();
      for (const pr of pairs) {
        if (assigned[pr.si] != null || used.has(pr.p.id)) continue;
        assigned[pr.si] = pr.p.id;
        used.add(pr.p.id);
      }
      s.slots = newSlots;
      s.onPitch = assigned;
    }
    s.tactics = { ...t };
    this.events.push({ t: this.t, kind: 'tactic', side, text: `${s.setup.short}: ${t.formation}, ${t.mentality}` });
    this.recalc();
  }

  // ---------- simulation ----------
  /** Advance the game clock by dt seconds (live mode). */
  step(dt: number) {
    if (this.ended) return;
    const target = this.t + dt;
    while (!this.ended) {
      if (!this.action) {
        this.beginNext();
        continue;
      }
      if (this.action.t1 <= target) {
        this.t = this.action.t1;
        this.minuteTicks();
        this.finishAction();
      } else {
        this.t = target;
        this.minuteTicks();
        break;
      }
    }
  }

  /** Headless: play the whole match as fast as possible. */
  runToEnd(): MatchResult {
    let guard = 0;
    while (!this.ended && guard++ < 20000) {
      if (!this.action) this.beginNext();
      else {
        this.t = this.action.t1;
        this.minuteTicks();
        this.finishAction();
      }
    }
    return this.result();
  }

  private minuteTicks() {
    const m = Math.floor(this.t / 60);
    while (this.lastMinute < m) {
      this.lastMinute++;
      this.onMinute(this.lastMinute);
    }
  }

  private onMinute(minute: number) {
    for (const side of [0, 1] as const) {
      const s = this.sides[side];
      for (const pid of s.onPitch) {
        if (pid == null) continue;
        const p = s.players.get(pid)!;
        let rate = 0.13 * p.tire;
        if (s.tactics.marking === 'pressao') rate *= 1.25;
        if (s.tactics.style === 'contra') rate *= 0.95;
        p.fitness = Math.max(10, p.fitness - rate);
        const injP = 0.00011 * (p.fitness < 55 ? 1.8 : 1);
        if (this.rng.chance(injP)) this.injure(side, p);
      }
      if (s.ai && !this.ended) this.aiDecisions(side, minute);
    }
    this.recalc();
  }

  private injure(side: 0 | 1, p: MPlayer) {
    p.injured = true;
    const r = this.rng.next();
    p.injDates = r < 0.55 ? this.rng.int(1, 3) : r < 0.88 ? this.rng.int(4, 9) : this.rng.int(10, 30);
    this.events.push({ t: this.t, kind: 'injury', side, pid: p.id, text: `${p.name} se machucou` });
    // always try an automatic substitution so the side is not left a man down
    const s = this.sides[side];
    const slot = s.onPitch.indexOf(p.id);
    const sub = this.bestBenchFor(side, s.slots[slot].pos);
    if (sub != null && s.subs < MAX_SUBS) this.sub(side, p.id, sub);
    else {
      s.onPitch[slot] = null;
      p.off = this.t;
      if (this.carrier === p.id) this.carrier = null;
    }
  }

  private bestBenchFor(side: 0 | 1, pos: Pos): number | null {
    const s = this.sides[side];
    let best: number | null = null;
    let bestE = -1;
    for (const id of s.bench) {
      const p = s.players.get(id)!;
      if (p.injured) continue;
      const e = effective(p, pos);
      if (e > bestE) {
        bestE = e;
        best = id;
      }
    }
    return best;
  }

  private aiDecisions(side: 0 | 1, minute: number) {
    const s = this.sides[side];
    if (minute === 55 || minute === 65 || minute === 72 || minute === 80) {
      if (s.subs >= MAX_SUBS) return;
      // replace the most tired outfield player
      let worst: { pid: number; slot: number; f: number } | null = null;
      s.onPitch.forEach((pid, slot) => {
        if (pid == null || s.slots[slot].pos === 'GOL') return;
        const p = s.players.get(pid)!;
        if (p.fitness < 72 && (!worst || p.fitness < worst.f)) worst = { pid, slot, f: p.fitness };
      });
      if (worst) {
        const w = worst as { pid: number; slot: number; f: number };
        const sub = this.bestBenchFor(side, s.slots[w.slot].pos);
        if (sub != null) this.sub(side, w.pid, sub);
      }
    }
    if (minute === 70 || minute === 82) {
      const diff = this.score[side] - this.score[1 - side];
      const want = diff < 0 ? 'ofensiva' : diff > 0 && minute === 82 ? 'defensiva' : s.setup.tactics.mentality;
      if (want !== s.tactics.mentality) {
        s.tactics = { ...s.tactics, mentality: want };
      }
    }
  }

  private pickByPos(side: 0 | 1, prefs: Pos[]): number | null {
    const s = this.sides[side];
    for (const pos of prefs) {
      const i = s.slots.findIndex((sl, idx) => sl.pos === pos && s.onPitch[idx] != null);
      if (i >= 0) return s.onPitch[i];
    }
    return s.onPitch.find((x) => x != null) ?? null;
  }

  /** Teammate whose role sits closest to progress u. */
  private pickTeammate(side: 0 | 1, u: number, exclude: number | null): { pid: number | null; y: number } {
    const s = this.sides[side];
    const cands: { pid: number; slot: Slot; w: number }[] = [];
    s.onPitch.forEach((pid, i) => {
      if (pid == null || pid === exclude) return;
      const sl = s.slots[i];
      if (sl.pos === 'GOL' && u > 0.15) return;
      const su = 0.1 + sl.x * 0.85;
      const d = (su - u) / 0.16;
      cands.push({ pid, slot: sl, w: Math.exp(-d * d) + 0.04 });
    });
    if (!cands.length) return { pid: null, y: PITCH_H / 2 };
    const c = this.rng.weighted(cands, (x) => x.w);
    const yAbs = this.dir(side) > 0 ? c.slot.y * PITCH_H : (1 - c.slot.y) * PITCH_H;
    return { pid: c.pid, y: this.clampY(yAbs + this.rng.range(-7, 7)) };
  }

  /** Opponent closest (by role) to the ball, to win it back. */
  private pickDefender(side: 0 | 1, uAtt: number): number | null {
    const s = this.sides[side];
    const uDef = 1 - uAtt;
    const cands: { pid: number; w: number }[] = [];
    s.onPitch.forEach((pid, i) => {
      if (pid == null) return;
      const sl = s.slots[i];
      if (sl.pos === 'GOL' && uDef > 0.12) return;
      const d = (0.06 + sl.x * 0.7 - uDef) / 0.18;
      cands.push({ pid, w: Math.exp(-d * d) + 0.03 });
    });
    if (!cands.length) return null;
    return this.rng.weighted(cands, (x) => x.w).pid;
  }

  private gkOf(side: 0 | 1): number | null {
    const s = this.sides[side];
    const i = s.slots.findIndex((sl) => sl.pos === 'GOL');
    return i >= 0 ? s.onPitch[i] : null;
  }

  private duel(u: number): number {
    const a = this.sides[this.poss].ratings;
    const d = this.sides[1 - this.poss].ratings;
    let atk: number;
    let def: number;
    if (u < 0.35) {
      atk = 0.6 * a.def + 0.4 * a.mid;
      def = 0.6 * d.att + 0.4 * d.mid;
    } else if (u < 0.7) {
      atk = a.mid;
      def = d.mid;
    } else {
      atk = 0.65 * a.att + 0.35 * a.mid;
      def = 0.7 * d.def + 0.3 * d.mid;
    }
    if (this.poss === 0) atk *= this.setup.homeAdv;
    else def *= this.setup.homeAdv;
    const ka = Math.pow(atk, 2.6);
    const kd = Math.pow(def, 2.6);
    return ka / (ka + kd);
  }

  private start(kind: ActionKind, dur: number, to: Vec, eff: Effects, opts: { actor?: number | null; target?: number | null; lofted?: boolean } = {}) {
    this.action = {
      kind,
      side: this.poss,
      actor: opts.actor ?? this.carrier,
      target: opts.target ?? null,
      from: { ...this.ball },
      to,
      t0: this.t,
      t1: this.t + dur,
      lofted: opts.lofted ?? false,
    };
    this.effects = eff;
  }

  private finishAction() {
    const a = this.action!;
    const e = this.effects!;
    this.stats[a.side].poss += a.t1 - a.t0;
    this.action = null;
    this.effects = null;
    this.poss = e.poss;
    this.carrier = e.carrier;
    this.ball = { ...e.ball };
    this.setPiece = e.setPiece;
    if (e.lastPasser !== undefined) this.lastPasser = e.lastPasser;
    if (e.shot) {
      this.stats[e.shot.side].shots++;
      if (e.shot.onTarget) this.stats[e.shot.side].onTarget++;
    }
    if (e.corner !== undefined) this.stats[e.corner].corners++;
    if (e.events) for (const ev of e.events) this.events.push({ ...ev, t: this.t });
    if (e.goal) {
      const g = e.goal;
      this.score[g.side]++;
      const scorer = this.player(g.pid)!;
      scorer.goals++;
      if (g.ast != null) {
        const ap = this.player(g.ast);
        if (ap) ap.ast++;
      }
      this.goals.push({ min: Math.min(this.minute(), this.half === 1 ? 45 : 90), side: g.side, pid: g.pid, ast: g.ast, pen: g.pen });
      const astName = g.ast != null ? ` (assist. ${this.player(g.ast)?.name})` : '';
      this.events.push({
        t: this.t,
        kind: 'goal',
        side: g.side,
        pid: g.pid,
        text: `GOL! ${scorer.name}${g.pen ? ' (pênalti)' : ''}${astName}`,
      });
      // a goal adds stoppage time
      if (this.half === 1) this.added[0] = Math.min(this.added[0] + 30, 360);
      else this.added[1] = Math.min(this.added[1] + 30, 540);
    }
    this.afterFinish();
  }

  private beginNext() {
    // half-time / full-time checks happen only at dead-ball-ish moments between actions
    if (this.half === 1 && this.t >= HALF + this.added[0]) {
      this.events.push({ t: this.t, kind: 'ht', side: 0, text: 'Fim do primeiro tempo' });
      this.half = 2;
      this.t = HALF;
      this.lastMinute = Math.floor(HALF / 60) - 1;
      this.kickoff(1);
      for (const s of this.sides) {
        for (const pid of s.onPitch) {
          if (pid == null) continue;
          const p = s.players.get(pid)!;
          p.fitness = Math.min(100, p.fitness + 4);
        }
      }
      return;
    }
    if (this.half === 2 && this.t >= FULL + this.added[1]) {
      this.finish();
      return;
    }
    switch (this.setPiece) {
      case 'kickoff':
        return this.doKickoff();
      case 'goalkick':
        return this.doGoalKick();
      case 'throw':
        return this.doThrow();
      case 'corner':
        return this.doCorner();
      case 'freekick':
        return this.doFreeKick();
      case 'penalty':
        return this.doShot('penalty', this.penaltyTaker(this.poss));
      default:
        return this.decide();
    }
  }

  private kickoff(side: 0 | 1) {
    this.poss = side;
    this.ball = { x: PITCH_W / 2, y: PITCH_H / 2 };
    this.setPiece = 'kickoff';
    this.carrier = this.pickByPos(side, ['ATA', 'MEI']);
    this.lastPasser = null;
  }

  private doKickoff() {
    const s = this.poss;
    const recv = this.pickTeammate(s, 0.38, this.carrier);
    this.start('kickoff', 3, { x: this.toX(s, 0.4), y: recv.y }, {
      poss: s,
      carrier: recv.pid,
      ball: { x: this.toX(s, 0.4), y: recv.y },
      setPiece: null,
      lastPasser: this.carrier,
    }, { target: recv.pid });
  }

  private doGoalKick() {
    const s = this.poss;
    const gk = this.gkOf(s);
    this.carrier = gk;
    this.ball = { x: this.toX(s, 0.05), y: PITCH_H / 2 };
    const short = this.sides[s].tactics.style === 'toque' ? 0.6 : 0.2;
    if (this.rng.chance(short)) {
      const recv = this.pickTeammate(s, 0.15, gk);
      const to = { x: this.toX(s, 0.16), y: recv.y };
      this.start('goalkick', this.rng.range(10, 16), to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: gk }, { target: recv.pid });
      return;
    }
    const u = this.rng.range(0.42, 0.62);
    const won = this.rng.chance(0.42 + (this.duel(u) - 0.5) * 0.5);
    if (won) {
      const recv = this.pickTeammate(s, u, gk);
      const to = { x: this.toX(s, u), y: recv.y };
      this.start('goalkick', this.rng.range(12, 18), to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: gk }, { target: recv.pid, lofted: true });
    } else {
      const o = (1 - s) as 0 | 1;
      const d = this.pickDefender(o, u);
      const to = { x: this.toX(s, u), y: this.clampY(this.rng.range(15, 53)) };
      this.start('goalkick', this.rng.range(12, 18), to, { poss: o, carrier: d, ball: to, setPiece: null, lastPasser: null }, { target: d, lofted: true });
    }
  }

  private doThrow() {
    const s = this.poss;
    const u = this.progress(s, this.ball.x);
    this.carrier = this.pickTeammate(s, u, null).pid;
    const recv = this.pickTeammate(s, u + 0.02, this.carrier);
    const to = { x: this.toX(s, u + this.rng.range(-0.03, 0.06)), y: this.clampY(this.ball.y < PITCH_H / 2 ? this.ball.y + 8 : this.ball.y - 8) };
    if (this.rng.chance(0.85)) {
      this.start('throw', this.rng.range(8, 14), to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: this.carrier }, { target: recv.pid });
    } else {
      const o = (1 - s) as 0 | 1;
      const d = this.pickDefender(o, u);
      this.start('throw', this.rng.range(8, 14), to, { poss: o, carrier: d, ball: to, setPiece: null, lastPasser: null }, { target: d });
    }
  }

  private setPieceTaker(side: 0 | 1): number | null {
    const ps = this.playersOnPitch(side).filter((p) => p.pos !== 'GOL');
    if (!ps.length) return null;
    const c = ps.find((p) => p.traits.includes('cobrancas'));
    if (c) return c.id;
    return ps.sort((a, b) => (b.pos === 'MEI' ? 5 : 0) + b.str - ((a.pos === 'MEI' ? 5 : 0) + a.str))[0].id;
  }

  private penaltyTaker(side: 0 | 1): number | null {
    const ps = this.playersOnPitch(side).filter((p) => p.pos !== 'GOL');
    if (!ps.length) return null;
    const c = ps.find((p) => p.traits.includes('cobrancas'));
    if (c) return c.id;
    return ps.sort((a, b) => (b.pos === 'ATA' ? 6 : 0) + b.str - ((a.pos === 'ATA' ? 6 : 0) + a.str))[0].id;
  }

  private doCorner() {
    const s = this.poss;
    const taker = this.setPieceTaker(s);
    this.carrier = taker;
    const top = this.rng.chance(0.5);
    this.ball = { x: this.toX(s, 0.995), y: top ? 1 : PITCH_H - 1 };
    const r = this.duel(0.9);
    if (this.rng.chance(0.26 + (r - 0.5) * 0.3)) {
      this.lastPasser = taker;
      return this.doShot('header', this.headerTaker(s), 'corner');
    }
    if (this.rng.chance(0.15)) {
      const recv = this.pickTeammate(s, 0.8, taker);
      const to = { x: this.toX(s, 0.82), y: this.clampY(top ? 12 : PITCH_H - 12) };
      this.start('corner', this.rng.range(16, 24), to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: taker }, { target: recv.pid });
      return;
    }
    const o = (1 - s) as 0 | 1;
    const d = this.pickDefender(o, 0.92);
    const to = { x: this.toX(s, this.rng.range(0.7, 0.85)), y: this.clampY(this.rng.range(15, 53)) };
    this.start('corner', this.rng.range(18, 26), to, { poss: o, carrier: d, ball: to, setPiece: null, lastPasser: null }, { target: d, lofted: true });
  }

  private headerTaker(side: 0 | 1): number | null {
    const ps = this.playersOnPitch(side).filter((p) => p.pos !== 'GOL');
    if (!ps.length) return null;
    const w: Record<Pos, number> = { ATA: 3, ZAG: 2.4, MEI: 1, VOL: 1, LAT: 0.6, GOL: 0 };
    return this.rng.weighted(ps, (p) => w[p.pos] * (p.traits.includes('cabeceio') ? 2 : 1) * (p.str / 70) ** 2).id;
  }

  private shooter(side: 0 | 1): number | null {
    const ps = this.playersOnPitch(side).filter((p) => p.pos !== 'GOL');
    if (!ps.length) return null;
    const w: Record<Pos, number> = { ATA: 5, MEI: 2.6, VOL: 0.9, LAT: 0.6, ZAG: 0.35, GOL: 0 };
    return this.rng.weighted(ps, (p) => w[p.pos] * (p.traits.includes('finalizacao') ? 1.5 : 1) * (p.str / 70) ** 2).id;
  }

  private doFreeKick() {
    const s = this.poss;
    const u = this.progress(s, this.ball.x);
    const taker = this.setPieceTaker(s);
    this.carrier = taker;
    if (u > 0.72) {
      if (this.rng.chance(0.38)) return this.doShot('freekick', taker);
      if (this.rng.chance(0.3)) {
        this.lastPasser = taker;
        return this.doShot('header', this.headerTaker(s), 'freekick');
      }
      const o = (1 - s) as 0 | 1;
      const d = this.pickDefender(o, 0.9);
      const to = { x: this.toX(s, this.rng.range(0.72, 0.86)), y: this.clampY(this.rng.range(15, 53)) };
      this.start('freekick', this.rng.range(20, 28), to, { poss: o, carrier: d, ball: to, setPiece: null, lastPasser: null }, { target: d, lofted: true });
      return;
    }
    const nu = Math.min(0.8, u + this.rng.range(0.08, 0.25));
    const recv = this.pickTeammate(s, nu, taker);
    const to = { x: this.toX(s, nu), y: recv.y };
    this.start('freekick', this.rng.range(14, 22), to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: taker }, { target: recv.pid, lofted: nu - u > 0.15 });
  }

  /** Regular open-play decision for the side in possession. */
  private decide() {
    const s = this.poss;
    const o = (1 - s) as 0 | 1;
    const A = this.sides[s];
    if (this.carrier == null || !A.onPitch.includes(this.carrier)) {
      this.carrier = this.pickTeammate(s, this.progress(s, this.ball.x), null).pid;
    }
    const carrier = this.carrier != null ? A.players.get(this.carrier)! : null;
    const u = this.progress(s, this.ball.x);
    const yN = this.ball.y / PITCH_H;
    const r = this.duel(u);
    const ment = A.tactics.mentality;
    const mentMod = ment === 'ofensiva' ? 1.15 : ment === 'defensiva' ? 0.85 : 1;

    let shootP = u > 0.84 ? 0.095 : u > 0.7 ? 0.02 : 0;
    shootP *= mentMod;
    if (this.rng.chance(shootP)) return this.doShot(u > 0.84 ? 'box' : 'long', this.carrier ?? this.shooter(s));

    if (u > 0.7 && Math.abs(yN - 0.5) > 0.27 && this.rng.chance(0.4)) {
      this.lastPasser = this.carrier;
      if (this.rng.chance(0.18 + (r - 0.5) * 0.3)) return this.doShot('header', this.headerTaker(s), 'cross');
      if (this.rng.chance(0.3)) {
        // cleared behind for a corner
        const to = { x: this.toX(s, 0.99), y: this.ball.y < PITCH_H / 2 ? 1 : PITCH_H - 1 };
        this.start('cross', 3, to, { poss: s, carrier: null, ball: to, setPiece: 'corner', corner: s, lastPasser: null }, { lofted: true });
        return;
      }
      return this.turnover(u, 'cross', 0.06, 0.25);
    }

    const style = A.tactics.style;
    const W =
      style === 'toque'
        ? { pass: 0.48, back: 0.3, dribble: 0.14, long: 0.08 }
        : style === 'contra'
          ? { pass: 0.46, back: 0.18, dribble: 0.16, long: 0.2 }
          : { pass: 0.36, back: 0.2, dribble: 0.1, long: 0.34 };
    if (u < 0.2) W.back *= 0.4;
    if (u > 0.75) W.long = 0.02;
    const kinds = Object.keys(W) as (keyof typeof W)[];
    const kind = this.rng.weighted(kinds, (k) => W[k]);
    const has = (t: Trait) => carrier?.traits.includes(t) ?? false;
    const pressing = this.sides[o].tactics.marking === 'pressao';

    let p: number;
    let du: number;
    let dur: number;
    let lofted = false;
    switch (kind) {
      case 'pass':
        p = 0.63 + (r - 0.5) * 0.4 + (has('passe') ? 0.04 : 0) - (pressing ? 0.03 : 0);
        du = this.rng.range(0.06, 0.17);
        dur = this.rng.range(2.5, 5);
        break;
      case 'back':
        p = 0.93 - (pressing ? 0.02 : 0);
        du = -this.rng.range(0.03, 0.12);
        dur = this.rng.range(2, 4);
        break;
      case 'dribble':
        p = 0.48 + (r - 0.5) * 0.5 + (has('drible') ? 0.08 : 0) + (has('velocidade') ? 0.04 : 0);
        du = this.rng.range(0.04, 0.12);
        dur = this.rng.range(3, 6);
        break;
      default:
        p = 0.4 + (r - 0.5) * 0.4 + (has('passe') ? 0.03 : 0);
        du = this.rng.range(0.2, 0.4);
        dur = this.rng.range(3, 5);
        lofted = true;
    }
    const nu = Math.min(0.97, Math.max(0.03, u + du));
    if (this.rng.chance(p)) {
      if (kind === 'dribble') {
        const to = { x: this.toX(s, nu), y: this.clampY(this.ball.y + this.rng.range(-8, 8)) };
        this.start('dribble', dur, to, { poss: s, carrier: this.carrier, ball: to, setPiece: null });
      } else {
        const recv = this.pickTeammate(s, nu, this.carrier);
        const to = { x: this.toX(s, nu), y: recv.y };
        this.start(kind, dur, to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: this.carrier }, { target: recv.pid, lofted });
      }
      return;
    }
    this.turnover(kind === 'back' ? u : Math.min(0.97, u + du * 0.5), kind, pressing ? 0.09 : 0.07, 0.15, dur);
  }

  /** Possession lost: foul, out of play or interception. */
  private turnover(u: number, kind: ActionKind, foulP: number, outP: number, dur = 3) {
    const s = this.poss;
    const o = (1 - s) as 0 | 1;
    const roll = this.rng.next();
    const spot = { x: this.toX(s, u), y: this.clampY(this.ball.y + this.rng.range(-6, 6)) };
    if (roll < foulP) {
      // defender fouls: attacking side keeps the ball with a set piece
      const fouler = this.pickDefender(o, u);
      const evs: MatchEvent[] = [];
      this.stats[o].fouls++;
      if (fouler != null) this.cardCheck(o, fouler, evs);
      const inBox = u > 0.86 && Math.abs(spot.y - PITCH_H / 2) < 20;
      const pen = inBox && this.rng.chance(0.5);
      this.start(kind, dur, spot, {
        poss: s,
        carrier: this.carrier,
        ball: pen ? { x: this.toX(s, 0.895), y: PITCH_H / 2 } : spot,
        setPiece: pen ? 'penalty' : 'freekick',
        events: evs,
      });
      return;
    }
    if (roll < foulP + outP) {
      const side = spot.y < PITCH_H / 2 ? 0.5 : PITCH_H - 0.5;
      const to = { x: spot.x, y: side };
      this.start(kind, dur, to, { poss: o, carrier: null, ball: to, setPiece: 'throw', lastPasser: null });
      return;
    }
    const d = this.pickDefender(o, u);
    // counter-attack chance for 'contra' sides winning the ball deep
    this.start(kind, dur, spot, { poss: o, carrier: d, ball: spot, setPiece: null, lastPasser: null }, { target: d });
  }

  private cardCheck(side: 0 | 1, pid: number, evs: MatchEvent[]) {
    const s = this.sides[side];
    const p = s.players.get(pid)!;
    const pressing = s.tactics.marking === 'pressao';
    const yP = (pressing ? 0.21 : 0.17) * (p.traits.includes('marcacao') ? 0.85 : 1) * (p.yellow > 0 ? 0.3 : 1);
    if (this.rng.chance(0.003)) return this.sendOff(side, p, evs, 'Cartão vermelho direto');
    if (this.rng.chance(yP)) {
      p.yellow++;
      this.stats[side].yel++;
      if (p.yellow >= 2) return this.sendOff(side, p, evs, 'Segundo amarelo');
      evs.push({ t: this.t, kind: 'yellow', side, pid, text: `Cartão amarelo para ${p.name}` });
    }
  }

  private sendOff(side: 0 | 1, p: MPlayer, evs: MatchEvent[], why: string) {
    const s = this.sides[side];
    p.red = true;
    this.stats[side].red++;
    const slot = s.onPitch.indexOf(p.id);
    if (slot >= 0) s.onPitch[slot] = null;
    p.off = this.t;
    if (this.carrier === p.id) this.carrier = null;
    evs.push({ t: this.t, kind: 'red', side, pid: p.id, text: `${why}: ${p.name} expulso` });
    // a sent-off goalkeeper is replaced by a bench keeper if possible
    if (s.slots[slot]?.pos === 'GOL') {
      // an outfield player moves into goal; a bench keeper replaces him if possible
      const out = [...s.onPitch]
        .filter((id): id is number => id != null)
        .sort((a, b) => s.players.get(a)!.str - s.players.get(b)!.str)[0];
      if (out != null) {
        s.onPitch[s.onPitch.indexOf(out)] = null;
        s.onPitch[slot] = out;
        const gk = s.bench.find((id) => s.players.get(id)!.pos === 'GOL');
        if (gk != null && s.subs < MAX_SUBS) this.sub(side, out, gk);
      }
    }
    this.recalc();
  }

  private doShot(type: 'box' | 'long' | 'header' | 'penalty' | 'freekick', pid: number | null, from?: 'corner' | 'cross' | 'freekick') {
    const s = this.poss;
    const o = (1 - s) as 0 | 1;
    const A = this.sides[s];
    const D = this.sides[o];
    const shooterId = pid ?? this.shooter(s);
    if (shooterId == null) return this.turnover(0.5, 'pass', 0, 0);
    const sh = A.players.get(shooterId)!;
    const slot = A.onPitch.indexOf(shooterId);
    const shEff = effective(sh, slot >= 0 ? A.slots[slot].pos : sh.pos) *
      (type === 'header' ? (sh.traits.includes('cabeceio') ? 1.12 : 1) : sh.traits.includes('finalizacao') ? 1.1 : 1) *
      ((type === 'penalty' || type === 'freekick') && sh.traits.includes('cobrancas') ? 1.12 : 1);
    const gkEff = D.ratings.gk;
    const base = { box: 0.075, long: 0.021, header: 0.058, penalty: 0.76, freekick: 0.045 }[type];
    let f = Math.pow(shEff / Math.max(20, gkEff), 0.95);
    if (type === 'box' || type === 'header') f *= Math.pow(A.ratings.att / Math.max(20, D.ratings.def), 0.5);
    if (s === 0) f *= this.setup.homeAdv;
    const pGoal = Math.min(0.9, Math.max(0.01, base * f));
    const goalY = PITCH_H / 2 + this.rng.range(-3.2, 3.2);
    const goalX = this.toX(s, 1.0);
    let ast: number | null = null;
    if (type !== 'penalty' && type !== 'freekick' && this.lastPasser != null && this.lastPasser !== shooterId) {
      const lp = this.player(this.lastPasser);
      if (lp && lp.side === s && (from || this.rng.chance(0.75))) ast = this.lastPasser;
    }
    const kind: ActionKind = type === 'header' ? 'header' : type === 'penalty' ? 'penalty' : type === 'freekick' ? 'freekick' : 'shot';
    const dur = type === 'penalty' ? this.rng.range(40, 60) : type === 'freekick' ? this.rng.range(18, 26) : type === 'header' ? (from === 'corner' ? this.rng.range(18, 26) : 2.5) : this.rng.range(1.5, 2.5);
    if (type === 'header') {
      // ball comes in from the flank first: start the action from the shooter area visually
      this.ball = { x: this.toX(s, from === 'corner' ? 0.995 : 0.82), y: from === 'corner' ? (this.rng.chance(0.5) ? 1 : PITCH_H - 1) : this.ball.y };
    }
    if (this.rng.chance(pGoal)) {
      const to = { x: goalX + (this.dir(s) > 0 ? 1.5 : -1.5), y: goalY };
      this.start(kind, dur, to, {
        poss: o,
        carrier: null,
        ball: to,
        setPiece: null,
        goal: { side: s, pid: shooterId, ast, pen: type === 'penalty' },
        shot: { side: s, onTarget: true },
        lastPasser: null,
      }, { actor: shooterId, lofted: type === 'header' });
      // after the goal: celebration, then kickoff for the side that conceded
      this.pendingKickoff = o;
      return;
    }
    const onTarget = this.rng.chance(type === 'penalty' ? 0.6 : 0.36);
    if (onTarget) {
      const gk = this.gkOf(o);
      const to = { x: this.toX(s, 0.985), y: goalY };
      const corner = this.rng.chance(0.45);
      const evs: MatchEvent[] = type === 'penalty' ? [{ t: 0, kind: 'save', side: o, pid: gk ?? undefined, text: `Pênalti defendido!` }] : [];
      this.start(kind, dur, to, {
        poss: corner ? s : o,
        carrier: corner ? null : gk,
        ball: corner ? to : { x: this.toX(s, 0.95), y: PITCH_H / 2 },
        setPiece: corner ? 'corner' : 'goalkick',
        shot: { side: s, onTarget: true },
        corner: corner ? s : undefined,
        events: evs,
        lastPasser: null,
      }, { actor: shooterId, target: gk, lofted: type === 'header' });
      return;
    }
    const blocked = type === 'box' && this.rng.chance(0.28);
    if (blocked && this.rng.chance(0.5)) {
      const to = { x: this.toX(s, 0.97), y: this.ball.y < PITCH_H / 2 ? 2 : PITCH_H - 2 };
      this.start(kind, dur, to, { poss: s, carrier: null, ball: to, setPiece: 'corner', shot: { side: s, onTarget: false }, corner: s, lastPasser: null }, { actor: shooterId });
      return;
    }
    const wide = goalY + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(5, 12);
    const to = { x: goalX, y: this.clampY(wide) };
    const evs: MatchEvent[] = type === 'penalty' ? [{ t: 0, kind: 'miss', side: s, pid: shooterId, text: `${sh.name} perde o pênalti!` }] : [];
    this.start(kind, dur, to, {
      poss: o,
      carrier: this.gkOf(o),
      ball: { x: this.toX(s, 0.95), y: PITCH_H / 2 },
      setPiece: 'goalkick',
      shot: { side: s, onTarget: false },
      events: evs,
      lastPasser: null,
    }, { actor: shooterId, lofted: type === 'header' });
  }

  private pendingKickoff: 0 | 1 | null = null;

  // celebration + kickoff are handled by wrapping finishAction
  private finish() {
    const evs: MatchEvent[] = [];
    if (this.setup.decider) {
      const h = this.score[0] + this.setup.decider.aggHome;
      const a = this.score[1] + this.setup.decider.aggAway;
      if (h === a) {
        this.pens = this.shootout();
        evs.push({ t: this.t, kind: 'pens', side: this.pens[0] > this.pens[1] ? 0 : 1, text: `Pênaltis: ${this.pens[0]} x ${this.pens[1]}` });
      }
    }
    this.events.push(...evs);
    this.events.push({ t: this.t, kind: 'ft', side: 0, text: 'Fim de jogo' });
    this.ended = true;
    this.action = null;
    for (const s of this.sides) for (const pid of s.onPitch) if (pid != null) s.players.get(pid)!.off ??= this.t;
  }

  private shootout(): [number, number] {
    const takers = [0, 1].map((side) =>
      this.playersOnPitch(side as 0 | 1)
        .filter((p) => p.pos !== 'GOL')
        .sort((a, b) => (b.traits.includes('cobrancas') ? 20 : 0) + b.str - ((a.traits.includes('cobrancas') ? 20 : 0) + a.str)),
    );
    const score: [number, number] = [0, 0];
    const kick = (side: 0 | 1, i: number) => {
      const list = takers[side];
      const t = list.length ? list[i % list.length] : null;
      const gk = this.sides[1 - side].ratings.gk;
      const p = 0.75 + ((t?.str ?? 60) - gk) / 400;
      if (this.rng.chance(Math.min(0.92, Math.max(0.55, p)))) score[side]++;
    };
    for (let i = 0; i < 5; i++) {
      kick(0, i);
      kick(1, i);
    }
    let i = 5;
    while (score[0] === score[1] && i < 40) {
      kick(0, i);
      kick(1, i);
      i++;
    }
    if (score[0] === score[1]) score[this.rng.int(0, 1)]++;
    return score;
  }

  result(): MatchResult {
    const players: MatchResult['players'] = {};
    const end = this.t;
    for (const s of this.sides) {
      for (const p of s.players.values()) {
        if (p.on == null) continue;
        const mins = Math.max(1, Math.round(((p.off ?? end) - p.on) / 60));
        players[p.id] = {
          side: p.side,
          mins,
          goals: p.goals,
          ast: p.ast,
          yel: p.yellow >= 2 ? 0 : p.yellow,
          red: p.red,
          inj: p.injured ? p.injDates : 0,
          fitness: Math.round(p.fitness),
        };
      }
    }
    return {
      fixtureId: this.setup.fixtureId,
      hg: this.score[0],
      ag: this.score[1],
      pens: this.pens,
      goals: this.goals,
      players,
      stats: this.stats,
    };
  }

  /** Possession percentage for the home side. */
  possPct(): number {
    const t = this.stats[0].poss + this.stats[1].poss;
    return t > 0 ? Math.round((this.stats[0].poss / t) * 100) : 50;
  }

  /** Hook used by finishAction: inject celebration + kickoff after a goal. */
  protected afterFinish() {
    if (this.pendingKickoff != null) {
      const side = this.pendingKickoff;
      this.pendingKickoff = null;
      // celebration pause, then kickoff
      this.action = {
        kind: 'celebrate',
        side,
        actor: null,
        target: null,
        from: { ...this.ball },
        to: { x: PITCH_W / 2, y: PITCH_H / 2 },
        t0: this.t,
        t1: this.t + this.rng.range(40, 60),
        lofted: false,
      };
      this.effects = { poss: side, carrier: this.pickByPos(side, ['ATA', 'MEI']), ball: { x: PITCH_W / 2, y: PITCH_H / 2 }, setPiece: 'kickoff', lastPasser: null };
    }
  }
}
