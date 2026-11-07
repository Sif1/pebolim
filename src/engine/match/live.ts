import type { Tactics } from '../types';
import { matchRating, MatchSim, PITCH_H, PITCH_W, type ActionKind, type MatchEvent, type MatchResult, type MatchSetup } from './core';
import { aiDive, aiShot, autoShootout, kickOutcome, Shootout, type PkDir, type PkOutcome, type PkTaker } from './shootout';

/** Real-time length of each shootout step, in ms. */
export const PK_TIMES = {
  /** managers pick their five takers */
  order: 30_000,
  /** taker picks a corner, keeper picks a side */
  aim: 10_000,
  /** run-up, shot and reaction on screen */
  anim: 3_400,
  /** a penalty during the match: the manager picks the taker */
  spotOrder: 15_000,
};

/** A shootout as clients see it. During 'aim' nobody sees the other side's choice. */
export interface PkFrame {
  /** a penalty shootout, or a single penalty during the match */
  mode: 'shootout' | 'spot';
  phase: 'order' | 'aim' | 'anim';
  score: [number, number];
  /** kicks so far: side, taker, shot direction, dive direction, outcome (0 goal, 1 save, 2 miss) */
  kicks: [0 | 1, number, PkDir, PkDir, PkOutcome][];
  /** side and taker of the kick being prepared or shown */
  next: [0 | 1, number] | null;
  /** ms left in this step */
  left: number;
  /** still waiting for these sides to choose */
  wait: [boolean, boolean];
  first: 0 | 1;
  order: [number[], number[]];
  /** keepers on the pitch */
  keepers: [number, number];
}

export const MAX_PAUSES = 3;
export const PAUSE_LIMIT_MS = 90_000;

/**
 * Highlights, Championship Manager style. The simulation runs a few game seconds ahead of the screen, so
 * playback knows when a shot is coming: the pitch comes alive a few seconds before each shot worth showing and
 * plays it at about real speed, and between highlights it sits idle while the clock runs on (commentary and stats
 * keep updating). When the match is short, only the shots that matter most are shown (goals, then shots on target
 * and clear-cut chances), so the match still lasts about the length the host chose. `tools/pacing.ts` measures it.
 */
export const PACING = {
  /** the simulation runs this many game seconds ahead of the screen */
  lookahead: 12,
  /** a highlight starts this many game seconds before the shot and lasts this long after it */
  leadIn: 7,
  after: 3,
  /** highlights play at this speed (game seconds per real second): close to real time, easy to follow */
  watch: 2,
  /** …and never faster than this, even in very short matches */
  maxWatch: 5,
  /** between highlights the clock runs between 1× and this many times the plain match speed */
  maxIdle: 8,
  /** shots per game second (measured): goals, other shots on target or clear-cut chances, the rest */
  rate: { 3: 2.8 / 5700, 2: 6.5 / 5700, 1: 21 / 5700 } as Record<1 | 2 | 3, number>,
};

/** Game seconds simulated per buffered snapshot. */
const STEP = 0.5;

/** One buffered moment of the match: what the screen shows, and what kind of moment it is. */
interface Snap {
  t: number;
  frame: Omit<LiveFrame, 'ev' | 'paused' | 'pausedBy' | 'ended' | 'pk'>;
  ev: MatchEvent[];
  tier: 0 | 1 | 2;
  /** 1 = a shot or header starts here */
  mark: 0 | 1;
}

/**
 * What the ball is doing right now, for the live commentary: action kind, side, actor and target ids (0 = none),
 * an id that changes with every new action, how far up the pitch it goes for that side (0-100), and how a shot ends.
 */
export interface LiveAction {
  k: ActionKind;
  s: 0 | 1;
  a: number;
  g: number;
  id: number;
  u: number;
  r?: 'goal' | 'save' | 'wide' | 'block';
}

