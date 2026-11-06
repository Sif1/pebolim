import type { Tactics } from '../types';
import { matchRating, MatchSim, PITCH_H, PITCH_W, type MatchEvent, type MatchResult, type MatchSetup } from './core';
import { aiDive, aiShot, autoShootout, kickOutcome, type PkDir, type PkOutcome, type PkTaker, type Shootout } from './shootout';

/** Real-time length of each shootout step, in ms. */
export const PK_TIMES = {
  /** managers pick their five takers */
  order: 30_000,
  /** taker picks a corner, keeper picks a side */
  aim: 10_000,
  /** run-up, shot and reaction on screen */
  anim: 3_400,
};

/** A shootout as clients see it. During 'aim' nobody sees the other side's choice. */
export interface PkFrame {
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
 * Highlight pacing: key moments (shots, set-piece deliveries, the ball in the box) play slowly, attacks in the
 * final third at twice that, and the rest speeds up so the match still lasts about the length the host chose.
 */
export const PACING = {
  /** slowest speed, in game seconds per real second (real time = 1) */
  minSlow: 6,
  /** key moments play at least this many times slower than the plain match speed */
  slowFactor: 3.5,
  /** expected share of game time in key moments / final-third attacks (the budget corrects itself as it goes) */
  shareKey: 0.17,
  shareAttack: 0.1,
  /** the rest never goes faster than this multiple of the plain speed */
  maxFast: 4,
};

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
  paused: boolean;
  pausedBy: 0 | 1 | null;
  ended: boolean;
  /** events since the previous frame */
  ev: MatchEvent[];
  /** penalty shootout in progress */
  pk?: PkFrame;
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
  private evSent = 0;
  detailDirty = true;
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

  get inShootout() {
    return this.sim.pkPending;
  }

  private startShootout() {
    const so = this.sim.newShootout();
    this.pk = {
      so,
      phase: 'order',
      left: PK_TIMES.order,
      ready: [!this.humans[0], !this.humans[1]],
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
      if (!n) return this.sim.endWithPens(pk.so.score);
      const shotIn = pk.shot != null || !this.humans[n.side];
      const diveIn = pk.dive != null || !this.humans[1 - n.side];
      if ((shotIn && diveIn) || pk.left <= 0) this.takeKick();
    } else if (pk.left <= 0) {
      if (pk.so.next()) this.beginAim();
      else this.sim.endWithPens(pk.so.score);
    }
  }

  /** A manager's five takers, in order (the rest follow by skill). */
  pkOrder(side: 0 | 1, order: number[]): string | null {
    const pk = this.pk;
    if (!pk || pk.phase !== 'order') return 'A ordem dos batedores já foi definida.';
    const onPitch = new Set(this.sim.pkTakers(side).map((t) => t.id));
    const clean = order.filter((id, i) => onPitch.has(id) && order.indexOf(id) === i);
    if (clean.length < Math.min(5, onPitch.size)) return 'Escolha cinco batedores.';
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
    if (!pk || !this.sim.pkPending) return undefined;
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

  get ended() {
    return this.sim.ended;
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

  /** Game seconds per real second right now, for a match whose plain speed is `base`. */
  private pace(base: number): number {
    const P = PACING;
    const key = Math.min(base, Math.max(P.minSlow, base / P.slowFactor));
    const attack = Math.min(base, key * 2);
    const tier = this.tier();
    if (tier === 2) return key;
    if (tier === 1) return attack;
    const remGame = Math.max(60, 5700 - this.sim.t);
    const remReal = 5700 / base - this.playedMs / 1000;
    const slowReal = remGame * (P.shareKey / key + P.shareAttack / attack);
    const left = remReal - slowReal;
    const need = left > 1 ? ((1 - P.shareKey - P.shareAttack) * remGame) / left : Infinity;
    return Math.min(base * P.maxFast, Math.max(base * 0.8, need));
  }

  /** Advance by real milliseconds; `base` is the plain match speed (game seconds per real second). */
  tick(realMs: number, base: number) {
    if (this.sim.ended) return;
    if (this.sim.pkPending) {
      this.paused = false;
      return this.tickShootout(realMs);
    }
    if (this.paused) {
      if (performance.now() - this.pausedAt > PAUSE_LIMIT_MS) this.resume();
      return;
    }
    // small slices so a fast stretch can't run through the start of an attack
    let realLeft = realMs / 1000;
    let guard = 0;
    while (realLeft > 1e-6 && !this.sim.ended && guard++ < 400) {
      const speed = this.pace(base);
      this.speedNow = speed;
      const dt = Math.min(1.5, realLeft * speed);
      const before = this.sim.events.length;
      this.sim.step(dt);
      if (this.sim.events.length !== before) this.detailDirty = true;
      this.moveBodies(dt);
      const used = dt / speed;
      realLeft -= used;
      this.playedMs += used * 1000;
    }
  }

  /** Simulate the rest instantly (Simular rápido). */
  finishNow(): MatchResult {
    this.paused = false;
    if (this.sim.pkPending && this.pk) {
      // finish the shootout already under way with AI choices
      this.sim.endWithPens(autoShootout(this.pk.so, this.pk.takers, this.sim.pkKeepers(), this.sim.rng));
      return this.sim.result();
    }
    return this.sim.runToEnd();
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
    if (this.sim.pkPending) return 'Disputa de pênaltis em andamento';
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

  frame(): LiveFrame {
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
    const ev = sim.events.slice(this.evSent);
    this.evSent = sim.events.length;
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
      paused: this.paused,
      pausedBy: this.pausedBy,
      ended: sim.ended,
      ev,
      pk: this.pkFrame(),
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
