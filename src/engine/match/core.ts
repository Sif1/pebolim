import { Rng, type RngState } from '../rng';
import { AI_COACH, aiPlan, describeChange, MENTALITY_TXT, naturalStyle, preferredFormations, strengthEdge, STYLE_TXT, type Situation } from '../ai/tactics';
import type { Formation, GoalEvent, Pos, Style, Tactics, Trait } from '../types';
import { FORMATIONS, shapeLabel, slotsFor, type Slot } from './formations';
import { computeRatings, effective, overall, type RatedPlayer, type SectorRatings } from './ratings';
import { aiDive, aiShot, autoShootout, defaultOrder, kickOutcome, Shootout, type PkTaker } from './shootout';

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
  /** match rating adjustment from 6.0 (see matchRating) */
  rt: number;
  /** energy at kick-off (or when coming on) */
  fit0: number;
  /** form on the day (×força for this match), hidden */
  form: number;
}

/** Match rating 3.0-10.0, built up from 6.0 by the player's actions. */
export function matchRating(p: { rt: number }): number {
  return Math.round(Math.min(10, Math.max(3, 6 + p.rt)) * 10) / 10;
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
  | 'tactic'
  | 'penalty';

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
  /** xg: chance quality; big: clear-cut chance; gk: keeper who saved it */
  shot?: { side: 0 | 1; onTarget: boolean; pid: number; xg: number; big: boolean; gk?: number | null };
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
  /** completed and failed passes (crosses included, throw-ins not) */
  passes: number;
  passFail: number;
  /** ball won from an opponent's dribble */
  tackles: number;
  /** clear-cut chances */
  big: number;
  /** expected goals */
  xg: number;
  saves: number;
}

export interface MatchResult {
  fixtureId: number;
  hg: number;
  ag: number;
  pens: [number, number] | null;
  goals: GoalEvent[];
  players: Record<number, { side: 0 | 1; mins: number; goals: number; ast: number; yel: number; red: boolean; inj: number; fitness: number; rt: number }>;
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
  /** average effective strength of the outfield players on the pitch */
  avgEff: number;
  ai: boolean;
}

export const MAX_SUBS = 5;

/**
 * Playing styles: how often the side on the ball picks each action, and style bonuses.
 * Balanced with tools/sensitivity.ts so that no style beats the others at equal strength.
 */
export const STYLE_TUNE = {
  toque: { pass: 0.6, back: 0.14, dribble: 0.16, long: 0.1, passBonus: 0.06 },
  contra: { pass: 0.48, back: 0.22, dribble: 0.15, long: 0.15, passBonus: 0 },
  longa: { pass: 0.36, back: 0.2, dribble: 0.1, long: 0.34, passBonus: 0 },
  /** contra-ataque right after winning the ball (first actions of a possession) */
  breakActions: 2,
  breakLong: 2,
  breakDribble: 1.4,
  breakBack: 0.2,
  /** long-ball success: base + (duel where it lands − 0.5) × slope */
  longBase: 0.365,
  longSlope: 0.5,
  /** chance per open-play action of shooting in the box / from the edge of it */
  boxShot: 0.095,
  edgeShot: 0.02,
  /** scales every open-play and set-piece chance quality (penalties excluded); the main goals-per-match knob */
  xgScale: 1.22,
  // ---- matchups ----
  /** contra-ataque against a side in postura ofensiva: one more break action and this much easier on breaks */
  counterSpace: 0.03,
  /** long balls against pressão alta: the press is bypassed */
  longVsPress: 0.03,
  /** clear-cut chances against a side in postura defensiva are this much rarer (crowded box) */
  blockBig: 0.7,
  /**
   * Fouls inside the box, relative to fouls elsewhere: defenders are careful there, and a foul in the box is
   * always a penalty. Tuned to about 0.3 penalties per match, as in real leagues.
   */
  boxFoulDribble: 0.18,
  boxFoulOther: 0.06,
  /** finishing: P(goal) = xG × (shooter / keeper)^finishExp × (attack / defence)^attDefExp × home^homeShotExp */
  finishExp: 0.8,
  attDefExp: 0.4,
  homeShotExp: 0.5,
  /** how decisive strength gaps are in every duel: r = A^duelExp / (A^duelExp + D^duelExp) */
  duelExp: 2.55,
  /** middle third: share of midfield in the duel (the rest is the attackers on the ball side, the defenders on the other) */
  midMix: 0.55,
  /** energy each player loses per minute on the pitch (×1.25 pressing, ×0.95 contra-ataque, ×tire for age) */
  drain: 0.3,
  /** the AI substitutes outfield players below this energy */
  aiSubAt: 66,
  /**
   * Posture as game-state management: ofensiva shoots more but leaves space behind (the opponent's chances are
   * clear-cut more often); defensiva shoots less and crowds its box (fewer clear-cut chances against).
   */
  ofShot: 1.3,
  defShot: 0.75,
  ofExposed: 1.3,
  /** the opponent's shot rate when you sit deep (blocked shots) / push forward (open game) */
  shotVsDef: 0.85,
  shotVsOf: 1.05,
  /** share of the energy lost in a match still missing at the next round (the rest is just "match legs") */
  fatiguePersist: 0.35,
  /** energy back at half-time */
  htRecover: 6,
  /** spread of players' form on the day (standard deviation, ×força) */
  formSd: 0.07,
  /** success-chance shift per 100% the player on the ball is above his team's average */
  indiv: 0.8,
  /** shot rate kept for every goal of lead beyond two (teams ease off when the game is won) */
  comfort: 0.6,
};