/** Snapshot of a live match sent to every client ~5 times per second. */
export interface LiveFrame {
  f: number;
  /** clock seconds */
  t: number;
  half: 1 | 2;
  sc: [number, number];
  pens: [number, number] | null;
  /** 22 player ids: home slots then away slots (0 = empty) */
  ids: number[];
  /** x,y pairs ×10 for those ids */
  p: number[];
  /** ball x, y, height ×10 */
  b: [number, number, number];
  poss: number;
  shots: [number, number];
  onT: [number, number];
  cards: [number, number, number, number];
  /** extra stats, [home, away] each: passes ok, passes failed, tackles, clear-cut chances, xG ×100, corners, fouls, saves */
  x: { pas: [number, number]; pf: [number, number]; tk: [number, number]; bc: [number, number]; xg: [number, number]; co: [number, number]; fo: [number, number]; sv: [number, number] };
  /** player on the ball (0 = none) */
  car: number;
  /** the action in progress (live commentary) */
  ac?: LiveAction;
  paused: boolean;
  pausedBy: 0 | 1 | null;
  ended: boolean;
  /** events since the previous frame */
  ev: MatchEvent[];
  /** penalty shootout in progress */
  pk?: PkFrame;
  /** a highlight is on screen (false: the pitch sits idle while the clock runs) */
  hl?: boolean;
}

/** Lineup details (sent less often): who is where, fitness, subs used. */
export interface LiveDetail {
  f: number;
  /** momentum ×10 per minute so far, [home, away] */
  mom: [number[], number[]];
  /** current momentum minute (0-89) */
  momAt: number;
  sides: {
    onPitch: (number | null)[];
    bench: number[];
    subs: number;
    tactics: Tactics;
    fit: Record<number, number>;
    /** match rating ×10 of everyone who has played */
    rt: Record<number, number>;
    yel: number[];
    off: number[];
    pauses: number;
  }[];
}

interface Body {
  x: number;
  y: number;
}

export class LiveMatch {
  readonly sim: MatchSim;
  readonly fixtureId: number;
  /** sides controlled by a present human */
  humans: [boolean, boolean];
  paused = false;
  pausedBy: 0 | 1 | null = null;
  pausedAt = 0;
  pauses: [number, number] = [0, 0];
  quickReq: [boolean, boolean] = [false, false];
  private bodies = new Map<number, Body>();
  detailDirty = true;
  /** simulated but not yet shown */
  private buf: Snap[] = [];
  /** game time on screen, and the moment shown */
  private showT = 0;
  private shown: Snap | null = null;
  /** events shown since the last frame */
  private evQueue: MatchEvent[] = [];
  /** events already put into snapshots */
  private evCut = 0;
  /** the current highlight runs until this game time */
  private hlUntil = -1;
  /** the run-up to a pending in-match penalty is already marked as a highlight */
  private spotMarked = false;
  /** goals simulated so far (to mark the moment of each one) */
  private goalsSeen = 0;
  /** shots already judged for a highlight (by game time) */
  private judged = new Set<number>();
  /** speed of the current highlight, and whether one is on screen */
  private watchSpeed = PACING.watch;
  private live = false;
  /** real milliseconds played (pauses excluded) */
  private playedMs = 0;
  /** current game seconds per real second */
  speedNow = 0;

  constructor(setup: MatchSetup, humans: [boolean, boolean]) {
    this.sim = new MatchSim(setup);
    this.fixtureId = setup.fixtureId;
    this.humans = humans;
    this.sim.sides[0].ai = !humans[0];
    this.sim.sides[1].ai = !humans[1];
    // a human is here: a shootout is played kick by kick
    this.sim.pkMode = humans[0] || humans[1] ? 'live' : 'auto';
    this.placeKickoff();
  }

  // ---------- penalty shootout ----------
  private pk: {
    so: Shootout;
    phase: PkFrame['phase'];
    left: number;
    ready: [boolean, boolean];
    shot: PkDir | null;
    dive: PkDir | null;
    takers: Map<number, PkTaker>;
    /** the kick being shown in 'anim' */
    showing: [0 | 1, number] | null;
  } | null = null;

