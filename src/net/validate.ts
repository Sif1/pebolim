// Shape checks for everything a client can send to the host. A friend can modify their copy of the game,
// so the host never trusts a message: anything malformed is dropped before it reaches the game logic.
import type { Command, CustomClubSpec } from '../engine/commands';
import { FORMATIONS, validShape } from '../engine/match/formations';
import type { Lineup, SectorPrices, Tactics } from '../engine/types';
import type { Claim, ClientMsg, MatchAction } from './protocol';

export const MATCH_MINUTES = [1, 2, 3, 5, 8];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, lo = 0, hi = 2 ** 31): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const ID = 2 ** 31;
const MONEY = 1e13;

export function validTactics(v: unknown): Tactics | null {
  if (!isObj(v)) return null;
  if (!oneOf(v.formation, Object.keys(FORMATIONS) as Tactics['formation'][])) return null;
  if (!oneOf(v.mentality, ['defensiva', 'equilibrada', 'ofensiva'] as const)) return null;
  if (!oneOf(v.marking, ['zona', 'pressao'] as const)) return null;
  if (!oneOf(v.style, ['toque', 'contra', 'longa'] as const)) return null;
  if (v.shape != null && !validShape(v.shape)) return null;
  return {
    formation: v.formation,
    mentality: v.mentality,
    marking: v.marking,
    style: v.style,
    shape: v.shape ? [...(v.shape as number[])] : null,
  };
}

function validLineup(v: unknown): Lineup | null {
  if (!isObj(v) || !Array.isArray(v.xi) || !Array.isArray(v.bench)) return null;
  if (v.xi.length > 11 || v.bench.length > 12) return null;
  if (!v.xi.every((x) => x === null || int(x, 0, ID))) return null;
  if (!v.bench.every((x) => int(x, 0, ID))) return null;
  return { xi: v.xi as (number | null)[], bench: v.bench as number[] };
}

function validPrices(v: unknown): SectorPrices | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => num(x, 0, 1e6))) return null;
  return v as SectorPrices;
}

export function validCommand(v: unknown): Command | null {
  if (!isObj(v) || typeof v.c !== 'string') return null;
  switch (v.c) {
    case 'setTactics': {
      const t = validTactics(v.tactics);
      return t ? { c: 'setTactics', tactics: t } : null;
    }
    case 'setLineup': {
      const l = validLineup(v.lineup);
      return l && typeof v.auto === 'boolean' ? { c: 'setLineup', lineup: l, auto: v.auto } : null;
    }
    case 'setTickets': {
      if (v.comp !== null && !str(v.comp, 40)) return null;
      const prices = v.prices === null ? null : validPrices(v.prices);
      if (v.prices !== null && !prices) return null;
      return { c: 'setTickets', comp: v.comp as string | null, prices };
    }
    case 'setFocus':
      return oneOf(v.focus, ['equilibrado', 'fisico', 'tecnico'] as const) ? { c: 'setFocus', focus: v.focus } : null;
    case 'setTravel':
      return oneOf(v.mode, ['auto', 'onibus', 'comercial', 'fretado'] as const) ? { c: 'setTravel', mode: v.mode } : null;
    case 'upgradeTC':
      return { c: 'upgradeTC' };
    case 'expandStadium':
      return int(v.seats, 1000, 30000) ? { c: 'expandStadium', seats: v.seats } : null;
    case 'setSale':
      return int(v.pid, 0, ID) && (v.price === null || num(v.price, 0, MONEY)) ? { c: 'setSale', pid: v.pid, price: v.price as number | null } : null;
    case 'setLoanList':
      return int(v.pid, 0, ID) && (v.months === null || v.months === 6 || v.months === 12) ? { c: 'setLoanList', pid: v.pid, months: v.months } : null;
    case 'startAuction':
      return int(v.pid, 0, ID) && num(v.min, 0, MONEY) ? { c: 'startAuction', pid: v.pid, min: v.min } : null;
    case 'auctionBid':
      return int(v.pid, 0, ID) && (v.amount === null || num(v.amount, 0, MONEY)) ? { c: 'auctionBid', pid: v.pid, amount: v.amount as number | null } : null;
    case 'bid':
      if (!int(v.pid, 0, ID) || !oneOf(v.kind, ['compra', 'emprestimo'] as const)) return null;
      if (!num(v.fee, 0, MONEY) || !num(v.wage, 1, MONEY) || !int(v.years, 1, 5)) return null;
      if (v.months != null && v.months !== 6 && v.months !== 12) return null;
      return { c: 'bid', pid: v.pid, kind: v.kind, fee: v.fee, wage: v.wage, years: v.years, ...(v.months ? { months: v.months as 6 | 12 } : {}) };
    case 'respondBid':
      if (!int(v.bid, 0, ID) || !oneOf(v.action, ['aceitar', 'recusar', 'contraproposta'] as const)) return null;
      if (v.fee != null && !num(v.fee, 0, MONEY)) return null;
      return { c: 'respondBid', bid: v.bid, action: v.action, fee: v.fee as number | undefined };
    case 'acceptCounter':
    case 'cancelBid':
      return int(v.bid, 0, ID) ? { c: v.c, bid: v.bid } : null;
    case 'renew':
      return int(v.pid, 0, ID) && num(v.wage, 1, MONEY) && int(v.years, 1, 5) ? { c: 'renew', pid: v.pid, wage: v.wage, years: v.years } : null;
    case 'release':
      return int(v.pid, 0, ID) ? { c: 'release', pid: v.pid } : null;
    case 'acceptJob':
    case 'declineJob':
      return int(v.clubId, 0, ID) ? { c: v.c, clubId: v.clubId } : null;
    case 'resign':
      return { c: 'resign' };
    default:
      return null;
  }
}