/** Minutes at which the AI coach reviews posture, style, pressing and formation. */
export const AI_REVIEW_AT = [15, 30, 45, 60, 75, 85];

interface AiMemory {
  lastChange: number;
  goals: number;
  reds: number;
  ownReds: number;
  formationChanged: boolean;
  tiredSubAt: number;
}

const emptyStats = (): SideStats => ({
  poss: 0,
  shots: 0,
  onTarget: 0,
  corners: 0,
  fouls: 0,
  yel: 0,
  red: 0,
  passes: 0,
  passFail: 0,
  tackles: 0,
  big: 0,
  xg: 0,
  saves: 0,
});

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
  /** 'live': a human is in this match, so a shootout waits to be played kick by kick (see LiveMatch) */
  pkMode: 'auto' | 'live' = 'auto';
  /** full time with the tie level: the shootout is due (live mode only) */
  pkPending = false;
  /** a penalty was given in a match with a human: it waits to be taken kick by kick (live mode only) */
  spotPending: { side: 0 | 1; taker: number | null } | null = null;
  stats: [SideStats, SideStats] = [emptyStats(), emptyStats()];
  events: MatchEvent[] = [];
  goals: GoalEvent[] = [];
  /** attacking pressure per minute for each side (90 buckets; stoppage time folds into minutes 45 and 90) */
  momentum: [number[], number[]] = [new Array(90).fill(0), new Array(90).fill(0)];
  action: Action | null = null;
  ended = false;
  private effects: Effects | null = null;
  private setPiece: SetPiece = 'kickoff';
  private lastPasser: number | null = null;
  private lastMinute = -1;
  /** open-play decisions since the side on the ball won it */
  private possActions = 0;
  /** squad strength at kick-off (força points), used by the AI to judge who is the favourite */
  readonly power: [number, number] = [70, 70];
  /** the style each side's players suit */
  readonly natural: [Style, Style] = ['toque', 'toque'];
  private ai: [AiMemory, AiMemory] = [0, 1].map(() => ({ lastChange: 0, goals: 0, reds: 0, ownReds: 0, formationChanged: false, tiredSubAt: 0 })) as [
    AiMemory,
    AiMemory,
  ];

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.rng = new Rng(setup.seed);
    this.sides = [this.makeSide(setup.home, 0), this.makeSide(setup.away, 1)];
    this.added = [this.rng.int(0, 3) * 60, this.rng.int(2, 6) * 60];
    for (const s of this.sides) {
      for (const pid of s.onPitch) if (pid != null) s.players.get(pid)!.on = 0;
    }
    this.recalc();
    for (const side of [0, 1] as const) {
      const s = this.sides[side];
      const xi = s.onPitch.map((id) => (id != null ? s.players.get(id)! : null));
      this.power[side] = overall(computeRatings(s.slots, xi, { ...s.tactics, mentality: 'equilibrada', marking: 'zona' }));
      this.natural[side] = naturalStyle(xi.filter((p): p is MPlayer => !!p));
    }
    this.carrier = this.pickByPos(0, ['ATA', 'MEI']);
  }

  private makeSide(ts: TeamSetup, side: 0 | 1): SideState {
    const players = new Map<number, MPlayer>();
    for (const p of ts.players) {
      // form on the day: hidden, it shows through the player's actions (and so his live rating)
      const form = Math.min(1 + 2 * STYLE_TUNE.formSd, Math.max(1 - 2 * STYLE_TUNE.formSd, this.rng.normal(1, STYLE_TUNE.formSd)));
      players.set(p.id, {
        ...p,
        str: p.str * form,
        form,
        traits: [...p.traits],
        side,
        yellow: 0,
        red: false,
        injured: false,
        injDates: 0,
        fit0: p.fitness,
        goals: 0,
        ast: 0,
        on: null,
        off: null,
        rt: 0,
      });
    }
    const slots = slotsFor(ts.tactics);
    return {
      setup: ts,
      tactics: { ...ts.tactics, shape: ts.tactics.shape ? [...ts.tactics.shape] : null },
      slots,
      onPitch: slots.map((_, i) => ts.xi[i] ?? null),
      bench: [...ts.bench],
      subs: 0,
      players,
      ratings: { gk: 50, def: 50, mid: 50, att: 50 },
      avgEff: 60,
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
      let sum = 0;
      let n = 0;
      s.onPitch.forEach((id, i) => {
        if (id == null || s.slots[i].pos === 'GOL') return;
        sum += effective(s.players.get(id)!, s.slots[i].pos);
        n++;
      });
      s.avgEff = n ? sum / n : 60;
    }
  }

  /** How much better (or worse) the player on the ball is than his team-mates, as a success-chance shift. */
  private individual(side: 0 | 1, pid: number | null): number {
    if (pid == null) return 0;
    const s = this.sides[side];
    const slot = s.onPitch.indexOf(pid);
    if (slot < 0) return 0;
    const e = effective(s.players.get(pid)!, s.slots[slot].pos);
    return Math.max(-0.12, Math.min(0.12, (e / Math.max(20, s.avgEff) - 1) * STYLE_TUNE.indiv));
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

  /** Move a player already on the pitch to another slot (swap). Returns an error message or null. */
  swapSlots(side: 0 | 1, a: number, b: number): string | null {
    const s = this.sides[side];
    const n = s.onPitch.length;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n || a === b) return 'Troca inválida';
    if (this.ended) return 'Partida encerrada';
    [s.onPitch[a], s.onPitch[b]] = [s.onPitch[b], s.onPitch[a]];
    this.recalc();
    return null;
  }

  /** Best-fit seating of the players on the pitch into a set of slots (the keeper slot stays filled first). */
  private seat(side: 0 | 1, slots: Slot[]): (number | null)[] {
    const s = this.sides[side];
    const current = s.onPitch.filter((x): x is number => x != null).map((id) => s.players.get(id)!);
    const assigned: (number | null)[] = slots.map(() => null);
    const pairs: { si: number; p: MPlayer; e: number }[] = [];
    slots.forEach((sl, si) => current.forEach((p) => pairs.push({ si, p, e: effective(p, sl.pos) + (sl.pos === 'GOL' ? 1000 : 0) })));
    pairs.sort((x, y) => y.e - x.e);
    const used = new Set<number>();
    for (const pr of pairs) {
      if (assigned[pr.si] != null || used.has(pr.p.id)) continue;
      assigned[pr.si] = pr.p.id;
      used.add(pr.p.id);
    }
    return assigned;
  }

  setTactics(side: 0 | 1, t: Tactics, text?: string) {
    const s = this.sides[side];
    const newSlots = slotsFor(t);
    // a new preset formation re-seats everyone; moving positions around keeps each player in his slot
    if (t.formation !== s.tactics.formation && !t.shape) s.onPitch = this.seat(side, newSlots);
    s.slots = newSlots;
    s.tactics = { ...t, shape: t.shape ? [...t.shape] : null };
    this.events.push({
      t: this.t,
      kind: 'tactic',
      side,
      text: text ?? `${s.setup.short}: ${shapeLabel(t)}, ${MENTALITY_TXT[t.mentality]}, ${STYLE_TXT[t.style]}${t.marking === 'pressao' ? ', pressão alta' : ''}`,
    });
    this.recalc();
  }

  // ---------- stats and ratings ----------
  private rate(pid: number | null | undefined, d: number) {
    if (pid == null) return;
    const p = this.player(pid);
    if (p) p.rt += d;
  }
  private passOk(side: 0 | 1, pid: number | null, d = 0.012) {
    this.stats[side].passes++;
    this.rate(pid, d);
  }
  private passBad(side: 0 | 1, pid: number | null) {
    this.stats[side].passFail++;
    this.rate(pid, -0.06);
  }

  // ---------- simulation ----------
  /** Advance the game clock by dt seconds (live mode). */
  step(dt: number) {
    if (this.ended || this.pkPending || this.spotPending) return;
    const target = this.t + dt;
    while (!this.ended && !this.pkPending && !this.spotPending) {
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
    while (!this.ended && !this.pkPending && guard++ < 20000) {
      if (this.spotPending) {
        // nobody is choosing: the penalty is taken with AI choices
        this.autoSpotKick();
        continue;
      }
      if (!this.action) this.beginNext();
      else {
        this.t = this.action.t1;
        this.minuteTicks();
        this.finishAction();
      }
    }
    if (this.pkPending && !this.ended) this.endWithPens(this.shootout());
    return this.result();
  }

  /** Everyone on the pitch as a penalty taker (tired legs kick a little worse). */
  pkTakers(side: 0 | 1): PkTaker[] {
    return this.playersOnPitch(side).map((p) => ({
      id: p.id,
      name: p.name,
      str: p.str * (0.85 + 0.0015 * p.fitness),
      pen: p.traits.includes('cobrancas'),
      gk: p.pos === 'GOL',
    }));
  }

  /** Keeper ratings [home, away] for penalties. */
  pkKeepers(): [number, number] {
    return [this.sides[0].ratings.gk, this.sides[1].ratings.gk];
  }

  /** Take the pending penalty with the given taker and outcome (0 goal, 1 saved, 2 missed). */
  resolveSpotKick(taker: number, out: 0 | 1 | 2) {
    const sp = this.spotPending;
    if (!sp) return;
    this.spotPending = null;
    this.poss = sp.side;
    const onPitch = this.sides[sp.side].onPitch.includes(taker);
    this.doShot('penalty', onPitch ? taker : sp.taker, undefined, out);
  }

  /** The pending penalty with AI choices on both sides. */
  autoSpotKick() {
    const sp = this.spotPending;
    if (!sp) return;
    const takers = this.pkTakers(sp.side);
    const t = takers.find((x) => x.id === sp.taker) ?? takers.find((x) => !x.gk) ?? takers[0];
    if (!t) {
      this.spotPending = null;
      return;
    }
    const dir = aiShot(this.rng);
    const out = kickOutcome(t, this.pkKeepers()[1 - sp.side], dir, aiDive(this.rng, []), this.rng);
    this.resolveSpotKick(t.id, out);
  }

  /** A new shootout: a coin toss for who kicks first, best takers first. */
  newShootout(): Shootout {
    const first: 0 | 1 = this.rng.chance(0.5) ? 0 : 1;
    return new Shootout(first, [defaultOrder(this.pkTakers(0)), defaultOrder(this.pkTakers(1))]);
  }

  /** Close the match with the shootout's result. */
  endWithPens(score: [number, number]) {
    this.pkPending = false;
    this.pens = score;
    this.events.push({ t: this.t, kind: 'pens', side: score[0] > score[1] ? 0 : 1, text: `Pênaltis: ${score[0]} x ${score[1]}` });
    this.close();
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
        let rate = STYLE_TUNE.drain * p.tire;
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

  /** What the AI coach of `side` sees right now. */
  situation(side: 0 | 1, minute: number): Situation {
    const s = this.sides[side];
    const o = this.sides[1 - side];
    let diff = this.score[side] - this.score[1 - side];
    const dec = this.setup.decider;
    if (dec) diff += side === 0 ? dec.aggHome - dec.aggAway : dec.aggAway - dec.aggHome;
    const mine = s.onPitch.filter((x): x is number => x != null);
    const energy = mine.length ? mine.reduce((a, id) => a + s.players.get(id)!.fitness, 0) / mine.length : 0;
    return {
      minute,
      diff,
      men: mine.length - o.onPitch.filter((x) => x != null).length,
      edge: strengthEdge(this.power[side], this.power[1 - side], side === 0),
      home: side === 0,
      decider: !!dec,
      energy,
      opp: o.tactics,
      natural: this.natural[side],
    };
  }

  /**
   * The AI coach: reorganises at once after a red card, makes tired and tactical substitutions, and re-reads
   * the game at the minutes in AI_REVIEW_AT, changing posture, style, pressing and formation.
   */
  private aiDecisions(side: 0 | 1, minute: number) {
    const s = this.sides[side];
    const mem = this.ai[side];
    if (this.stats[side].red > mem.ownReds) {
      mem.ownReds = this.stats[side].red;
      this.aiReorganise(side);
    }
    // tired legs from the hour mark (at most one change every 7 minutes)
    if (minute >= 55 && minute - mem.tiredSubAt >= 7 && s.subs < MAX_SUBS - (minute < 80 ? 1 : 0)) {
      let worst: { pid: number; slot: number; f: number } | null = null;
      s.onPitch.forEach((pid, slot) => {
        if (pid == null || s.slots[slot].pos === 'GOL') return;
        const p = s.players.get(pid)!;
        if (p.fitness < STYLE_TUNE.aiSubAt && (!worst || p.fitness < worst.f)) worst = { pid, slot, f: p.fitness };
      });
      if (worst) {
        const w = worst as { pid: number; slot: number; f: number };
        const sub = this.bestBenchFor(side, s.slots[w.slot].pos);
        if (sub != null && !this.sub(side, w.pid, sub)) mem.tiredSubAt = minute;
      }
    }

    if (!AI_COACH.enabled) return;
    // the AI coach re-reads the game at fixed moments, like a manager on the touchline: it does not react to
    // every goal at once, which leaves room for an attentive human to be quicker
    if (!AI_REVIEW_AT.includes(minute)) return;

    const sit = this.situation(side, minute);
    const plan = aiPlan(sit);
    let formation: Formation = s.tactics.formation;
    // late changes of shape (once per match), with a matching substitution when the bench allows it
    const chasing = sit.diff < 0 && minute >= 70;
    const holding = sit.diff > 0 && minute >= 78;
    if (!mem.formationChanged && sit.men >= 0 && (chasing || holding)) {
      const prefs = preferredFormations(plan, sit.men).filter((f) => f !== formation);
      const best = this.bestShape(side, prefs, plan.mentality);
      if (best) {
        const wantRole: Pos[] = chasing ? ['ATA'] : ['ZAG', 'VOL'];
        const outRoles: Pos[] = chasing ? ['VOL', 'ZAG'] : ['ATA'];
        this.roleSub(side, outRoles, wantRole);
        formation = best;
        mem.formationChanged = true;
      }
    }
    const t = s.tactics;
    if (formation === t.formation && plan.mentality === t.mentality && plan.style === t.style && plan.marking === t.marking) return;
    const next: Tactics = { ...t, formation, shape: formation === t.formation ? t.shape : null, mentality: plan.mentality, style: plan.style, marking: plan.marking };
    this.setTactics(side, next, describeChange(s.setup.name, t, { ...plan, formation }));
    mem.lastChange = minute;
  }

  /** The formation from `cands` that suits the players on the pitch best (or null if none is close to the current one). */
  private bestShape(side: 0 | 1, cands: Formation[], mentality: Tactics['mentality']): Formation | null {
    const s = this.sides[side];
    const score = (slots: Slot[], xi: (number | null)[]) =>
      overall(computeRatings(slots, xi.map((id) => (id != null ? s.players.get(id)! : null)), { ...s.tactics, mentality, marking: 'zona' }));
    const now = score(s.slots, s.onPitch);
    let best: Formation | null = null;
    let bestR = now - 1.5;
    for (const f of cands) {
      const slots = FORMATIONS[f];
      const r = score(slots, this.seat(side, slots));
      if (r > bestR) {
        bestR = r;
        best = f;
      }
    }
    return best;
  }

  /** Substitute the weakest player in one of `outRoles` with the best bench player of one of `inRoles`. */
  private roleSub(side: 0 | 1, outRoles: Pos[], inRoles: Pos[]) {
    const s = this.sides[side];
    if (s.subs >= MAX_SUBS) return;
    let inn: { id: number; e: number } | null = null;
    for (const id of s.bench) {
      const p = s.players.get(id)!;
      if (p.injured || !inRoles.includes(p.pos)) continue;
      const e = effective(p, p.pos);
      if (!inn || e > inn.e) inn = { id, e };
    }
    if (!inn) return;
    let out: { id: number; e: number } | null = null;
    s.onPitch.forEach((id, i) => {
      if (id == null || !outRoles.includes(s.slots[i].pos)) return;
      const e = effective(s.players.get(id)!, s.slots[i].pos);
      if (!out || e < out.e) out = { id, e };
    });
    const o = out as { id: number; e: number } | null;
    if (o) this.sub(side, o.id, inn.id);
  }

  /** After a red card: fill a hole in the back line or midfield with the most advanced player (or a bench defender). */
  private aiReorganise(side: 0 | 1) {
    const s = this.sides[side];
    const hole = s.onPitch.findIndex((id, i) => id == null && s.slots[i].pos !== 'GOL' && s.slots[i].pos !== 'ATA');
    if (hole < 0) return;
    const role = s.slots[hole].pos;
    // the most advanced outfield player
    let fwd = -1;
    s.onPitch.forEach((id, i) => {
      if (id == null || s.slots[i].pos === 'GOL') return;
      if (fwd < 0 || s.slots[i].x > s.slots[fwd].x) fwd = i;
    });
    if (fwd < 0 || s.slots[fwd].x <= s.slots[hole].x) return;
    const fwdId = s.onPitch[fwd]!;
    const benchId = this.bestBenchFor(side, role);
    let text: string;
    if (benchId != null && s.subs < MAX_SUBS && effective(s.players.get(benchId)!, role) > effective(s.players.get(fwdId)!, role)) {
      this.sub(side, fwdId, benchId);
      s.onPitch[hole] = benchId;
      s.onPitch[fwd] = null;
      text = `${s.setup.name} recompõe o time: ${s.players.get(benchId)!.name} entra para fechar o buraco`;
    } else {
      s.onPitch[hole] = fwdId;
      s.onPitch[fwd] = null;
      text = `${s.setup.name} recompõe o time: ${s.players.get(fwdId)!.name} recua para ${role}`;
    }
    this.events.push({ t: this.t, kind: 'tactic', side, text });
    this.recalc();
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
      const k = STYLE_TUNE.midMix;
      atk = k * a.mid + (1 - k) * a.att;
      def = k * d.mid + (1 - k) * d.def;
    } else {
      atk = 0.65 * a.att + 0.35 * a.mid;
      def = 0.7 * d.def + 0.3 * d.mid;
    }
    if (this.poss === 0) atk *= this.setup.homeAdv;
    else def *= this.setup.homeAdv;
    const ka = Math.pow(atk, STYLE_TUNE.duelExp);
    const kd = Math.pow(def, STYLE_TUNE.duelExp);
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

  /** Minute bucket 0-89 for the momentum graph. */
  momentumBucket(): number {
    return this.half === 1 ? Math.min(44, Math.floor(this.t / 60)) : 45 + Math.min(44, Math.max(0, Math.floor((this.t - HALF) / 60)));
  }

  private pushMomentum(side: 0 | 1, v: number) {
    this.momentum[side][this.momentumBucket()] += v;
  }

  private finishAction() {
    const a = this.action!;
    const e = this.effects!;
    this.stats[a.side].poss += a.t1 - a.t0;
    // momentum: time on the ball in the attacking third, shots (weighted by chance quality), corners, goals
    if (e.poss === a.side && a.kind !== 'celebrate' && a.kind !== 'kickoff') {
      const u = this.progress(a.side, e.ball.x);
      if (u > 0.6) this.pushMomentum(a.side, Math.min(1, (u - 0.6) * 2.5));
    }
    if (e.shot) this.pushMomentum(e.shot.side, 1.5 + 6 * e.shot.xg + (e.shot.big ? 1 : 0));
    if (e.corner !== undefined) this.pushMomentum(e.corner, 0.8);
    if (e.goal) this.pushMomentum(e.goal.side, 3);
    this.action = null;
    this.effects = null;
    if (e.poss !== this.poss) this.possActions = 0;
    this.poss = e.poss;
    this.carrier = e.carrier;
    this.ball = { ...e.ball };
    this.setPiece = e.setPiece;
    if (e.lastPasser !== undefined) this.lastPasser = e.lastPasser;
    if (e.shot) {
      const sh = e.shot;
      const st = this.stats[sh.side];
      st.shots++;
      if (sh.onTarget) st.onTarget++;
      st.xg += sh.xg;
      if (sh.big) st.big++;
      if (!e.goal) {
        this.rate(sh.pid, (sh.onTarget ? 0.12 : -0.04) - (sh.big ? 0.3 : 0));
        if (sh.onTarget && sh.gk != null) {
          this.stats[1 - sh.side].saves++;
          this.rate(sh.gk, sh.big ? 0.5 : 0.25);
        }
      }
    }
    if (e.corner !== undefined) this.stats[e.corner].corners++;
    if (e.events) for (const ev of e.events) this.events.push({ ...ev, t: this.t });
    if (e.goal) {
      const g = e.goal;
      this.score[g.side]++;
      const scorer = this.player(g.pid)!;
      scorer.goals++;
      scorer.rt += g.pen ? 0.6 : 1;
      if (g.ast != null) {
        const ap = this.player(g.ast);
        if (ap) {
          ap.ast++;
          ap.rt += 0.6;
        }
      }
      for (const side of [0, 1] as const) {
        const s = this.sides[side];
        s.onPitch.forEach((pid, i) => {
          if (pid == null) return;
          const pos = s.slots[i].pos;
          if (side === g.side) this.rate(pid, 0.05);
          else this.rate(pid, pos === 'GOL' ? -0.3 : pos === 'ZAG' || pos === 'LAT' ? -0.15 : -0.04);
        });
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
          p.fitness = Math.min(100, p.fitness + STYLE_TUNE.htRecover);
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
      case 'penalty': {
        const taker = this.penaltyTaker(this.poss);
        // a human in the match: the penalty becomes the mini-game (the live match takes it from here)
        if (this.pkMode === 'live' && (!this.sides[0].ai || !this.sides[1].ai)) {
          this.spotPending = { side: this.poss, taker };
          this.action = null;
          return;
        }
        return this.doShot('penalty', taker);
      }
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
    this.passOk(s, this.carrier, 0.004);
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
      this.passOk(s, gk, 0.004);
      const to = { x: this.toX(s, 0.16), y: recv.y };
      this.start('goalkick', this.rng.range(10, 16), to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: gk }, { target: recv.pid });
      return;
    }
    const u = this.rng.range(0.42, 0.62);
    const won = this.rng.chance(0.42 + (this.duel(u) - 0.5) * 0.5);
    if (won) {
      const recv = this.pickTeammate(s, u, gk);
      this.passOk(s, gk, 0.02);
      const to = { x: this.toX(s, u), y: recv.y };
      this.start('goalkick', this.rng.range(12, 18), to, { poss: s, carrier: recv.pid, ball: to, setPiece: null, lastPasser: gk }, { target: recv.pid, lofted: true });
    } else {
      const o = (1 - s) as 0 | 1;
      const d = this.pickDefender(o, u);
      this.passBad(s, gk);
      this.rate(d, 0.03);
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
      this.passOk(s, taker);
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
    this.passOk(s, taker);
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
    const mentMod = ment === 'ofensiva' ? STYLE_TUNE.ofShot : ment === 'defensiva' ? STYLE_TUNE.defShot : 1;

    let shootP = u > 0.84 ? STYLE_TUNE.boxShot : u > 0.7 ? STYLE_TUNE.edgeShot : 0;
    shootP *= mentMod;
    const oppMent = this.sides[o].tactics.mentality;
    shootP *= oppMent === 'defensiva' ? STYLE_TUNE.shotVsDef : oppMent === 'ofensiva' ? STYLE_TUNE.shotVsOf : 1;
    // three goals up, a team eases off: fewer shots for every goal beyond two
    const lead = this.score[s] - this.score[o];
    if (lead >= 3) shootP *= Math.pow(STYLE_TUNE.comfort, lead - 2);
    if (this.rng.chance(shootP)) return this.doShot(u > 0.84 ? 'box' : 'long', this.carrier ?? this.shooter(s));

    if (u > 0.7 && Math.abs(yN - 0.5) > 0.27 && this.rng.chance(0.4)) {
      this.lastPasser = this.carrier;
      if (this.rng.chance(0.18 + (r - 0.5) * 0.3)) {
        this.passOk(s, this.carrier, 0.06);
        return this.doShot('header', this.headerTaker(s), 'cross');
      }
      if (this.rng.chance(0.3)) {
        // cleared behind for a corner
        this.passBad(s, this.carrier);
        const to = { x: this.toX(s, 0.99), y: this.ball.y < PITCH_H / 2 ? 1 : PITCH_H - 1 };
        this.start('cross', 3, to, { poss: s, carrier: null, ball: to, setPiece: 'corner', corner: s, lastPasser: null }, { lofted: true });
        return;
      }
      return this.turnover(u, 'cross', 0.06, 0.25);
    }

    const style = A.tactics.style;
    const T = STYLE_TUNE[style];
    const W = { pass: T.pass, back: T.back, dribble: T.dribble, long: T.long };
    const oppOpen = AI_COACH.matchups && this.sides[o].tactics.mentality === 'ofensiva';
    this.possActions++;
    const onBreak = style === 'contra' && this.possActions <= STYLE_TUNE.breakActions + (oppOpen ? 1 : 0);
    if (onBreak) {
      // fast break: go forward quickly before the opponent recovers its shape
      W.long *= STYLE_TUNE.breakLong;
      W.dribble *= STYLE_TUNE.breakDribble;
      W.back *= STYLE_TUNE.breakBack;
    }
    // an opponent pushing forward leaves space behind for counter-attacks
    const space = onBreak && oppOpen ? STYLE_TUNE.counterSpace : 0;
    if (u < 0.2) W.back *= 0.4;
    if (u > 0.75) W.long = 0.02;
    const kinds = Object.keys(W) as (keyof typeof W)[];
    const kind = this.rng.weighted(kinds, (k) => W[k]);
    const has = (t: Trait) => carrier?.traits.includes(t) ?? false;
    // the player on the ball matters, not just his sector: a better (or in-form) player beats his man more often
    const ind = this.individual(s, this.carrier);
    const pressing = this.sides[o].tactics.marking === 'pressao';

    let p: number;
    let du: number;
    let dur: number;
    let lofted = false;
    switch (kind) {
      case 'pass':
        p = 0.63 + T.passBonus + space + ind + (r - 0.5) * 0.4 + (has('passe') ? 0.04 : 0) - (pressing ? 0.03 : 0);
        du = this.rng.range(0.06, 0.17);
        dur = this.rng.range(2.5, 5);
        break;
      case 'back':
        p = 0.93 - (pressing ? 0.02 : 0);
        du = -this.rng.range(0.03, 0.12);
        dur = this.rng.range(2, 4);
        break;
      case 'dribble':
        p = 0.48 + space + ind * 1.5 + (r - 0.5) * 0.5 + (has('drible') ? 0.08 : 0) + (has('velocidade') ? 0.04 : 0);
        du = this.rng.range(0.04, 0.12);
        dur = this.rng.range(3, 6);
        break;
      default: {
        // judged where the ball lands: a strong defence there wins long balls
        du = this.rng.range(0.2, 0.4);
        const rd = this.duel(Math.min(0.97, u + du));
        p =
          STYLE_TUNE.longBase +
          space +
          ind +
          (rd - 0.5) * STYLE_TUNE.longSlope +
          (has('passe') ? 0.03 : 0) +
          (pressing && AI_COACH.matchups ? STYLE_TUNE.longVsPress : 0);
        dur = this.rng.range(3, 5);
        lofted = true;
      }
    }
    const nu = Math.min(0.97, Math.max(0.03, u + du));
    if (this.rng.chance(p)) {
      if (kind === 'dribble') this.rate(this.carrier, 0.07);
      else this.passOk(s, this.carrier, kind === 'back' ? 0.004 : kind === 'long' ? 0.03 : 0.012);
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
    const isPass = kind === 'pass' || kind === 'back' || kind === 'long' || kind === 'cross';
    // defenders are careful in their own box: far fewer fouls there (more when someone dribbles at them)
    const inBox = u > 0.86 && Math.abs(spot.y - PITCH_H / 2) < 20;
    const fp = inBox ? foulP * (kind === 'dribble' ? STYLE_TUNE.boxFoulDribble : STYLE_TUNE.boxFoulOther) : foulP;
    if (roll < fp) {
      // defender fouls: attacking side keeps the ball with a set piece (a penalty when it happens in the box)
      const fouler = this.pickDefender(o, u);
      const evs: MatchEvent[] = [];
      this.stats[o].fouls++;
      this.rate(fouler, inBox ? -0.4 : -0.06);
      if (fouler != null) this.cardCheck(o, fouler, evs);
      const pen = inBox;
      if (pen) evs.push({ t: 0, kind: 'penalty', side: s, text: `Pênalti para o ${this.sides[s].setup.name}!` });
      this.start(kind, dur, spot, {
        poss: s,
        carrier: this.carrier,
        ball: pen ? { x: this.toX(s, 0.895), y: PITCH_H / 2 } : spot,
        setPiece: pen ? 'penalty' : 'freekick',
        events: evs,
      });
      return;
    }
    if (roll < fp + outP) {
      if (isPass) this.passBad(s, this.carrier);
      else this.rate(this.carrier, -0.04);
      const side = spot.y < PITCH_H / 2 ? 0.5 : PITCH_H - 0.5;
      const to = { x: spot.x, y: side };
      this.start(kind, dur, to, { poss: o, carrier: null, ball: to, setPiece: 'throw', lastPasser: null });
      return;
    }
    const d = this.pickDefender(o, u);
    if (kind === 'dribble') {
      this.stats[o].tackles++;
      this.rate(d, 0.12);
      this.rate(this.carrier, -0.05);
    } else if (isPass) {
      this.passBad(s, this.carrier);
      this.rate(d, 0.06);
    }
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
      p.rt -= 0.3;
      this.stats[side].yel++;
      if (p.yellow >= 2) return this.sendOff(side, p, evs, 'Segundo amarelo');
      evs.push({ t: this.t, kind: 'yellow', side, pid, text: `Cartão amarelo para ${p.name}` });
    }
  }

  private sendOff(side: 0 | 1, p: MPlayer, evs: MatchEvent[], why: string) {
    const s = this.sides[side];
    p.red = true;
    p.rt -= 1.2;
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

  private doShot(type: 'box' | 'long' | 'header' | 'penalty' | 'freekick', pid: number | null, from?: 'corner' | 'cross' | 'freekick', forced?: 0 | 1 | 2) {
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
    // chance quality (expected goals) depends only on the situation; shooter vs keeper and attack vs defence scale it
    const { q, big } = this.chanceQuality(type, AI_COACH.matchups && D.tactics.mentality === 'defensiva', D.tactics.mentality === 'ofensiva');
    let f = Math.pow(shEff / Math.max(20, gkEff), STYLE_TUNE.finishExp);
    if (type === 'box' || type === 'header') f *= Math.pow(A.ratings.att / Math.max(20, D.ratings.def), STYLE_TUNE.attDefExp);
    if (s === 0) f *= Math.pow(this.setup.homeAdv, STYLE_TUNE.homeShotExp);
    const pGoal = Math.min(0.9, Math.max(0.01, q * f));
    const gkId = this.gkOf(o);
    const shotInfo = { side: s, pid: shooterId, xg: q, big };
    const goalY = PITCH_H / 2 + this.rng.range(-3.2, 3.2);
    const goalX = this.toX(s, 1.0);
    let ast: number | null = null;
    if (type !== 'penalty' && type !== 'freekick' && this.lastPasser != null && this.lastPasser !== shooterId) {
      const lp = this.player(this.lastPasser);
      if (lp && lp.side === s && (from || this.rng.chance(0.75))) ast = this.lastPasser;
    }
    const kind: ActionKind = type === 'header' ? 'header' : type === 'penalty' ? 'penalty' : type === 'freekick' ? 'freekick' : 'shot';
    // a penalty decided in the mini-game already took its time on screen: just the kick
    const dur = forced != null ? 3 : type === 'penalty' ? this.rng.range(40, 60) : type === 'freekick' ? this.rng.range(18, 26) : type === 'header' ? (from === 'corner' ? this.rng.range(18, 26) : 2.5) : this.rng.range(1.5, 2.5);
    if (type === 'header') {
      // ball comes in from the flank first: start the action from the shooter area visually
      this.ball = { x: this.toX(s, from === 'corner' ? 0.995 : 0.82), y: from === 'corner' ? (this.rng.chance(0.5) ? 1 : PITCH_H - 1) : this.ball.y };
    }
    if (forced != null ? forced === 0 : this.rng.chance(pGoal)) {
      const to = { x: goalX + (this.dir(s) > 0 ? 1.5 : -1.5), y: goalY };
      this.start(kind, dur, to, {
        poss: o,
        carrier: null,
        ball: to,
        setPiece: null,
        goal: { side: s, pid: shooterId, ast, pen: type === 'penalty' },
        shot: { ...shotInfo, onTarget: true },
        lastPasser: null,
      }, { actor: shooterId, lofted: type === 'header' });
      // after the goal: celebration, then kickoff for the side that conceded
      this.pendingKickoff = o;
      return;
    }
    const onTarget = forced != null ? forced === 1 : this.rng.chance(type === 'penalty' ? 0.6 : 0.36);
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
        shot: { ...shotInfo, onTarget: true, gk: gkId },
        corner: corner ? s : undefined,
        events: evs,
        lastPasser: null,
      }, { actor: shooterId, target: gk, lofted: type === 'header' });
      return;
    }
    const blocked = type === 'box' && this.rng.chance(0.28);
    if (blocked && this.rng.chance(0.5)) {
      const to = { x: this.toX(s, 0.97), y: this.ball.y < PITCH_H / 2 ? 2 : PITCH_H - 2 };
      this.start(kind, dur, to, { poss: s, carrier: null, ball: to, setPiece: 'corner', shot: { ...shotInfo, onTarget: false }, corner: s, lastPasser: null }, { actor: shooterId });
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
      shot: { ...shotInfo, onTarget: false },
      events: evs,
      lastPasser: null,
    }, { actor: shooterId, lofted: type === 'header' });
  }

  /**
   * Situation-only chance quality. Averages match the old fixed values (box 0.075, header 0.058,
   * long 0.021, free kick 0.045), so goal rates are unchanged; a few box shots and headers are clear-cut chances.
   */
  private chanceQuality(type: 'box' | 'long' | 'header' | 'penalty' | 'freekick', crowded = false, exposed = false): { q: number; big: boolean } {
    const r = this.rng;
    const k = STYLE_TUNE.xgScale;
    // a deep defensive block makes clear-cut chances rarer; a side pushing everyone forward leaves them more often
    const b = crowded ? STYLE_TUNE.blockBig : exposed ? STYLE_TUNE.ofExposed : 1;
    switch (type) {
      case 'penalty':
        return { q: 0.76, big: true };
      case 'freekick':
        return { q: k * r.range(0.03, 0.06), big: false };
      case 'long':
        return { q: k * r.range(0.01, 0.032), big: false };
      case 'header':
        return r.chance(0.06 * b) ? { q: k * r.range(0.25, 0.45), big: true } : { q: k * r.range(0.02, 0.06), big: false };
      default:
        return r.chance(0.09 * b) ? { q: k * r.range(0.28, 0.5), big: true } : { q: k * r.range(0.018, 0.072), big: false };
    }
  }

  private pendingKickoff: 0 | 1 | null = null;

  // celebration + kickoff are handled by wrapping finishAction
  private finish() {
    if (this.setup.decider) {
      const h = this.score[0] + this.setup.decider.aggHome;
      const a = this.score[1] + this.setup.decider.aggAway;
      if (h === a) {
        if (this.pkMode === 'live') {
          // a human is watching: the shootout is played kick by kick by the live match
          this.pkPending = true;
          this.action = null;
          return;
        }
        this.endWithPens(this.shootout());
        return;
      }
    }
    this.close();
  }

  private close() {
    this.events.push({ t: this.t, kind: 'ft', side: 0, text: 'Fim de jogo' });
    this.ended = true;
    this.action = null;
    for (const s of this.sides) for (const pid of s.onPitch) if (pid != null) s.players.get(pid)!.off ??= this.t;
  }

  /** A whole shootout with AI choices on both sides. */
  private shootout(): [number, number] {
    const takers = new Map([...this.pkTakers(0), ...this.pkTakers(1)].map((t) => [t.id, t]));
    return autoShootout(this.newShootout(), takers, this.pkKeepers(), this.rng);
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
          // much of the tiredness is just "match legs": only part of it is still there at the next round
          fitness: Math.round(Math.min(p.fit0, p.fit0 - (p.fit0 - p.fitness) * STYLE_TUNE.fatiguePersist)),
          rt: matchRating(p),
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