  /** a highlight is on screen */
  get highlight() {
    return this.live;
  }

  /** a shootout or an in-match penalty is being taken */
  get inShootout() {
    return this.sim.pkPending || !!this.sim.spotPending;
  }

  /** what the penalty mini-game is playing: a shootout, or a single penalty during the match */
  private pkKind: 'shootout' | 'spot' = 'shootout';

  private startShootout() {
    const spot = this.sim.spotPending;
    this.pkKind = spot ? 'spot' : 'shootout';
    let so = this.sim.newShootout();
    if (spot) {
      // one kick: the kicking side's usual taker first (the manager may pick another)
      const order = so.order.map((o) => [...o]) as [number[], number[]];
      if (spot.taker != null) order[spot.side] = [spot.taker, ...order[spot.side].filter((id) => id !== spot.taker)];
      so = new Shootout(spot.side, order, 1);
    }
    this.pk = {
      so,
      phase: 'order',
      left: spot ? PK_TIMES.spotOrder : PK_TIMES.order,
      // only the kicking side picks a taker for an in-match penalty
      ready: spot ? [spot.side !== 0 || !this.humans[0], spot.side !== 1 || !this.humans[1]] : [!this.humans[0], !this.humans[1]],
      shot: null,
      dive: null,
      takers: new Map([...this.sim.pkTakers(0), ...this.sim.pkTakers(1)].map((t) => [t.id, t])),
      showing: null,
    };
    this.detailDirty = true;
  }

  private beginAim() {
    const pk = this.pk!;
    pk.phase = 'aim';
    pk.left = PK_TIMES.aim;
    pk.shot = null;
    pk.dive = null;
    pk.showing = null;
  }

  private takeKick() {
    const pk = this.pk!;
    const n = pk.so.next();
    if (!n) return;
    const rng = this.sim.rng;
    const taker = pk.takers.get(n.taker) ?? { id: n.taker, name: '', str: 60, pen: false, gk: false };
    const shot = pk.shot ?? aiShot(rng);
    const dive = pk.dive ?? aiDive(rng, pk.so.shotsBy(n.side));
    const out = kickOutcome(taker, this.sim.pkKeepers()[1 - n.side], shot, dive, rng);
    pk.so.record({ side: n.side, taker: n.taker, dir: shot, dive, out });
    pk.phase = 'anim';
    pk.left = PK_TIMES.anim;
    pk.showing = [n.side, n.taker];
  }

  private tickShootout(ms: number) {
    if (!this.pk) this.startShootout();
    const pk = this.pk!;
    pk.left -= ms;
    if (pk.phase === 'order') {
      const set = (s: 0 | 1) => pk.ready[s] || !this.humans[s];
      if ((set(0) && set(1)) || pk.left <= 0) this.beginAim();
    } else if (pk.phase === 'aim') {
      const n = pk.so.next();
      if (!n) return this.endPk();
      const shotIn = pk.shot != null || !this.humans[n.side];
      const diveIn = pk.dive != null || !this.humans[1 - n.side];
      if ((shotIn && diveIn) || pk.left <= 0) this.takeKick();
    } else if (pk.left <= 0) {
      if (pk.so.next()) this.beginAim();
      else this.endPk();
    }
  }

  /** The mini-game is over: close the match after a shootout, or play on after an in-match penalty. */
  private endPk() {
    const pk = this.pk!;
    if (this.pkKind === 'spot') {
      const k = pk.so.kicks[0];
      this.pk = null;
      if (k) this.sim.resolveSpotKick(k.taker, k.out);
      else this.sim.autoSpotKick();
      this.spotMarked = false;
      this.detailDirty = true;
      return;
    }
    this.sim.endWithPens(pk.so.score);
  }

