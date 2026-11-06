import type { Tactics } from '../types';
import { matchRating, MatchSim, PITCH_H, PITCH_W, type MatchEvent, type MatchResult, type MatchSetup } from './core';

export const MAX_PAUSES = 3;
export const PAUSE_LIMIT_MS = 90_000;

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
}

/** Lineup details (sent less often): who is where, fitness, subs used. */
export interface LiveDetail {
  f: number;
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

  constructor(setup: MatchSetup, humans: [boolean, boolean]) {
    this.sim = new MatchSim(setup);
    this.fixtureId = setup.fixtureId;
    this.humans = humans;
    this.sim.sides[0].ai = !humans[0];
    this.sim.sides[1].ai = !humans[1];
    this.placeKickoff();
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

  /** Advance by real milliseconds at the given game-seconds-per-real-second speed. */
  tick(realMs: number, speed: number) {
    if (this.sim.ended) return;
    if (this.paused) {
      if (performance.now() - this.pausedAt > PAUSE_LIMIT_MS) this.resume();
      return;
    }
    const dt = (realMs / 1000) * speed;
    const steps = Math.max(1, Math.ceil(dt / 1.5));
    for (let i = 0; i < steps && !this.sim.ended; i++) {
      const before = this.sim.events.length;
      this.sim.step(dt / steps);
      if (this.sim.events.length !== before) this.detailDirty = true;
      this.moveBodies(dt / steps);
    }
  }

  /** Simulate the rest instantly (Simular rápido). */
  finishNow(): MatchResult {
    this.paused = false;
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
    };
  }

  detail(): LiveDetail {
    this.detailDirty = false;
    return {
      f: this.fixtureId,
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