export function validMatchAction(v: unknown): MatchAction | null {
  if (!isObj(v)) return null;
  switch (v.a) {
    case 'pause':
    case 'resume':
    case 'quick':
      return { a: v.a };
    case 'sub':
      return int(v.out, 0, ID) && int(v.in, 0, ID) ? { a: 'sub', out: v.out, in: v.in } : null;
    case 'swap':
      return int(v.s1, 0, 10) && int(v.s2, 0, 10) && v.s1 !== v.s2 ? { a: 'swap', s1: v.s1, s2: v.s2 } : null;
    case 'tactics': {
      const t = validTactics(v.tactics);
      return t ? { a: 'tactics', tactics: t } : null;
    }
    case 'pkOrder':
      return Array.isArray(v.order) && v.order.length <= 11 && v.order.every((x) => int(x, 0, ID)) ? { a: 'pkOrder', order: [...(v.order as number[])] } : null;
    case 'pkAim':
      return v.dir === 0 || v.dir === 1 || v.dir === 2 ? { a: 'pkAim', dir: v.dir } : null;
    default:
      return null;
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function validSpec(v: unknown): CustomClubSpec | null {
  if (!isObj(v)) return null;
  if (!str(v.name, 32) || !str(v.short, 4) || !str(v.city, 32) || !str(v.stadium, 40) || !int(v.replaceClubId, 0, ID)) return null;
  if (!Array.isArray(v.colors) || v.colors.length !== 2 || !v.colors.every((c) => typeof c === 'string' && HEX.test(c))) return null;
  return { name: v.name, short: v.short, city: v.city, stadium: v.stadium, replaceClubId: v.replaceClubId, colors: [v.colors[0], v.colors[1]] };
}

export function validClaim(v: unknown): Claim | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case 'club':
      return int(v.clubId, 0, ID) ? { kind: 'club', clubId: v.clubId } : null;
    case 'resume':
      return str(v.managerId, 40) ? { kind: 'resume', managerId: v.managerId } : null;
    case 'create': {
      const spec = validSpec(v.spec);
      return spec ? { kind: 'create', spec } : null;
    }
    case 'spectate':
      return { kind: 'spectate' };
    default:
      return null;
  }
}

/** Check a raw message from a client; returns a clean copy or null. */
export function validClientMsg(v: unknown): ClientMsg | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'hello':
      if (!str(v.name, 60) || !str(v.token, 80) || (v.managerId !== null && !str(v.managerId, 40))) return null;
      return { t: 'hello', name: v.name, token: v.token, managerId: v.managerId as string | null };
    case 'claim': {
      const claim = validClaim(v.claim);
      return claim ? { t: 'claim', claim } : null;
    }
    case 'cmd': {
      const cmd = validCommand(v.cmd);
      return cmd && int(v.seq, 0, 2 ** 40) ? { t: 'cmd', seq: v.seq, cmd } : null;
    }
    case 'ready':
      return typeof v.ready === 'boolean' ? { t: 'ready', ready: v.ready } : null;
    case 'match': {
      const action = validMatchAction(v.action);
      return action && int(v.fixtureId, 0, ID) ? { t: 'match', fixtureId: v.fixtureId, action } : null;
    }
    case 'resync':
      return { t: 'resync' };
    case 'host':
      return oneOf(v.action, ['start', 'matchday', 'continue'] as const) ? { t: 'host', action: v.action } : null;
    case 'settings':
      return MATCH_MINUTES.includes(v.matchMinutes as number) ? { t: 'settings', matchMinutes: v.matchMinutes as number } : null;
    default:
      return null;
  }
}

/** Simple token bucket: allows bursts of `burst` messages, refilled at `perSec`. */
export class RateLimit {
  private tokens: number;
  private last = Date.now();
  constructor(
    private burst: number,
    private perSec: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