  /** A manager's five takers, in order (the rest follow by skill). */
  pkOrder(side: 0 | 1, order: number[]): string | null {
    const pk = this.pk;
    if (!pk || pk.phase !== 'order') return 'A ordem dos batedores já foi definida.';
    const onPitch = new Set(this.sim.pkTakers(side).map((t) => t.id));
    const clean = order.filter((id, i) => onPitch.has(id) && order.indexOf(id) === i);
    const need = this.pkKind === 'spot' ? 1 : Math.min(5, onPitch.size);
    if (clean.length < need) return need === 1 ? 'Escolha o batedor.' : 'Escolha cinco batedores.';
    pk.so.order[side] = [...clean, ...pk.so.order[side].filter((id) => !clean.includes(id))];
    pk.ready[side] = true;
    return null;
  }

  /** The taker's corner or the keeper's dive, whichever this side owes for the coming kick. */
  pkAim(side: 0 | 1, dir: PkDir): string | null {
    const pk = this.pk;
    if (!pk || pk.phase !== 'aim') return null;
    const n = pk.so.next();
    if (!n) return null;
    if (n.side === side) pk.shot ??= dir;
    else pk.dive ??= dir;
    return null;
  }

  private pkFrame(): PkFrame | undefined {
    const pk = this.pk;
    if (!pk || !(this.sim.pkPending || this.sim.spotPending)) return undefined;
    const n = pk.phase === 'anim' ? pk.showing : (() => {
      const x = pk.so.next();
      return x ? ([x.side, x.taker] as [0 | 1, number]) : null;
    })();
    const keeper = (s: 0 | 1) => this.sim.pkTakers(s).find((t) => t.gk)?.id ?? 0;
    const waiting = (s: 0 | 1): boolean => {
      if (!this.humans[s]) return false;
      if (pk.phase === 'order') return !pk.ready[s];
      if (pk.phase !== 'aim' || !n) return false;
      return n[0] === s ? pk.shot == null : pk.dive == null;
    };
    return {
      mode: this.pkKind,
      phase: pk.phase,
      score: [...pk.so.score] as [number, number],
      kicks: pk.so.kicks.map((k) => [k.side, k.taker, k.dir, k.dive, k.out]),
      next: n,
      left: Math.max(0, Math.round(pk.left)),
      wait: [waiting(0), waiting(1)],
      first: pk.so.first,
      order: [[...pk.so.order[0]], [...pk.so.order[1]]],
      keepers: [keeper(0), keeper(1)],
    };
  }

  /** Over once the simulation has ended and the screen has caught up. */
  get ended() {
    return this.sim.ended && this.buf.length === 0;
  }

  /** Simulate ahead of the screen, up to `lookahead` game seconds. */
  private produce() {
    let guard = 0;
    while (!this.sim.ended && !this.sim.pkPending && !this.sim.spotPending && this.sim.t < this.showT + PACING.lookahead && guard++ < 400) {
      this.sim.step(STEP);
      this.moveBodies(STEP);
      const a = this.sim.action;
      // a shot or header, a penalty kick, or any goal (free kicks and own goals included)
      const goals = this.sim.score[0] + this.sim.score[1];
      const kick = a && (a.kind === 'shot' || a.kind === 'header' || (a.kind === 'penalty' && this.sim.t > a.t1 - 1));
      const mark: Snap['mark'] = kick || goals > this.goalsSeen ? 1 : 0;
      this.goalsSeen = goals;
      const ev = this.sim.events.slice(this.evCut);
      this.evCut = this.sim.events.length;
      this.buf.push({ t: this.sim.t, frame: this.capture(), ev, tier: this.tier(), mark });
    }
    // a penalty given: the run-up to it plays as a highlight, then the mini-game
    if (this.sim.spotPending && !this.spotMarked && this.buf.length) {
      this.buf[this.buf.length - 1].mark = 1;
      this.spotMarked = true;
    }
  }

  /** Put a buffered moment on screen. */
  private show(s: Snap) {
    this.showT = s.t;
    this.shown = s;
    if (s.ev.length) {
      this.evQueue.push(...s.ev);
      this.detailDirty = true;
    }
  }

  private placeKickoff() {
    for (const side of [0, 1] as const) {
      const s = this.sim.sides[side];
      s.onPitch.forEach((pid, i) => {
        if (pid == null) return;
        const sl = s.slots[i];
        const u = 0.03 + sl.x * 0.44;
        this.bodies.set(pid, { x: this.sim.toX(side, u), y: this.yAbs(side, sl.y) });
      });
    }
  }

  private yAbs(side: 0 | 1, v: number) {
    return this.sim.dir(side) > 0 ? v * PITCH_H : (1 - v) * PITCH_H;
  }

  /** 2 = key moment, 1 = attack in the final third, 0 = the rest (build-up, restarts, celebrations). */
  tier(): 0 | 1 | 2 {
    const sim = this.sim;
    const a = sim.action;
    if (!a) return 0;
    switch (a.kind) {
      case 'celebrate':
      case 'kickoff':
      case 'halftime':
      case 'goalkick':
      case 'throw':
        return 0;
      case 'shot':
      case 'header':
      case 'save':
        return 2;
      case 'corner':
      case 'freekick':
      case 'penalty':
        // the wait before a set piece is dead time; the delivery is the moment to watch
        return sim.t > a.t1 - 3 ? 2 : 0;
    }
    const u = Math.max(sim.progress(a.side, a.from.x), sim.progress(a.side, a.to.x));
    return u > 0.84 ? 2 : u > 0.7 ? 1 : 0;
  }

  /** How much a shot matters, read from the buffer (its outcome is already simulated): 3 goal, 2 on target or a clear-cut chance, 1 the rest. */
  private importance(i: number): 1 | 2 | 3 {
    const before = (i > 0 ? this.buf[i - 1].frame : this.shown?.frame) ?? this.buf[i].frame;
    let after = this.buf[i].frame;
    for (let j = i; j < this.buf.length && this.buf[j].t <= this.buf[i].t + 4; j++) after = this.buf[j].frame;
    const goals = (f: Snap['frame']) => f.sc[0] + f.sc[1];
    if (goals(after) > goals(before)) return 3;
    if (after.onT[0] + after.onT[1] > before.onT[0] + before.onT[1] || after.x.bc[0] + after.x.bc[1] > before.x.bc[0] + before.x.bc[1]) return 2;
    return 1;
  }

  /** Which shots fit in the time left (all of them, or the more important ones), and how fast to show them. */
  private plan(base: number): { min: 1 | 2 | 3; watch: number; perGame: number } {
    const P = PACING;
    const remGame = Math.max(60, 5700 - this.showT);
    const remReal = Math.max(1, 5700 / base - this.playedMs / 1000);
    const win = P.leadIn + P.after;
    const budget = remReal - remGame / (base * P.maxIdle);
    for (const k of [1, 2, 3] as const) {
      const perGame = ([1, 2, 3] as const).filter((x) => x >= k).reduce((sum, x) => sum + P.rate[x], 0);
      if ((remGame * perGame * win) / P.watch <= budget) return { min: k, watch: P.watch, perGame };
    }
    // even the goals alone don't fit at the normal speed: show them a little faster
    const perGame = P.rate[3];
    return { min: 3, watch: Math.min(P.maxWatch, Math.max(P.watch, (remGame * perGame * win) / Math.max(1, budget))), perGame };
  }

  /** Game seconds per real second right now, for a match whose plain speed is `base`. */
  private pace(base: number): number {
    const P = PACING;
    if (this.showT < this.hlUntil) {
      this.live = true;
      return this.watchSpeed;
    }
    // the next shot entering the lead-in: decide now whether it becomes a highlight
    const i = this.buf.findIndex((s) => s.mark === 1 && s.t <= this.showT + P.leadIn && !this.judged.has(s.t));
    const plan = this.plan(base);
    if (i >= 0) {
      const shot = this.buf[i];
      this.judged.add(shot.t);
      if (this.importance(i) >= plan.min) {
        this.hlUntil = shot.t + P.after;
        this.watchSpeed = plan.watch;
        this.live = true;
        return plan.watch;
      }
    }
    // idle: the clock runs to fill the time the highlights still to come won't use
    this.live = false;
    const remGame = Math.max(60, 5700 - this.showT);
    const remReal = Math.max(1, 5700 / base - this.playedMs / 1000);
    const hlGame = remGame * plan.perGame * (P.leadIn + P.after);
    const idle = (remGame - hlGame) / Math.max(0.5, remReal - hlGame / plan.watch);
    return Math.min(base * P.maxIdle, Math.max(base, idle));
  }

  /** Advance by real milliseconds; `base` is the plain match speed (game seconds per real second). */
  tick(realMs: number, base: number) {
    if (this.ended) return;
    if ((this.sim.pkPending || this.sim.spotPending) && this.buf.length === 0) {
      this.paused = false;
      return this.tickShootout(realMs);
    }
    if (this.paused) {
      if (performance.now() - this.pausedAt > PAUSE_LIMIT_MS) this.resume();
      return;
    }
    // play the buffer back, one snapshot at a time, at the speed each moment deserves
    let realLeft = realMs / 1000;
    let guard = 0;
    while (realLeft > 1e-6 && guard++ < 2000) {
      this.produce();
      const next = this.buf[0];
      if (!next) break;
      const speed = this.pace(base);
      this.speedNow = speed;
      const need = Math.max(0, next.t - this.showT) / speed;
      if (need > realLeft) {
        this.showT += realLeft * speed;
        this.playedMs += realLeft * 1000;
        break;
      }
      realLeft -= need;
      this.playedMs += need * 1000;
      this.show(this.buf.shift()!);
    }
  }

  /** Simulate the rest instantly (Simular rápido). */
  finishNow(): MatchResult {
    this.paused = false;
    // everything simulated so far goes on screen at once
    for (const s of this.buf.splice(0)) this.show(s);
    if (this.sim.spotPending) {
      // a penalty half-taken: the AI takes it, then the rest is simulated
      this.pk = null;
      this.sim.autoSpotKick();
    }
    if (this.sim.pkPending && this.pk) {
      // finish the shootout already under way with AI choices
      this.sim.endWithPens(autoShootout(this.pk.so, this.pk.takers, this.sim.pkKeepers(), this.sim.rng));
    } else this.sim.runToEnd();
    this.evQueue.push(...this.sim.events.slice(this.evCut));
    this.evCut = this.sim.events.length;
    this.shown = { t: this.sim.t, frame: this.capture(), ev: [], tier: 0, mark: 0 };
    this.showT = this.sim.t;
    this.detailDirty = true;
    return this.sim.result();
  }

  private ballPos(): { x: number; y: number; z: number } {
    const a = this.sim.action;
    if (!a) return { ...this.sim.ball, z: 0 };
    const span = Math.max(0.01, a.t1 - a.t0);
    // set pieces and restarts: the ball waits at the spot, then travels in the last moments
    const setPiece = ['corner', 'freekick', 'goalkick', 'throw', 'penalty', 'celebrate'].includes(a.kind);
    const travel = Math.min(setPiece ? 2.2 : span, span);
    const start = a.t1 - travel;
    const k = Math.min(1, Math.max(0, (this.sim.t - start) / travel));
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    return {
      x: a.from.x + (a.to.x - a.from.x) * e,
      y: a.from.y + (a.to.y - a.from.y) * e,
      z: a.lofted ? Math.sin(Math.PI * k) * 5 : 0,
    };
  }

  private moveBodies(dt: number) {
    const sim = this.sim;
    const ball = this.ballPos();
    const a = sim.action;
    const celebrating = a?.kind === 'celebrate' || a?.kind === 'kickoff';
    let presser: number | null = null;
    if (a && !celebrating) {
      // closest defender presses the ball
      const def = (1 - a.side) as 0 | 1;
      let best = Infinity;
      for (const pid of sim.sides[def].onPitch) {
        if (pid == null) continue;
        const b = this.bodies.get(pid);
        if (!b) continue;
        const d = (b.x - ball.x) ** 2 + (b.y - ball.y) ** 2;
        if (d < best) {
          best = d;
          presser = pid;
        }
      }
    }
    for (const side of [0, 1] as const) {
      const s = sim.sides[side];
      const inPoss = sim.poss === side;
      const ub = sim.progress(side, ball.x);
      s.onPitch.forEach((pid, i) => {
        if (pid == null) return;
        const sl = s.slots[i];
        let body = this.bodies.get(pid);
        if (!body) {
          body = { x: sim.toX(side, sl.x * 0.5), y: this.yAbs(side, sl.y) };
          this.bodies.set(pid, body);
        }
        let tx: number;
        let ty: number;
        if (celebrating) {
          tx = sim.toX(side, 0.03 + sl.x * 0.44);
          ty = this.yAbs(side, sl.y);
        } else if (sl.pos === 'GOL') {
          tx = sim.toX(side, 0.015 + 0.06 * ub);
          ty = PITCH_H / 2 + (ball.y - PITCH_H / 2) * 0.25;
        } else {
          const u = inPoss ? 0.12 + sl.x * 0.75 + (ub - 0.5) * 0.3 : 0.06 + sl.x * 0.62 + (ub - 0.5) * 0.28;
          const v = sl.y + (ball.y / PITCH_H - 0.5) * 0.25 * (1 - Math.abs(sl.y - 0.5));
          tx = sim.toX(side, Math.min(0.97, Math.max(0.03, u)));
          ty = this.yAbs(side, Math.min(0.97, Math.max(0.03, v)));
        }
        if (a && !celebrating) {
          if (pid === a.actor && sim.t < a.t0 + 1.5) {
            tx = a.from.x;
            ty = a.from.y;
          } else if (pid === a.target || (pid === a.actor && a.kind === 'dribble')) {
            tx = a.to.x;
            ty = a.to.y;
          } else if (pid === presser) {
            tx = ball.x;
            ty = ball.y;
          }
        }
        const dx = tx - body.x;
        const dy = ty - body.y;
        const dist = Math.hypot(dx, dy);
        const maxStep = 7.5 * dt;
        if (dist > 0.01) {
          const k = Math.min(1, maxStep / dist);
          body.x += dx * k;
          body.y += dy * k;
        }
      });
    }
  }

  pause(side: 0 | 1): string | null {
    if (this.sim.ended) return 'Partida encerrada';
    if (this.inShootout) return 'Cobrança de pênalti em andamento';
    if (this.paused) return null;
    if (this.pauses[side] >= MAX_PAUSES) return `Limite de ${MAX_PAUSES} pausas atingido`;
    this.pauses[side]++;
    this.paused = true;
    this.pausedBy = side;
    this.pausedAt = performance.now();
    this.detailDirty = true;
    return null;
  }

  resume(side?: 0 | 1): string | null {
    if (!this.paused) return null;
    if (side != null && this.pausedBy !== side && this.humans[this.pausedBy ?? 0]) return 'Só quem pausou pode retomar';
    this.paused = false;
    this.pausedBy = null;
    this.detailDirty = true;
    return null;
  }

  /** What the screen shows now (the latest shown moment) plus the events since the last frame. */
  frame(): LiveFrame {
    let f = this.shown?.frame ?? this.capture();
    // between two simulated moments: blend positions, so every frame moves (no stop-start on screen)
    const a = this.shown;
    const b = this.buf[0];
    if (a && b && b.t > a.t && this.showT > a.t) {
      const k = Math.min(1, (this.showT - a.t) / (b.t - a.t));
      const p = a.frame.p.map((v, i) => {
        const slot = i >> 1;
        const w = b.frame.p[i];
        return a.frame.ids[slot] === b.frame.ids[slot] && v >= 0 && w >= 0 ? Math.round(v + (w - v) * k) : v;
      });
      const ball = a.frame.b.map((v, i) => Math.round(v + (b.frame.b[i] - v) * k)) as [number, number, number];
      f = { ...a.frame, p, b: ball };
    }
    return {
      ...f,
      paused: this.paused,
      pausedBy: this.pausedBy,
      ended: this.ended,
      hl: this.live,
      ev: this.evQueue.splice(0),
      pk: this.buf.length === 0 ? this.pkFrame() : undefined,
    };
  }

  /** The current simulated moment as a frame (positions, score, stats). */
  private capture(): Snap['frame'] {
    const sim = this.sim;
    const ids: number[] = [];
    const p: number[] = [];
    for (const side of [0, 1] as const) {
      const s = sim.sides[side];
      for (let i = 0; i < 11; i++) {
        const pid = s.onPitch[i] ?? null;
        const b = pid != null ? this.bodies.get(pid) : null;
        ids.push(pid ?? 0);
        p.push(b ? Math.round(b.x * 10) : -1, b ? Math.round(b.y * 10) : -1);
      }
    }
    const ball = this.ballPos();
    const st = sim.stats;
    const pair = (k: keyof (typeof st)[0], m = 1): [number, number] => [Math.round(st[0][k] * m), Math.round(st[1][k] * m)];
    const act = sim.action;
    return {
      f: this.fixtureId,
      t: Math.round(sim.t),
      half: sim.half,
      sc: [...sim.score] as [number, number],
      pens: sim.pens,
      ids,
      p,
      b: [Math.round(ball.x * 10), Math.round(ball.y * 10), Math.round(ball.z * 10)],
      poss: sim.possPct(),
      shots: [st[0].shots, st[1].shots],
      onT: [st[0].onTarget, st[1].onTarget],
      cards: [st[0].yel, st[1].yel, st[0].red, st[1].red],
      x: {
        pas: pair('passes'),
        pf: pair('passFail'),
        tk: pair('tackles'),
        bc: pair('big'),
        xg: pair('xg', 100),
        co: pair('corners'),
        fo: pair('fouls'),
        sv: pair('saves'),
      },
      car: (act && act.kind !== 'celebrate' ? (act.target ?? act.actor) : sim.carrier) ?? 0,
      ac: act
        ? {
            k: act.kind,
            s: act.side,
            a: act.actor ?? 0,
            g: act.target ?? 0,
            id: Math.round(act.t0 * 10),
            u: Math.round(Math.min(1, Math.max(0, sim.progress(act.side, act.from.x), sim.progress(act.side, act.to.x))) * 100),
            ...(act.res ? { r: act.res } : {}),
          }
        : undefined,
    };
  }

  detail(): LiveDetail {
    this.detailDirty = false;
    const at = this.sim.momentumBucket();
    return {
      f: this.fixtureId,
      mom: [0, 1].map((s) => this.sim.momentum[s].slice(0, at + 1).map((v) => Math.round(v * 10))) as [number[], number[]],
      momAt: at,
      sides: this.sim.sides.map((s, side) => {
        const fit: Record<number, number> = {};
        const rt: Record<number, number> = {};
        const yel: number[] = [];
        const off: number[] = [];
        for (const pl of s.players.values()) {
          fit[pl.id] = Math.round(pl.fitness);
          if (pl.on != null) rt[pl.id] = Math.round(matchRating(pl) * 10);
          if (pl.yellow > 0) yel.push(pl.id);
          if (pl.off != null || pl.red || pl.injured) off.push(pl.id);
        }
        return {
          onPitch: [...s.onPitch],
          bench: [...s.bench],
          subs: s.subs,
          tactics: { ...s.tactics, shape: s.tactics.shape ? [...s.tactics.shape] : null },
          fit,
          rt,
          yel,
          off,
          pauses: this.pauses[side],
        };
      }),
    };
  }
}

export const PITCH = { W: PITCH_W, H: PITCH_H };
